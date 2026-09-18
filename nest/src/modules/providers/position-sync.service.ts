/**
 * PositionSyncService — bridges Broker ↔ DB two-way data flow (#470, #446, #616).
 *
 * Broker-agnostic: accepts positions + provider ID from the automation loop
 * on each tick. Works with MT5, Trading212, Binance, Alpaca, etc.
 *
 * On each sync:
 * 1. Upserts into the Position table (idempotent by symbol + provider),
 *    now storing the 64-bit broker ticket as a STRING (brokerTicket).
 * 2. Matches positions to Trade records by brokerTicket — and CREATES a
 *    Trade row for any broker position we have never seen (externally or
 *    manually opened positions become first-class trades).
 * 3. Detects closed positions (was in DB, no longer in latest fetch) →
 *    finalizes the Trade with the real exit price (from broker deal history)
 *    and emits a configurable notification.
 *
 * This creates the traceability chain:
 *   Scoring Run → Strategy → Trade(scoringStrategyId, brokerTicket) → Broker Position
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { AdapterFactory } from './adapter-factory';
import { CLOSE_REASONS, closeReasonFromDealReason } from '../../common/trading/close-reason';

/** Normalised position shape — any broker adapter should map to this. */
export interface BrokerPosition {
  symbol: string;
  brokerTicket: string;    // broker-specific order/position ID (MT5 ticket, T212 orderId, etc.) — 64-bit safe string
  side?: 'buy' | 'sell';
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  sl: number | null;
  tp: number | null;
  comment: string;
  openedAt: Date;
  accountId?: string | null;
}

export interface PositionSyncOptions {
  /** True only when the broker positively returned a complete snapshot. */
  authoritative?: boolean;
  accountId?: string | null;
}

@Injectable()
export class PositionSyncService {
  private readonly logger = new Logger(PositionSyncService.name);
  private lastSyncedAt: Date | null = null;
  private lastResult: { synced: number; created: number; closed: number; reaped: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly notifications?: NotificationService,
  ) {}

