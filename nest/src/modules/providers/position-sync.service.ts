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
import { CLOSE_REASONS, closeReasonFromComment, closeReasonFromDealReason } from '../../common/trading/close-reason';
import { resolveStrategyForClose } from './mt5-comment.util';
// #1014 — the volume split that makes storing the POSITION id safe. Without it, N rows carrying one
// `positionId` would EACH book the position's whole net (a 4x overstatement on a 4-order scale-in).
import { splitPnlByVolume } from './pnl-split';

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

        closed += await this.finalizeClosedPosition(provider, dbPos, accountId);
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
   * Close out Trade rows that have no broker counterpart.
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
   * WHY AGAIN (2026-09-18, #871): that fix handled only the UNTICKETED half.
   * A Trade **with** a ticket whose Position row was gone remained invisible to
   * both paths. Measured: 5 such rows against 5 live positions. Two cases are
   * now distinguished, because they are not the same event and must not be
   * closed the same way — see the per-row branch below.
   *
   * ⚠️ SAFETY — this function CLOSES ledger rows, so the guards are the point:
   *   - It runs only past the `authoritative` early-return in `syncPositions()`,
   *     so a partial or empty snapshot from an outage can never reach it. That
   *     guard is the SAME one `finalizeClosedPosition()` already trusts; this
   *     widening does not rely on a weaker test than the existing closure path.
   *   - A ticket the broker still reports is proof of life: the row is never
   *     touched, whatever else the snapshot looks like.
   *   - Rows are CLOSED, not deleted, so the record stays auditable.
   *   - A ticketed row is finalised through `finalizeClosedPosition()` (real
   *     exit from deal history); only a never-ticketed phantom gets `pnl: 0`.
   */
  private async reapStrandedTrades(
    provider: string,
    accountId: string | null,
    positions: BrokerPosition[],
  ): Promise<number> {
    try {
      // ⚠️ `trade.accountId` exists as of #889 — this comment used to say it did NOT, and that
      // `provider` was therefore the only usable scope. That was true then and is false now, and
      // the difference matters: `provider` alone spans every account, so an account-scoped sync
      // using it would judge trades belonging to a broker it never queried. `mayJudgeTrade()`
      // applies the scope per row.
      //
      // ⚠️ Do NOT add `accountId` to the PRISMA where-clause as a shortcut. A filter that does not
      // exist is DISCARDED rather than rejected, so it would silently return rows instead of
      // scoping them — the same trap that made the first version of this reaper report "0 reaped"
      // while 17 stranded rows sat in the table.
      const liveSymbols = new Set(positions.map((p) => String(p.symbol).toUpperCase()));
      // ⚠️ A ticket the broker REPORTS is proof of life. Built once, compared per row.
      const liveTickets = new Set(
        positions.map((p) => (p.brokerTicket == null ? '' : String(p.brokerTicket))).filter(Boolean),
      );
      // ⚠️ NOT filtered to `brokerTicket: null` any more — that filter WAS the #871 gap.
      //
      // A Trade with a ticket whose Position row had already been cleaned was invisible to BOTH
      // reconciliation paths: this reaper excluded it by ticket, and `finalizeClosedPosition()`
      // iterates rows still present in `position`, so it never visited it either. The row stayed
      // `status='open'` forever with no broker counterpart.
      //
      // Measured 2026-09-18: **5** such rows against 5 live positions (10 open trades total) — and
      // growing. The issue recorded 3; two further VIX orphans were added the same day it was
      // written, which is the argument for fixing the class rather than the rows.
      const stranded: any[] = await (this.prisma as any).trade.findMany({
        where: { provider, status: 'open' },
        select: {
          id: true, symbol: true, openedAt: true,
          brokerTicket: true, side: true, pnl: true, exitPrice: true,
          accountId: true, quantity: true,
        },
      });
      if (!Array.isArray(stranded) || stranded.length === 0) return 0;

      let reaped = 0;
      for (const t of stranded) {
        // ⚠️ Scope BEFORE anything else (#889). A trade belonging to another account is not
        // "missing from the snapshot" — it is simply not this sync's business, and the retired
        // code could not tell those two situations apart.
        if (!this.mayJudgeTrade(t, accountId)) {
          this.logger.debug(
            `[${provider}] trade ${t.id} (${t.symbol}) belongs to account ` +
            `${t.accountId ?? 'unknown'} — NOT judged by an account-${accountId} sync`,
          );
          continue;
        }

        const ticket = t.brokerTicket == null ? null : String(t.brokerTicket);

        if (ticket) {
          // Still reported by the broker → the position is ALIVE. Never touch it, whatever else
          // the snapshot looks like. The retired version expressed this as "only select unticketed
          // rows"; stated as a per-row test it now covers the case that filter could not.
          if (liveTickets.has(ticket)) continue;

          // Ticketed, and the broker does NOT report it: the position genuinely existed, so it is
          // FINALISED — not reaped at pnl 0. `finalizeClosedPosition()` already resolves the real
          // exit price, realised P&L and close reason from broker deal history, and it reads only
          // the six fields supplied below. Reusing it is the difference between a correct ledger
          // entry and a fabricated zero; re-implementing the lookup here would have been a second
          // copy to drift.
          const finalised = await this.finalizeClosedPosition(provider, {
            brokerTicket: ticket,
            symbol: t.symbol,
            openedAt: t.openedAt,
            side: t.side,
            // ⚠️ `quantity` is REQUIRED, not decorative (#1014). It is the NUMERATOR of the volume
            // split (`rowQuantity / totalOpeningVolume`), and when the ticket resolves to a position
            // the split is forced. Omitted, `splitPnlByVolume` gets `qty = 0`, returns null, and the
            // row keeps a NULL P&L while showing a correct exit price — which reads as "the repair
            // half worked", the hardest kind of result to notice.
            quantity: t.quantity,
            currentPrice: t.exitPrice ?? null,
            pnl: t.pnl ?? null,
          }, accountId).catch(() => 0);
          if (finalised) {
            reaped += finalised;
            this.logger.warn(
              `[${provider}] Finalised abandoned Trade ${t.symbol} (${t.id}, ticket ${ticket}) — ` +
              'ticketed but absent from the broker snapshot; exit taken from deal history',
            );
          }
          continue;
        }

        // No ticket at all — a legacy phantom with no broker record ever, which is why `pnl: 0`
        // here is the truthful value rather than a placeholder for one we failed to fetch.
        if (liveSymbols.has(String(t.symbol).toUpperCase())) continue;
        const updated = await (this.prisma as any).trade.updateMany({
          where: { id: t.id, status: 'open', brokerTicket: null },
          data: {
            status: 'closed',
            closedAt: new Date(),
            pnl: 0,
            // ⚠️ #1044 — THE FLAG IS SET HERE, AT THE WRITE, AND NOT BY A LATER SWEEP.
            //
            // The `pnl: 0` above is deliberate (there was never a fill, so there is no P&L), but
            // nothing about the row SAYS so. Before this change the flag was applied only by the
            // separate `quarantine-phantom-closes.cjs` pass, so a row reaped between sweeps
            // carried `pnlInvalid = 0` and was counted as a BREAK-EVEN TRADE by every consumer
            // filtering on that flag. Measured 2026-10-01: **21 such rows** existed, and they
            // were the reason two readers of the same table disagreed about its size (264 rows
            // by `pnlInvalid`, 243 by structure) with no error anywhere.
            //
            // Two-step invariants ("write, then flag") fail silently whenever the second step is
            // skipped. The classification rule lives in `common/trading/pnl-population.ts`.
            pnlInvalid: 1,
            pnlInvalidReason: 'Structural phantom — reaped with no broker counterpart and no exit price (#1044)',
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
   * repairClosedTradesWithUnknownPnl() — re-price rows that were finalised as "position vanished".
   *
   * ── WHY THIS EXISTS, AND WHY IT IS NOT PART OF THE NORMAL PASS ───────────────────────────────
   *
   * `reapStrandedTrades()` only looks at `status='open'`, and `finalizeClosedPosition()` is driven by
   * rows still present in `position`. A row that was ALREADY wrongly closed — which is the whole
   * population #1014 is about — is therefore reachable by neither, and stayed wrong. Measured
   * 2026-10-01: the loop ticked with the fixed write sites and closed **0** rows, which is how this
   * gap was found (a wrong answer and a negative answer look identical in a count).
   *
   * It is a SEPARATE, EXPLICIT pass rather than something the 2-minute loop does on its own, because
   * it rewrites history. The issue's own rule applies: the record is the evidence, so a rewrite is a
   * deliberate act with a count in the log — not a side effect of a routine tick.
   *
   * ⚠️ IDEMPOTENT BY CONSTRUCTION. Repairing a row clears `pnlInvalid`, so it is not selected again.
   * A row whose ticket cannot be resolved is left exactly as it was and is COUNTED as unrepaired, so
   * "not repairable" is distinguishable from "not reached".
   *
   * ⚠️ IT NEVER ERASES AN EXISTING P&L. Only rows flagged `pnlInvalid` with no computable result are
   * candidates, and the finaliser preserves a known value.
   */
  async repairClosedTradesWithUnknownPnl(
    provider: string,
    accountId: string | null = null,
    limit = 200,
  ): Promise<{ examined: number; repaired: number; notRepairable: number }> {
    const candidates: any[] = await (this.prisma as any).trade
      .findMany({
        where: { provider, status: 'closed', pnlInvalid: 1 },
        select: {
          id: true, symbol: true, openedAt: true, brokerTicket: true,
          side: true, pnl: true, exitPrice: true, accountId: true, quantity: true,
        },
        orderBy: { openedAt: 'asc' },
        take: limit,
      })
      .catch(() => []);

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return { examined: 0, repaired: 0, notRepairable: 0 };
    }

    let repaired = 0;
    let notRepairable = 0;
    // ⚠️ WHY EACH ROW FAILED, COUNTED RATHER THAN SWALLOWED. The first version of this pass returned
    // `examined 135, repaired 0, notRepairable 135` with NOTHING in the log — because the
    // `finalizeClosedPosition` call was wrapped in `.catch(() => 0)`. A count with no reason is the
    // defect this repo keeps re-finding: it cannot be told apart from a wrong answer, and it cost a
    // rebuild-and-retry cycle to diagnose. The reasons are now carried out of the loop.
    const reasons = new Map<string, number>();
    const note = (k: string) => reasons.set(k, (reasons.get(k) ?? 0) + 1);

    for (const t of candidates) {
      // A row with no ticket at all is not this pass's business — there is no position to resolve.
      // Those are the symbol-fallback / reaper population and they are counted elsewhere.
      if (t.brokerTicket == null) {
        notRepairable++;
        note('no ticket — no position to resolve');
        continue;
      }

      let done = 0;
      let failure: string | null = null;
      try {
        done = await this.finalizeClosedPosition(
          provider,
          {
            brokerTicket: String(t.brokerTicket),
            symbol: t.symbol,
            openedAt: t.openedAt,
            side: t.side,
            // ⚠️ The split's NUMERATOR. Omitted, every repaired row would show a correct exit price
            // and a NULL P&L — measured on the first live run, and the reason it looked like the
            // repair had partly worked.
            quantity: t.quantity,
            currentPrice: t.exitPrice ?? null,
            pnl: null, // deliberately null: we do NOT feed back the unknown as if it were a result
          },
          accountId,
          { allowClosed: true },
        );
      } catch (err) {
        // ⚠️ Named and counted. The old `.catch(() => 0)` reported this row as merely
        // "not repairable", which is indistinguishable from "the ticket did not resolve".
        failure = `threw: ${(err as Error).message.slice(0, 80)}`;
        done = 0;
      }

      if (done) {
        repaired += done;
        this.logger.warn(
          `[${provider}] Repaired closed Trade ${t.symbol} (${t.id}, ticket ${t.brokerTicket}) — ` +
            'was finalised with no computable P&L; re-priced from deal history',
        );
      } else {
        notRepairable++;
        // Exactly ONE reason per row — a bare `notRepairable` count is the thing that made the first
        // run undiagnosable.
        note(failure ?? 'finaliser returned 0 (ticket did not resolve, or no deal history)');
      }
    }

    // A row that could not be repaired is REPORTED BY REASON, so the next reader does not have to
    // re-derive why 135 rows produced nothing.
    const breakdown = [...reasons.entries()].map(([k, v]) => `${v}× ${k}`).join('; ');
    this.logger.log(
      `[${provider}] P&L repair pass: examined ${candidates.length}, repaired ${repaired}, ` +
        `not repairable ${notRepairable}${breakdown ? ` (${breakdown})` : ''}`,
    );
    return { examined: candidates.length, repaired, notRepairable };
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

      // ── #1057 — the row EXISTS but is CLOSED, while the broker says the position is OPEN ────
      //
      // ⚠️ WHY THIS BLOCK IS HERE AND NOT A `create()`.
      //
      // The lookup above is scoped to `status: 'open'`, so a CLOSED row for the same ticket is
      // invisible to it — and the old code then fell through to 2c and tried to `create` a second
      // row. The unique index `Trade_provider_brokerTicket_key` is on `(provider, brokerTicket)`
      // and is NOT status-scoped, so that create could only ever raise. Every cycle. For every
      // affected position.
      //
      // MEASURED 2026-10-01: 56 occurrences across 8 symbols in one ~20-minute process lifetime —
      // and those 8 symbols were exactly the 8 rows closed by the partial-snapshot defect (#1058).
      // So the warn storm was the SOUND of #1058, not an independent fault. Both are fixed; this
      // one because a write path whose normal outcome is a constraint violation does not know its
      // own state, and because a genuine failure would have been indistinguishable from the 56.
      //
      // ── DECISION (2026-10-01, primary) ──
      // WHAT:      a ticket the broker reports OPEN, whose row is closed, is REOPENED — not
      //            skipped, and not duplicated.
      // WHY:       the broker cannot be wrong about whether it holds a position. The disagreement
      //            therefore means the DB is wrong, and the DB is the thing this path exists to
      //            correct. Skipping would leave the journal claiming a live position is closed,
      //            which is the state #1058 left three positions in for 1.5 hours.
      // INSTEAD OF: reporting the disagreement and leaving the row closed (rejected: it silences
      //            the warn but keeps the journal wrong, and the wrongness is invisible).
      // REVERSE BY: replace the `update` below with a `return 0` and a warn — the disagreement is
      //            then reported but not repaired.
      // REGISTER:  docs/SETTLED-DECISIONS.md
      // GUARD:     nest/src/modules/providers/position-sync-reopen.spec.ts
      const closedRow: any = await this.prisma.trade
        .findFirst({ where: { provider, brokerTicket: pos.brokerTicket } })
        .catch(() => null);
      if (closedRow) {
        this.logger.warn(
          `Position/DB DISAGREEMENT for ${provider} ${pos.symbol} ticket ${pos.brokerTicket}: ` +
            `the broker reports it OPEN but the row is '${closedRow.status}' ` +
            `(${closedRow.closeReason ?? 'no closeReason'}, closedAt ${closedRow.closedAt?.toISOString?.() ?? 'null'}). ` +
            'Reopening to match the broker — a close is only ever written from an authoritative snapshot (#1058).',
        );
        await this.prisma.trade.update({
          where: { id: closedRow.id },
          data: {
            status: 'open',
            closedAt: null,
            closeReason: null,
            // The row is an OPEN position again, so it is not a (fabricated) closed result. The
            // placeholder-zero P&L that accompanied the bogus close is left on the row because it
            // is exactly what an open row carries (#1044) — the flag is what lied, not the number.
            pnlInvalid: 0,
            pnlInvalidReason: null,
            sl: pos.sl ?? closedRow.sl,
            tp: pos.tp ?? closedRow.tp,
            brokerComment: pos.comment?.substring(0, 200) || closedRow.brokerComment,
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
        provider,        // ⚠️ Record WHICH account this trade belongs to (#889). Without it the row joins the
        // `accountId IS NULL` pool, which is visible to every account's sync — the leak that let
        // one broker's snapshot close another broker's live trades (#883).
        accountId: pos.accountId ?? null,        status: 'open',
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
   * May a sync scoped to `syncAccountId` judge this trade at all?
   *
   * ⚠️ THIS GUARD IS DEFENCE-IN-DEPTH, NOT THE PRIMARY PROTECTION (#883, #889)
   * --------------------------------------------------------------------------
   * `syncPositions()` reconciles by asking "is this trade's ticket in MY snapshot?" and treats
   * absence as closure. When one `provider` id covers several broker accounts — `MT5_ACTIVE_BROKERS=2,3`
   * runs MetaQuotes and Pepperstone under the single provider `mt5` — that question is only valid
   * for trades the sync can actually observe.
   *
   * The PRIMARY fix landed in #883: the adapter now asks EVERY broker, so another broker's ticket
   * is present in the snapshot and is never mistaken for "gone". This guard covers the case #883
   * cannot: two accounts that are genuinely both KNOWN, where a scoped sync still has no business
   * judging the other one's rows.
   *
   * | sync scope       | trade.accountId | may judge?                              |
   * |------------------|-----------------|------------------------------------------|
   * | null (all accts) | anything        | YES — the snapshot covers every account  |
   * | X                | X               | YES — same account                       |
   * | X                | Y ≠ X           | **NO — different account**               |
   * | X                | null            | YES — see below                          |
   *
   * ⚠️ WHY `null` IS DELIBERATELY ALLOWED THROUGH
   * ---------------------------------------------
   * The first version of this guard blocked unknown-account trades too. That was WRONG, and the
   * existing suite caught it: the 2026-09-10 regression (`finalizes a legacy row (no ticket, no
   * account) that is gone from the broker`) exists precisely because legacy `accountId IS NULL`
   * position rows must still be reconciled. Blocking them leaves a closed position sitting in
   * `position` forever, which also keeps the duplicate guard for that symbol shut.
   *
   * So "I don't know which broker this is" falls through to the pre-existing behaviour rather than
   * being refused. The safety for that case comes from #883 — a complete snapshot plus an
   * `authoritative` flag that requires every broker to answer — not from this test. Stated plainly
   * because the blocked-`null` version LOOKED safer and was strictly worse.
   */
  private mayJudgeTrade(
    trade: { accountId?: string | null },
    syncAccountId: string | null,
  ): boolean {
    if (!syncAccountId) return true;
    const tradeAccount = trade.accountId ?? null;
    // Unknown account: legacy row. Must remain reconcilable — see the reasoning above.
    if (tradeAccount === null) return true;
    return tradeAccount === syncAccountId;
  }

  /**
   * A position that was previously synced is no longer in the latest fetch —
   * it was closed (by the bot, by the user in MT5, or elsewhere). Finalize the
   * Trade with the real exit price from broker deal history and notify.
   * Returns 1 if a Trade was finalized, else 0.
   */
  private async finalizeClosedPosition(
    provider: string,
    dbPos: any,
    syncAccountId: string | null = null,
    /**
     * ⚠️ `allowClosed` exists for the #1014 REPAIR PASS, and for nothing else.
     *
     * A row that was already finalised as "position vanished" holds `status='closed'`, so the
     * `status: 'open'` filter below makes it unreachable — the reconciler can never revisit it and
     * the real P&L stays lost forever. Relaxing the filter here (rather than writing a second
     * deal-matching/split routine for closed rows) is deliberate: a copy of this pipeline is a
     * second thing to drift, and drift in a money path is the defect the repo warns about most.
     *
     * ⚠️ It does NOT weaken the normal paths: both callers that close a live position pass nothing,
     * so they keep the `status: 'open'` guarantee exactly as before.
     */
    opts: { allowClosed?: boolean } = {},
  ): Promise<number> {
    // Find the open trade — by broker ticket first, then symbol fallback.
    // `status: undefined` is OMITTED by Prisma rather than rejected, which is what makes
    // `allowClosed` a widening of the filter and not a broken one.
    const where: any = opts.allowClosed ? { provider } : { provider, status: 'open' };
    let trade: any = null;
    if (dbPos.brokerTicket) {
      trade = await this.prisma.trade.findFirst({ where: { ...where, brokerTicket: dbPos.brokerTicket } }).catch(() => null);
    }
    if (!trade) {
      trade = await this.prisma.trade
        .findFirst({ where: { ...where, symbol: dbPos.symbol, brokerTicket: null }, orderBy: { openedAt: 'desc' } })
        .catch(() => null);
    }

    // ⚠️ Out of scope — do NOT judge a trade this sync cannot see (#889). Checked BEFORE the deal
    // history lookup so an out-of-scope row costs nothing and cannot be finalised by a later path.
    if (trade && !this.mayJudgeTrade(trade, syncAccountId)) {
      this.logger.debug(
        `[${provider}] ${dbPos.symbol}: trade ${trade.id} belongs to account ` +
        `${trade.accountId ?? 'unknown'} — NOT judged by an account-${syncAccountId} sync`,
      );
      return 0;
    }

    // Real exit price from broker deal history (#470). Falls back to the last
    // known currentPrice/pnl snapshot if the broker doesn't expose deals.
    let exitPrice: number | null = dbPos.currentPrice ?? null;
    let realizedPnl: number | null = dbPos.pnl ?? null;
    let closedAt: Date | null = null;
    // MT5 `deal.reason` off the closing deal — the broker's OWN statement of why it closed.
    // `undefined` until the bridge is redeployed with the field; see close-reason.ts.
    let dealReason: number | undefined;
    let dealComment: string | undefined;
    // #777 — the COST COMPONENTS of the close, from the same deals the net is summed from.
    // NULL until (and unless) closing deals are found: "not captured" must be distinguishable
    // from "charged nothing", because on 0.01-lot FX a few pence decides whether a scalp works.
    let costComponents: { commission: number; swap: number; fee: number } | null = null;
    try {
      const adapter: any = this.adapterFactory?.create(provider);
      if (adapter?.getDeals && dbPos.openedAt) {
        const deals = await adapter.getDeals(new Date(dbPos.openedAt));
        // ── THE POSITION A ROW BELONGS TO, resolved from EITHER kind of ticket (#1014) ──
        //
        // `trade.brokerTicket` holds a POSITION id for every row written since #1014, and an ORDER
        // id for rows written before it (the bug this issue is about). The two namespaces never
        // intersect, so a direct positional match finds the new rows and NOTHING for the legacy
        // ones — which is how 22 position-bearing rows were finalised as "position vanished" while
        // the real position closed profitably.
        //
        // So: match on `positionId` first (the correct path), and when that yields nothing, treat
        // the stored value as an ORDER id and resolve it to its position. The indirection is one
        // hop and it is one-way — a legacy row can be repaired, and a row whose ticket is neither
        // still falls through to the symbol fallback exactly as before.
        const stored = dbPos.brokerTicket ? String(dbPos.brokerTicket) : null;
        let byPosition = stored
          ? deals.filter((d: any) => d.positionId === stored)
          : [];
        // ⚠️ True when this row's ticket names an ORDER, not the position — see the block below,
        // where it decides what the P&L split is allowed to assume.
        let resolvedFromOrder = false;
        if (byPosition.length === 0 && stored) {
          const asOrder = deals.find((d: any) => d.orderId === stored);
          if (asOrder?.positionId != null) {
            byPosition = deals.filter((d: any) => d.positionId === asOrder.positionId);
            if (byPosition.length > 0) {
              resolvedFromOrder = true;
              this.logger.log(
                `[${provider}] ${dbPos.symbol}: ticket ${stored} is an ORDER id written before #1014 — ` +
                  `resolved to position ${asOrder.positionId} (${byPosition.length} deals) so the close can be priced`,
              );
            }
          }
        }
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
            if (typeof lastDeal?.reason === 'number') dealReason = lastDeal.reason;
            // ⚠️ The comment can be STRICTLY BETTER evidence than the enum: our bridge stamps
            // `TCS:<origin>` on the deals it closes (#916, 2026-09-20), naming the actor. Measured
            // on the book: 33 of 41 closes carried EMPTY comments with reason 0 — a pattern the
            // enum alone cannot attribute to an actor or rule in as ours.
            if (typeof lastDeal?.comment === 'string') dealComment = lastDeal.comment;
          const filledVolume = exitDeals.reduce((sum: number, d: any) => sum + Number(d.volume || 0), 0);
          exitPrice = filledVolume > 0
            ? exitDeals.reduce((sum: number, d: any) => sum + Number(d.price || 0) * Number(d.volume || 0), 0) / filledVolume
            : Number(exitDeals[exitDeals.length - 1].price || 0);
          // ── DECISION (2026-09-28, primary) · REVERSED IN PART 2026-10-01 (#1014) ──
          // WHAT:      `realizedPnl` is now the row's SHARE of the position's net, not the whole
          //            net, whenever more than one `trade` row carries the same position id.
          // WHY:       On a NETTING account every order on a symbol shares ONE positionId. If N
          //            rows carry it, all N resolve to these same deals and EACH would book the
          //            whole net — a 4x overstatement on the 4-order A/B scale-ins, with plausible
          //            numbers and no error. `splitPnlByVolume` divides by the OPENING volume, so
          //            the N rows sum to the position instead of each claiming it.
          // INSTEAD OF: Booking the whole net to every row — what this site did before, and what
          //            the original marker chose to keep rather than store `result.positionId`
          //            without a split.
          // REVERSE BY: Pass `rowsSharing: 1` unconditionally, or delete the split call below.
          //            Both restore whole-net booking exactly; the module is pure and untouched.
          // REGISTER:  docs/SETTLED-DECISIONS.md row 43 (status changes to 🟡 — the split is
          //            volume-based, one-directional: it cannot yet be exercised by a live
          //            multi-row position, so only the arithmetic is canaried)
          // GUARD:     nest/src/modules/providers/pnl-split.spec.ts (18 cases, the incident's own
          //            numbers) · nest/scripts/audit-trade-pnl-attribution.cjs (on demand)
          //
          // ⚠️ THE ROWS-SHARING COUNT IS QUERIED, NEVER ASSUMED. The entire safety argument rests
          // on knowing whether more than one row owns this position, and a hardcoded 1 reintroduces
          // the overstatement. It is a single indexed count on `brokerTicket`.
          const openings = candidates.filter((d: any) => d.side !== closingSide);
          // ⚠️ HOW MANY `trade` ROWS CARRY THIS POSITION. Queried, never assumed — the whole safety
          // argument rests on it, and a hardcoded 1 reintroduces the overstatement.
          //
          // `rowsSharing` is a FACT about the data, and it stays `null` when we could not establish
          // it. It is deliberately NOT defaulted to 1 (the overstatement path) and NOT set to a
          // sentinel like 2 (which would be a fabricated fact — and the log below would print it as
          // "2 rows", a false statement to whoever reads the log trying to work out why a P&L is
          // missing). `null` means unknown, and `splitPnlByVolume` is given a count it refuses on.
          let rowsSharing: number | null = null;
          if (!dbPos.brokerTicket) {
            // No position id → the symbol fallback is in use, and that window identifies ONE
            // lifecycle by construction (`symbolFallbackSafe` above). One row owns it.
            //
            // ⚠️ This branch is why the count is not simply run anyway: `where: { brokerTicket:
            // undefined }` does NOT mean "no ticket" to Prisma — it OMITS the clause, so the count
            // would return EVERY trade for the provider. That is always > 1 and would send a
            // fallback row down the split path with an unrelated denominator.
            rowsSharing = 1;
          } else {
            try {
              rowsSharing = await this.prisma.trade.count({
                where: { brokerTicket: String(dbPos.brokerTicket), provider },
              });
            } catch {
              // Left null on purpose — see above. The refusal below is the outcome, not a guess.
              this.logger.warn(
                `[${provider}] ${dbPos.symbol}: could not count rows sharing ticket ${dbPos.brokerTicket} — ` +
                  'refusing to book a whole-net P&L; the row will read as unknown rather than overstated',
              );
            }
          }

          const split = splitPnlByVolume({
            closingDeals: exitDeals as any,
            openings: openings as any,
            rowQuantity: (dbPos as any).quantity,
            // `?? 2`: unknown sharing is passed as a count the split REFUSES on (its `rowsSharing <= 1`
            // branch would book the whole net, which is exactly the overstatement we are guarding).
            //
            // ⚠️ AND THE SAME GUARD APPLIES TO A LEGACY ROW, FOR A DIFFERENT REASON. A count by
            // `brokerTicket` is MEANINGLESS for a row whose ticket is an ORDER id: the four orders
            // that built one position carry four DIFFERENT tickets, so each counts **1** and every
            // one would take the sole-owner branch and book the whole net — the 4x overstatement
            // restored through the side door, on exactly the rows this repair exists for. We know
            // from the deal history that the row shares a position (that is how it was resolved),
            // so the volume split is forced: `share = rowQuantity / totalOpeningVolume` is the
            // authoritative division and it sums to the position whatever the ticket count says.
            rowsSharing: resolvedFromOrder ? 2 : (rowsSharing ?? 2),
          });
          realizedPnl = split ? split.realizedPnl : null;
          if (split) {
            this.logger.log(
              `[${provider}] ${dbPos.symbol}: booking ${split.realizedPnl.toFixed(2)} of ${split.netTotal.toFixed(2)} ` +
                `(${split.basis}, share ${split.share.toFixed(4)}, ${rowsSharing} row(s) on this position)`,
            );
          } else if (rowsSharing !== 1) {
            // ⚠️ Several rows — or an unknown number — with no computable share. `null` is the
            // honest answer: NOT the whole net (the overstatement) and NOT 0 (a claimed break-even).
            this.logger.warn(
              `[${provider}] ${dbPos.symbol}: ${rowsSharing ?? 'an unknown number of'} row(s) share this position ` +
                'but no volume share is computable — leaving P&L unset rather than booking the full net to one row',
            );
          }
          // `pnl` ALREADY includes these (it is profit + commission + swap + fee). Storing them
          // separately is what makes `grossPnl` computable without inventing a spread model.
          costComponents = {
            commission: exitDeals.reduce((s: number, d: any) => s + Number(d.commission || 0), 0),
            swap: exitDeals.reduce((s: number, d: any) => s + Number(d.swap || 0), 0),
            fee: exitDeals.reduce((s: number, d: any) => s + Number(d.fee || 0), 0),
          };
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
      // When nothing recorded a reason, derive one from the broker's deal `reason`.
      //
      // ⚠️ CORRECTED 2026-09-28 — this said "The running bridge does not forward that field yet,
      // so this yields `broker:unknown` — deliberately." That was TRUE when written and is now
      // STALE: the bridge DOES forward it. This reconciler reads `/history`, whose handler maps
      // `'reason': d.reason` per deal (scripts/mt5-bridge/mt5_bridge_v2.py), and a real stop-loss
      // was measured arriving here as `reason=4`. So a row with no recorded reason now gets a
      // genuine answer rather than a blanket `broker:unknown`.
      //
      // ⚠️ The comment was believed over the code by an agent (2026-09-28) and reported as a
      // current defect. A stale comment is not neutral: it reads as a measurement, and it costs
      // whoever believes it. Prefer the sentinel below, which is what "we truly cannot tell" means —
      // "The broker did it and did not say why" is the true statement; a guess is what made the
      // 2026-09-18 investigation impossible in the first place.
      // Precedence: a reason already ON the row (written by the closer at close time) > OUR comment
      // on the closing deal (names the actor, #916) > the broker's deal-reason enum > honest unknown.
      const fromComment = closeReasonFromComment(dealComment);
      const derivedCloseReason = fromComment ?? closeReasonFromDealReason(dealReason);
      const closeReason = trade.closeReason ?? derivedCloseReason;

      // ── WHAT it belonged to, not just why it closed (#949) ─────────────────
      //
      // This path finalises broker-closed rows (SL / terminal / anything the broker or the
      // user did in MT5). It wrote `closeReason` but never `strategy`, so of 186 closed trades
      // only TWO carried a strategy — and the Strategy Comparison page, the bot rating (#894)
      // and every per-bot number had nothing to group by.
      //
      // Precedence (see `resolveStrategyForClose`): the row's EXISTING value first — the open
      // or closing path may have written one and a reconciler must not erase it — then the
      // row's own `brokerComment` (`TCS <name> <score>`, written by us at open), then the
      // closing deal's comment. A deal comment is usually an origin stamp (`TCS:time-stop`,
      // #916): those are ACTORS, and the parser yields nothing for them rather than tagging a
      // strategy that does not exist.
      const strategy = resolveStrategyForClose(trade.strategy, trade.brokerComment, dealComment);

      // ── #777 — a close with NO price has NO result ─────────────────────────────
      // The old write was `pnl: realizedPnl ?? trade.pnl ?? null`, and `realizedPnl` could be a
      // last-snapshot profit of 0 — which is how SIX closed rows came to claim a break-even with
      // no exit price at all (swept 2026-09-22: pnl -> NULL, quarantined with a reason). A stale
      // snapshot is not a close result; an unknown stays unknown and is flagged, and the views
      // exclude-and-count it. An EXISTING pnl is never erased — only an absent one stays absent.
      const resolvedExit = exitPrice ?? trade.exitPrice ?? null;
      const exitKnown = resolvedExit != null;
      const pnlValue = exitKnown ? (realizedPnl ?? trade.pnl ?? null) : (trade.pnl ?? null);
      // ⚠️⚠️ #1044 — THE EXIT IS THE EVIDENCE. A NON-NULL `pnl` IS NOT.
      //
      // This line used to read `const pnlUnknown = pnlValue == null;`, so a row closed with NO
      // exit price was written `pnlInvalid: 0` **whenever it happened to carry any `pnl` at all**.
      // Every Trade is CREATED with `pnl: 0` (`position-sync` open path, `signal-actions`), so
      // that value was almost always present — and a placeholder zero was recorded as a VALID
      // break-even result.
      //
      // Measured 2026-10-01: **21** such rows (`origin=strategy`, `source=meta-stack`,
      // `closeReason=broker:unknown`, real `brokerTicket`, `exitPrice IS NULL`, `pnl = 0`,
      // `pnlInvalid = 0`) — and still being written: the newest was **that morning**. They are
      // invisible to `pnlInvalid`-only filters, which is why two consumers of the same table
      // disagreed about its size (264 rows vs 243) with no error anywhere.
      //
      // The 2026-09-22 sweep that "fixed" this nulled `pnl` on six rows, which made
      // `pnlValue == null` true FOR THOSE SIX. That treated the symptom: any row whose `pnl` was
      // still 0 kept passing, which is exactly the 21. The rule now keys on the exit, so it
      // cannot be defeated by a placeholder surviving on the row.
      //
      // ⚠️ Deliberately NOT `!exitKnown` on its own: a NON-zero `pnl` with an unknown exit price
      // is a real number recovered from deal history and must be preserved. Only a `0` is
      // ambiguous — see `placeholderZeroReason()` in `common/trading/pnl-population.ts`, which
      // makes exactly this distinction and is the single owner of the rule.
      const exitUnknownZero = !exitKnown && pnlValue === 0;
      const pnlUnknown = pnlValue == null || exitUnknownZero;

      await this.prisma.trade.update({
        where: { id: trade.id },
        data: {
          status: 'closed',
          exitPrice: resolvedExit,
          pnl: pnlValue,
          // ⚠️ #1045 — READ THE PROVENANCE, NOT JUST THE VALUE.
          //
          // When deal history yielded a close deal, `closedAt` above was already set to the
          // broker's OWN exit time. When it did not, this fallback writes `now` — the moment the
          // APP NOTICED the position had gone. Both look identical on the row, so
          // `closedAt - openedAt` is a trade duration for some rows and reconciliation latency for
          // others.
          //
          // Measured 2026-10-01: 231 rows with an exit price average 15.7 h; the 134 without one
          // average **587.5 h (24 days)** on bots that scalp on minute cadences. Nothing reported it.
          //
          // ⚠️ DO NOT null this to signal the uncertainty — `closedAt IS NOT NULL` is the "this
          // trade is closed" predicate across the app, so a null RE-OPENS the trade. The value
          // stays; consumers ask `closeTimeIsBrokerDerived()` (`common/trading/close-time.ts`)
          // before reporting a duration.
          closedAt: closedAt ?? new Date(),
          closeReason,
          ...(strategy ? { strategy } : {}),
          ...(costComponents
            ? {
                commission: Math.round(costComponents.commission * 100) / 100,
                swap: Math.round(costComponents.swap * 100) / 100,
                fee: Math.round(costComponents.fee * 100) / 100,
              }
            : {}),
          ...(pnlUnknown
            ? {
                pnlInvalid: 1,
                // The reason distinguishes the two causes on purpose: an existing reader looks for
                // the `exit-unknown:` prefix, and #1044 (a placeholder zero that no flag caught) is
                // a DIFFERENT fault from a vanished position with no deal history at all.
                pnlInvalidReason: exitUnknownZero
                  ? 'exit-unknown: closed with no exit price; pnl = 0 is a placeholder, not a break-even (#1044)'
                  : 'exit-unknown: position vanished; no broker deal history and no last price',
              }
            : {
                // ⚠️ CLEARED WHEN THE P&L IS NOW KNOWN (#1014). Without this the repair pass writes
                // a correct `pnl` and LEAVES `pnlInvalid: 1` standing — a row that reads as
                // quarantined while holding a good number, and every view that excludes invalid
                // rows would go on hiding the very P&L the repair just recovered. The flag and the
                // value must move together or the repair is invisible.
                pnlInvalid: 0,
                pnlInvalidReason: null,
              }),
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

    // ⚠️ ONLY DELETE A POSITION ROW THAT EXISTS (#1014, found live 2026-10-01).
    //
    // This method is called from two places, and only ONE of them has a `position` row:
    //
    //   • `syncPositions()` passes a row it read FROM `position` — it has an `id`, and deleting it
    //     is the point (the position is gone from the broker).
    //   • `reapStrandedTrades()` and the #1014 repair pass pass a SYNTHESISED object built from a
    //     `trade` row — there is no `position` row at all, so `dbPos.id` is `undefined`.
    //
    // `delete({ where: { id: undefined } })` is not a no-op: Prisma REJECTS it
    // (`PositionWhereUniqueInput needs at least one of id or provider_brokerTicket`) and THROWS —
    // **after** the trade above has already been updated. Both callers wrap the call in
    // `.catch(() => 0)`, so the throw is invisible: the row is correctly closed, the function
    // reports 0, and the caller logs nothing.
    //
    // Measured live: the #871 ticketed reaper did exactly that — it closed a row and reported
    // "0 reaped". Its spec passed because `position.delete` is a jest mock that accepts any argument,
    // so the one case that mattered (a synthesised object) was never exercised.
    if (dbPos.id != null) {
      await (this.prisma as any).position.delete({ where: { id: dbPos.id } }).catch((err: Error) => {
        // A failed cleanup must not undo a recorded close, but it must not be silent either.
        this.logger.warn(`[${provider}] could not remove position row ${dbPos.id}: ${err.message}`);
      });
    }
    return 1;
  }

  getLastSyncTime(): Date | null { return this.lastSyncedAt; }

  /** Most recent sync outcome (upserted/created/closed) — for status dashboards. */
  getLastSyncResult(): { synced: number; created: number; closed: number } | null {
    return this.lastResult;
  }
}
