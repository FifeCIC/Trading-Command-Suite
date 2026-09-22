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
          select: { id: true, quantity: true, lastQuotedAt: true },
        });
        const live = positions.filter((p: any) => isLivePosition(p.lastQuotedAt));
        staleIgnoredPositions = positions.length - live.length;
        existingPositions = live.length;
        if (existingPositions > 0) {
          reasons.push(`${existingPositions} open position(s) on ${brokerId.toUpperCase()}`);
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
          select: { id: true, openedAt: true },
          orderBy: { openedAt: 'desc' },
        });
        recentTrades = trades.length;
        if (recentTrades > 0) {
          reasons.push(`${recentTrades} recent trade(s) in last ${cooldown}min`);
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