  /**
   * Sync broker positions → Position + Trade tables.
   * @param provider — broker ID string (e.g. 'mt5', 'trading212', 'binance')
   * @param positions — normalised position array from the broker adapter
   */
  async syncPositions(
    provider: string,
    positions: BrokerPosition[],
    options: PositionSyncOptions = {},
  ): Promise<{ synced: number; created: number; closed: number; reaped: number }> {
    if (!this.prisma.isAvailable) return { synced: 0, created: 0, closed: 0, reaped: 0 };
    const authoritative = options.authoritative ?? positions.length > 0;
    const accountId = options.accountId ?? null;

    try {
      // 1. Upsert incoming positions by broker ticket. Symbol-level uniqueness
      // collapses hedged/pyramided positions and is unsafe across accounts.
      let synced = 0;
      let created = 0;
      for (const pos of positions) {
        const positionAccountId = pos.accountId ?? accountId;
        const data = {
            symbol: pos.symbol,
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            currentPrice: pos.currentPrice,
            pnl: pos.pnl,
            provider,
            accountId: positionAccountId,
            brokerTicket: pos.brokerTicket || null,
            side: pos.side || null,
            openedAt: pos.openedAt,
            lastQuotedAt: new Date(),
        };
        const update = {
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            currentPrice: pos.currentPrice,
            pnl: pos.pnl,
            brokerTicket: pos.brokerTicket || null,
            side: pos.side || null,
            accountId: positionAccountId,
            lastQuotedAt: new Date(),
        };
        if (pos.brokerTicket) {
          await (this.prisma as any).position.upsert({
            where: { provider_brokerTicket: { provider, brokerTicket: pos.brokerTicket } },
            create: data,
            update,
          });
        } else {
          const existing = await (this.prisma as any).position.findFirst({
            where: { provider, accountId: positionAccountId, symbol: pos.symbol, brokerTicket: null },
          });
          if (existing) {
            await (this.prisma as any).position.update({ where: { id: existing.id }, data: update });
          } else {
            await (this.prisma as any).position.create({ data });
          }
        }
        synced++;

        // 2. Link to — or CREATE — the Trade record for this position.
        created += await this.reconcileTrade(provider, pos);
      }

      // 3. Detect closed positions only from a complete broker snapshot. Empty
      // arrays caused by outages must never liquidate the local projection.
      if (!authoritative) {
        this.logger.warn(`[${provider}] Non-authoritative position snapshot — closure detection skipped`);
        return { synced, created, closed: 0, reaped: 0 };
      }
      const incomingTickets = positions.map(p => p.brokerTicket).filter(Boolean);
      // 2026-09-10 — rows written before the accountId/ticket backfill carry NULL
      // in both columns. Scoping this scan by accountId hid them from closure
      // detection forever, so a closed position kept living on as a phantom
      // "open" row (it also blocked the duplicate guard for that symbol).
      const dbPositions = await (this.prisma as any).position.findMany({
        where: accountId
          ? { provider, OR: [{ accountId }, { accountId: null }] }
          : { provider },
      });
      // A legacy row (no ticket) is only "still open" while NO ticketed row
      // represents the same symbol — otherwise it is a superseded duplicate:
      // matching by symbol alone made any re-opened symbol immortal.
      const ticketedSymbols = new Set(
        dbPositions.filter((p: any) => p.brokerTicket).map((p: any) => p.symbol),
      );
      const unticketedIncoming = new Set(
        positions.filter(p => !p.brokerTicket).map(p => p.symbol),
      );
      let closed = 0;
      for (const dbPos of dbPositions) {
        const stillOpen = dbPos.brokerTicket
          ? incomingTickets.includes(dbPos.brokerTicket)
          : ticketedSymbols.has(dbPos.symbol)
            ? false
            : unticketedIncoming.has(dbPos.symbol);
        if (stillOpen) continue;

        closed += await this.finalizeClosedPosition(provider, dbPos);
      }

      // Reap stranded TRADE rows — see reapStrandedTrades(). Runs only past the
      // `authoritative` guard above, so an outage can never trigger it.
      const reaped = await this.reapStrandedTrades(provider, accountId, positions);

      this.lastSyncedAt = new Date();
      this.lastResult = { synced, created, closed, reaped };
      if (synced > 0 || created > 0 || closed > 0 || reaped > 0) {
        this.logger.log(
          `[${provider}] Position sync: ${synced} upserted, ${created} created, ${closed} closed, ${reaped} stranded trade row(s) reaped`,
        );
      }
      return { synced, created, closed, reaped };
    } catch (err) {
      this.logger.warn(`[${provider}] Position sync failed: ${(err as Error).message}`);
      return { synced: 0, created: 0, closed: 0, reaped: 0 };
    }
  }

