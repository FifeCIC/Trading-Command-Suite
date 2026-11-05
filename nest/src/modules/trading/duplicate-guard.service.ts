/**
 * DuplicateGuardService
 * =====================
 * Prevents duplicate position execution across all trade flows:
 * speed trading, automation, keyboard, scan-to-trade.
 *
 * Strategy:
 *   1. Check open positions for this symbol from all brokers
 *   2. Check recent trades for this symbol+protocol within cooldown window
 *   3. Block if either check matches
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { isLivePosition } from '../../common/utils/position-freshness';

export interface DuplicateCheckResult {
  blocked: boolean;
  reason?: string;
  existingPositions?: number;
  recentTrades?: number;
  /** #745 — projection rows ignored because no sync refreshed them inside the live window. */
  staleIgnoredPositions?: number;
  cooldownRemaining?: number; // seconds until cooldown expires
}

@Injectable()
export class DuplicateGuardService {
  private readonly logger = new Logger(DuplicateGuardService.name);

  /** Default cooldown in minutes */
  private readonly DEFAULT_COOLDOWN_MINUTES = 5;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if a trade would create a duplicate position.
   *
   * @param symbol     — ticker to check (e.g. 'EURUSD', 'AAPL')
   * @param brokerId   — broker to check against (e.g. 'mt5', 'trading212')
   * @param protocolId — protocol/strategy for recent-trade check (optional)
   * @param cooldownMinutes — override default cooldown (optional)
   */
  async checkDuplicate(
    symbol: string,
    brokerId: string,
    protocolId?: string,
    cooldownMinutes?: number,
    accountId?: string | null,
    /**
     * The ACCOUNT's position model, from the broker — `netting` | `exchange` | `hedging` | `unknown`.
     *
     * ⚠️ ADDED 2026-11-04. This guard blocks when ANY live position exists on symbol+broker+account,
     * which silently assumed that a second order would MERGE. That is true on a netting account and
     * false on a hedging one. Measured the same day: broker 2 (MetaQuotes-Demo) reports `netting`,
     * broker 3 (PepperstoneUK-Demo) reports `hedging`. So the same guard was enforcing a broker rule
     * on one account and an arbitrary policy on the other — and the refusal text named neither.
     *
     * `hedging`  -> an additional position OPENS separately. Allowed here; the OTHER limits still
     *               apply (per-symbol risk cap, max open positions, portfolio risk, cooldown).
     * anything else, INCLUDING unknown -> current behaviour. Unknown must never mean "allow": the
     *               consequence of being wrong is a merge or a reversal on a live account, and this
     *               file's existing rule is that an unverifiable duplicate check fails CLOSED.
     */
    positionModel?: string | null,
  ): Promise<DuplicateCheckResult> {
    const ticker = symbol.toUpperCase();
    const cooldown = cooldownMinutes ?? this.DEFAULT_COOLDOWN_MINUTES;
    const reasons: string[] = [];
    let existingPositions = 0;
    let recentTrades = 0;
    let staleIgnoredPositions = 0;

    // Fail-closed: if the DB is unavailable we cannot verify duplicates, so we
    // BLOCK the trade rather than silently allowing duplicate positions.
    if (!this.prisma.isAvailable) {
      this.logger.warn(`Duplicate guard: DB unavailable — failing closed for ${ticker} on ${brokerId}`);
      return {
        blocked: true,
        reason: `Database unavailable — cannot verify duplicates for ${ticker} on ${brokerId}`,
        existingPositions: 0,
        recentTrades: 0,
      };
    }

    // 1. Check open positions for this symbol+broke
    //
    // ⚠️ LIVE ONLY (#745). `Position` is a PROJECTION of the broker, and a row a sync has stopped
    // refreshing is not evidence that anything is open — it is evidence that the projection is
    // stale. The old query counted every row for the symbol, so a frozen row blocked new trades
    // indefinitely (observed: `DUPLICATE BLOCKED: XAUUSD — 1 open position(s) on MT5` after the
    // position had closed at the broker). Freshness is the SHARED rule from #778 — imported, not
    // re-implemented, so the durable copy cannot drift from the one risk/diversification use.
    if (this.prisma.isAvailable) {
      try {
        const positions = await this.prisma.position.findMany({
          where: { symbol: ticker, provider: brokerId },
          select: { id: true, quantity: true, lastQuotedAt: true, accountId: true },
        });
        // #1079 — scope to the incoming order's account. Filtered in JS rather than in the
        // WHERE clause so a row with a NULL accountId still counts (a scoped query would drop
        // nulls silently — the defect class this repo keeps re-finding).
        const scoped = accountId
          ? positions.filter((p: any) => !p.accountId || String(p.accountId) === String(accountId))
          : positions;
        const live = scoped.filter((p: any) => isLivePosition(p.lastQuotedAt));
        staleIgnoredPositions = scoped.length - live.length;
        existingPositions = live.length;
        // ⚠️ POSITION MODEL (2026-11-04). On a HEDGING account an extra order on the same symbol
        // opens its own position, so an existing one is not a duplicate — it is a second trade. The
        // count is still recorded (and the caller can report it) but it does not block. Everything
        // else in this file keeps applying, and so do the risk caps downstream.
        //
        // Netting / exchange / unknown keep the ORIGINAL behaviour: on netting the broker would
        // merge or reverse the existing position, which silently rewrites a position another bot
        // owns, and "unknown" must never read as permission.
        const hedging = String(positionModel || '').toLowerCase() === 'hedging';
        if (existingPositions > 0 && !hedging) {
          reasons.push(
            `${existingPositions} open position(s) on ${brokerId.toUpperCase()}` +
              (accountId ? ` account ${accountId}` : '') +
              ` (account is ${positionModel || 'unknown-model'} — a second order would ${positionModel === 'netting' ? 'MERGE with it' : 'not be checked'})`,
          );
        } else if (existingPositions > 0 && hedging) {
          // Visible, because "we allowed it" is a decision that must not be invisible.
          this.logger.log(
            `Duplicate guard: ${ticker} already has ${existingPositions} live position(s) on ` +
              `${brokerId.toUpperCase()}${accountId ? ` account ${accountId}` : ''} — account model is ` +
              'hedging, so an additional position is allowed',
          );
        }
        if (staleIgnoredPositions > 0) {
          // VISIBLE, not silent: ignoring rows is a decision, and a decision nobody can see is
          // indistinguishable from a guard that stopped working.
          this.logger.warn(
            `Duplicate guard: ignored ${staleIgnoredPositions} stale position row(s) for ${ticker} on ${brokerId} ` +
              '(not refreshed by a sync within the live window — they are not evidence of an open position)',
          );
        }
      } catch (err) {
        this.logger.warn(`Position check failed for ${ticker}: ${(err as Error).message}`);
      }
    }

    // 2. Check recent trades for this symbol within cooldown window
    if (this.prisma.isAvailable) {
      try {
        const cooldownDate = new Date(Date.now() - cooldown * 60_000);
        const where: any = {
          symbol: ticker,
          openedAt: { gte: cooldownDate },
          status: { in: ['open', 'filled'] },
        };
        if (protocolId) where.strategy = protocolId;

        const trades = await this.prisma.trade.findMany({
          where,
          select: { id: true, openedAt: true, accountId: true },
          orderBy: { openedAt: 'desc' },
        });
        // #1079 — same account scoping as the position check above, same conservative rule for
        // rows whose accountId is empty.
        const scopedTrades = accountId
          ? trades.filter((t: any) => !t.accountId || String(t.accountId) === String(accountId))
          : trades;
        recentTrades = scopedTrades.length;
        if (recentTrades > 0) {
          reasons.push(
            `${recentTrades} recent trade(s) in last ${cooldown}min` +
              (accountId ? ` on account ${accountId}` : ''),
          );
        }
      } catch (err) {
        this.logger.warn(`Trade check failed for ${ticker}: ${(err as Error).message}`);
      }
    }

    const blocked = reasons.length > 0;
    const reason = blocked
      ? `Duplicate blocked for ${ticker}: ${reasons.join('; ')}. Close existing or wait for cooldown.`
      : undefined;

    if (blocked) {
      this.logger.warn(`DUPLICATE BLOCKED: ${ticker} on ${brokerId} — ${reasons.join(', ')}`);
    }

    return {
      blocked,
      reason,
      existingPositions,
      recentTrades,
      staleIgnoredPositions,
    };
  }

  /**
   * Quick check — returns true if trade should be blocked.
   * Convenience for inline guards.
   */
  async isBlocked(
    symbol: string,
    brokerId: string,
    protocolId?: string,
    cooldownMinutes?: number,
  ): Promise<boolean> {
    const result = await this.checkDuplicate(symbol, brokerId, protocolId, cooldownMinutes);
    return result.blocked;
  }
}