  /**
   * Close out Trade rows that have no broker counterpart and no ticket.
   *
   * WHY (2026-09-10): the Position table self-heals, but `trade` had no
   * equivalent reaper. When a position closed, `finalizeClosedPosition()` only
   * ran for rows still present in `position` — so any Trade whose Position row
   * had already been cleaned stayed `status='open'` forever with no broker
   * counterpart. Measured damage: 17 phantom USDCAD rows (opened
   * 2026-07-10…07-24), all `origin='strategy'`, all NULL brokerTicket, against
   * ZERO broker positions. They inflate every open-position count and corrupt
   * any exposure or P&L figure derived from `trade`.
   *
   * ⚠️ SAFETY: only rows with NO brokerTicket are considered, and only when the
   * symbol is absent from an AUTHORITATIVE snapshot.
   *   - A ticket is proof of life: if the broker reports that ticket, the row is
   *     never touched, whatever else the snapshot looks like.
   *   - A partial/empty snapshot caused by an outage must never reap anything,
   *     which is why this runs only after the `authoritative` early-return.
   *   - Rows are CLOSED, not deleted, so the record stays auditable.
   */
  private async reapStrandedTrades(
    provider: string,
    accountId: string | null,
    positions: BrokerPosition[],
  ): Promise<number> {
    try {
      // ⚠️ Do NOT filter by accountId here: `trade` has no such column (only
      // `position` does). Adding it silently returns zero rows, because Prisma
      // discards an unknown filter rather than erroring — which is exactly how
      // the first version of this reaper reported "0 reaped" while 17 stranded
      // rows sat in the table. `provider` is the correct scope for `trade`.
      void accountId;
      const liveSymbols = new Set(positions.map((p) => String(p.symbol).toUpperCase()));
      const stranded: any[] = await (this.prisma as any).trade.findMany({
        where: { provider, status: 'open', brokerTicket: null },
        select: { id: true, symbol: true, openedAt: true },
      });
      if (!Array.isArray(stranded) || stranded.length === 0) return 0;

      let reaped = 0;
      for (const t of stranded) {
        if (liveSymbols.has(String(t.symbol).toUpperCase())) continue;
        const updated = await (this.prisma as any).trade.updateMany({
          where: { id: t.id, status: 'open', brokerTicket: null },
          data: {
            status: 'closed',
            closedAt: new Date(),
            pnl: 0,
            brokerComment: 'Reconciled: no broker counterpart (stranded row)',
            // Named here rather than left null: a reaped row closed for a reason we DO know, and
            // the 2026-09-18 investigation was slowed by exactly this kind of unattributed exit.
            closeReason: CLOSE_REASONS.SYSTEM_RECONCILED,
          },
        }).catch(() => null);
        if (updated?.count) {
          reaped += updated.count;
          this.logger.warn(
            `[${provider}] Reaped stranded open Trade ${t.symbol} (${t.id}) — unticketed and absent from broker snapshot`,
          );
        }
      }
      return reaped;
    } catch (err) {
      this.logger.warn(`[${provider}] Stranded-trade reap failed: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Link a broker position to its Trade row — creating one if the position
   * was opened outside the app's own order path (manual / another terminal).
   * Returns 1 if a Trade row was newly created, else 0.
   */
  private async reconcileTrade(provider: string, pos: BrokerPosition): Promise<number> {
    const side = pos.side || 'buy';
    const openWhere: any = { provider, status: 'open' };

    // 2a. Exact match by broker ticket (the primary 64-bit-safe link).
    if (pos.brokerTicket) {
      const byTicket: any = await this.prisma.trade
        .findFirst({ where: { ...openWhere, brokerTicket: pos.brokerTicket } })
        .catch(() => null);
      if (byTicket) {
        await this.prisma.trade.update({
          where: { id: byTicket.id },
          data: {
            sl: pos.sl ?? byTicket.sl,
            tp: pos.tp ?? byTicket.tp,
            brokerComment: pos.comment?.substring(0, 200) || byTicket.brokerComment,
          },
        }).catch(() => {});
        return 0;
      }
    }

    // 2b. Fallback — match by symbol+provider+side (legacy rows with no ticket).
    const bySymbol: any = await this.prisma.trade
      .findFirst({ where: { ...openWhere, symbol: pos.symbol, side, brokerTicket: null }, orderBy: { openedAt: 'desc' } })
      .catch(() => null);
    if (bySymbol) {
      await this.prisma.trade.update({
        where: { id: bySymbol.id },
        data: {
          // Backfill the broker ticket we were missing (#616)
          brokerTicket: pos.brokerTicket || bySymbol.brokerTicket,
          sl: pos.sl ?? bySymbol.sl,
          tp: pos.tp ?? bySymbol.tp,
          brokerComment: pos.comment?.substring(0, 200) || bySymbol.brokerComment,
        },
      }).catch(() => {});
      return 0;
    }

    // 2c. No matching trade — this position was opened outside the app.
    //     Record it as a first-class Trade so the journal/timeline see it.
    const created = await (this.prisma as any).trade.create({
      data: {
        symbol: pos.symbol,
        side,
        quantity: pos.quantity,
        entryPrice: pos.avgPrice || 0,
        pnl: 0,
        provider,
        status: 'open',
        origin: 'external',
        source: 'broker-sync',
        brokerTicket: pos.brokerTicket || null,
        sl: pos.sl ?? null,
        tp: pos.tp ?? null,
        brokerComment: pos.comment?.substring(0, 200) || null,
        openedAt: pos.openedAt || new Date(),
      },
    }).catch((err: any) => {
      this.logger.warn(`Failed to create Trade for external ${provider} ${pos.symbol}: ${err?.message}`);
      return null;
    });

    if (created) {
      this.logger.log(`Created Trade for externally-opened ${provider} position ${pos.symbol} (${pos.brokerTicket || 'no ticket'})`);
      this.notifications?.send({
        title: `🆕 Position opened — ${pos.symbol}`,
        body: `${side.toUpperCase()} ${pos.quantity}×${pos.symbol} @ ${pos.avgPrice} opened on ${provider}` +
          (pos.brokerTicket ? ` (ticket ${pos.brokerTicket})` : ''),
        symbol: pos.symbol,
        event: 'position-opened',
        metadata: { provider, brokerTicket: pos.brokerTicket, side, quantity: pos.quantity },
      }).catch(() => {});
      return 1;
    }
    return 0;
  }

  /**
   * A position that was previously synced is no longer in the latest fetch —
   * it was closed (by the bot, by the user in MT5, or elsewhere). Finalize the
   * Trade with the real exit price from broker deal history and notify.
   * Returns 1 if a Trade was finalized, else 0.
   */
  private async finalizeClosedPosition(provider: string, dbPos: any): Promise<number> {
    // Find the open trade — by broker ticket first, then symbol fallback.
    const where: any = { provider, status: 'open' };
    let trade: any = null;
    if (dbPos.brokerTicket) {
      trade = await this.prisma.trade.findFirst({ where: { ...where, brokerTicket: dbPos.brokerTicket } }).catch(() => null);
    }
    if (!trade) {
      trade = await this.prisma.trade
        .findFirst({ where: { ...where, symbol: dbPos.symbol, brokerTicket: null }, orderBy: { openedAt: 'desc' } })
        .catch(() => null);
    }

    // Real exit price from broker deal history (#470). Falls back to the last
    // known currentPrice/pnl snapshot if the broker doesn't expose deals.
    let exitPrice: number | null = dbPos.currentPrice ?? null;
    let realizedPnl: number | null = dbPos.pnl ?? null;
    let closedAt: Date | null = null;
    // MT5 `deal.reason` off the closing deal — the broker's OWN statement of why it closed.
    // `undefined` until the bridge is redeployed with the field; see close-reason.ts.
    let dealReason: number | undefined;
    try {
      const adapter: any = this.adapterFactory?.create(provider);
      if (adapter?.getDeals && dbPos.openedAt) {
        const deals = await adapter.getDeals(new Date(dbPos.openedAt));
        const byPosition = deals.filter((d: any) =>
          dbPos.brokerTicket && d.positionId === dbPos.brokerTicket,
        );
        // Legacy brokers may not expose a position id. The symbol fallback is
        // only safe when the returned window identifies ONE lifecycle — with
        // several lifecycles for the same symbol it would average unrelated
        // deals into the exit price (2026-09-10).
        const symbolDeals = deals.filter((d: any) => d.symbol === dbPos.symbol);
        const symbolLifecycles = new Set(
          symbolDeals.map((d: any) => d.positionId ?? d.orderId ?? ''),
        );
        const symbolFallbackSafe = symbolLifecycles.size <= 1;
        const candidates = byPosition.length > 0
          ? byPosition
          : dbPos.brokerTicket ? []
            : symbolFallbackSafe ? symbolDeals : [];
        if (byPosition.length === 0 && !dbPos.brokerTicket && !symbolFallbackSafe) {
          this.logger.warn(
            `[${provider}] ${dbPos.symbol}: ${symbolLifecycles.size} deal lifecycles in history — ` +
            'cannot identify the closing deal, keeping the last known snapshot as the exit price',
          );
        }
        // The Trade row owns the direction. A legacy Position row has side NULL,
        // which used to flip this to the OPENING deal and write the entry price
        // back as the exit price.
        const positionSide = String(trade?.side ?? dbPos.side ?? '').toLowerCase();
        const closingSide = positionSide === 'sell' ? 'buy' : 'sell';
        const exitDeals = candidates.filter((d: any) => d.side === closingSide);
        if (exitDeals.length > 0) {            const lastDeal: any = exitDeals[exitDeals.length - 1];
            // The broker's own reason for the close, when it reports one.
            if (typeof lastDeal?.reason === 'number') dealReason = lastDeal.reason;          const filledVolume = exitDeals.reduce((sum: number, d: any) => sum + Number(d.volume || 0), 0);
          exitPrice = filledVolume > 0
            ? exitDeals.reduce((sum: number, d: any) => sum + Number(d.price || 0) * Number(d.volume || 0), 0) / filledVolume
            : Number(exitDeals[exitDeals.length - 1].price || 0);
          realizedPnl = exitDeals.reduce((sum: number, d: any) =>
            sum + Number(d.profit || 0) + Number(d.commission || 0) + Number(d.swap || 0) + Number(d.fee || 0), 0);
          // Prefer the broker's real close time over "now" (a reconciliation
          // pass can finalise a trade days after the broker closed it).
          const lastExitTime = exitDeals[exitDeals.length - 1]?.time;
          if (lastExitTime) closedAt = new Date(lastExitTime);
        }
      }
    } catch (err) {
      this.logger.debug(`Deal-history lookup failed for ${provider} ${dbPos.symbol}: ${(err as Error).message}`);
    }

    if (trade) {
      // ── WHY it closed (2026-09-18) ──────────────────────────────────────────
      //
      // ⚠️ NEVER overwrite an existing reason. The time-stop writes `system:time-stop` at the
      // moment it sends the close — that is STRICTLY BETTER evidence than anything derivable
      // here, because this function runs on a LATER tick, after the position has already
      // vanished from the broker snapshot, and cannot tell a close of ours from the broker's.
      //
      // When nothing recorded a reason, derive one from the broker's deal `reason`. The running
      // bridge does not forward that field yet, so this yields `broker:unknown` — deliberately.
      // "The broker did it and did not say why" is the true statement; a guess is what made the
      // 2026-09-18 investigation impossible in the first place.
      const derivedCloseReason = closeReasonFromDealReason(dealReason);
      const closeReason = trade.closeReason ?? derivedCloseReason;

      await this.prisma.trade.update({
        where: { id: trade.id },
        data: {
          status: 'closed',
          exitPrice: exitPrice ?? trade.exitPrice ?? null,
          pnl: realizedPnl ?? trade.pnl ?? null,
          closedAt: closedAt ?? new Date(),
          closeReason,
        },
      });

      const pnlStr = realizedPnl != null ? ` PnL=${realizedPnl.toFixed(2)}` : '';
      this.logger.log(
        `[${provider}] Closed trade ${trade.id} (${trade.symbol}) exit=${exitPrice}${pnlStr} why=${closeReason}`,
      );
      this.notifications?.send({
        title: `🔻 Position closed — ${trade.symbol}`,
        body: `${(trade.side || 'buy').toUpperCase()} ${trade.quantity}×${trade.symbol} closed @ ${exitPrice ?? 'market'}` +
          (realizedPnl != null ? ` (${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)})` : ''),
        symbol: trade.symbol,
        event: 'position-closed',
        metadata: { provider, brokerTicket: dbPos.brokerTicket ?? trade.brokerTicket, pnl: realizedPnl, exitPrice },
      }).catch(() => {});
    }

    await (this.prisma as any).position.delete({ where: { id: dbPos.id } });
    return 1;
  }

  getLastSyncTime(): Date | null { return this.lastSyncedAt; }

  /** Most recent sync outcome (upserted/created/closed) — for status dashboards. */
  getLastSyncResult(): { synced: number; created: number; closed: number } | null {
    return this.lastResult;
  }
}
