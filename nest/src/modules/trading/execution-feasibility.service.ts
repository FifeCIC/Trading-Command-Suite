import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { DuplicateGuardService } from './duplicate-guard.service';
import { GlobalDiversificationService } from '../diversification/global-diversification.service';

/**
 * ExecutionFeasibilityService — #723 shared trade-acceptance assessment.
 * ======================================================================
 * ONE library, TWO phases. The same checks that gate a MANUAL trade at
 * execution time also annotate the signal at GENERATION time, so the card
 * shows execution blockers WITH change-hints before any click.
 *
 * Phase A (generation) — buildBestLadder calls assess() with the positions it
 * already fetched for holdsCfd. Cheap, no extra broker round-trips beyond the
 * cached symbol list.
 *
 * Phase B (execution) — placeManualTrade calls the SAME assess() as the
 * authoritative re-check (state can change between generation and click).
 *
 * Every blocker carries:
 *   key     — stable identifier for logging/counting (#717)
 *   message — what is wrong
 *   hint    — what the user COULD change to reach a different outcome
 *             (no dead-end messages; "no action available" stated explicitly)
 */

export interface FeasibilityBlocker {
  key: string;
  message: string;
  hint: string;
}

export interface FeasibilityResult {
  feasible: boolean;
  blockers: FeasibilityBlocker[];
}

@Injectable()
export class ExecutionFeasibilityService {
  private readonly logger = new Logger(ExecutionFeasibilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly duplicateGuard: DuplicateGuardService,
    private readonly diversification: GlobalDiversificationService,
  ) {}

  /**
   * Assess whether a trade on `symbol` via `brokerId` would be accepted.
   *
   * `positions` (generation phase) reuses the ladder's single per-run fetch;
   * at execution it is omitted and fetched fresh. `marketStatus` carries the
   * score's own tradability state (open === false blocks both phases).
   */
  async assess(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    brokerId: string;
    protocolId?: string | null;
    positions?: any[];
    marketStatus?: { open: boolean; reason?: string | null } | null;
  }): Promise<FeasibilityResult> {
    const { symbol, side, brokerId, protocolId } = params;
    const blockers: FeasibilityBlocker[] = [];
    const ticker = symbol.toUpperCase();
    const adapter = this.adapterFactory.create(brokerId);

    // ── 1. Broker symbol availability (#719) — cached bridge symbol list ──
    try {
      const names = await (adapter as any)?.getSymbols?.();
      if (names && names.size > 0 && !names.has(ticker)) {
        blockers.push({
          key: 'symbol-unavailable',
          message: `Broker ${brokerId} has no ${ticker} instrument`,
          hint: 'No action available — this symbol cannot trade on this broker',
        });
      }
    } catch {
      /* unknown availability — do not block */
    }

    // ── 2. Market status (the score's own tradability state) ──
    if (params.marketStatus && params.marketStatus.open === false) {
      blockers.push({
        key: 'market-closed',
        message: `Market closed for ${ticker} — manual trade blocked (${params.marketStatus.reason || 'closed'})`,
        hint: 'Wait for the market to open',
      });
    }

    // ── 3. Duplicate-position policy (#721) — one-per-symbol default ──
    let positions: any[] = params.positions ?? [];
    if (!params.positions) {
      try {
        if (adapter?.getPositions) positions = (await adapter.getPositions()) ?? [];
      } catch {
        positions = [];
      }
    }
    const open = positions.filter(p =>
      String(p.symbol ?? p.ticker ?? '').toUpperCase() === ticker,
    );

    if (open.length > 0) {
      // Policy knob = the EXISTING TradingStrategy.maxPyramidTiers (one place).
      let tiers = 1;
      let baseSize = 0.01;
      try {
        const bot: any = await this.prisma.tradingStrategy.findFirst({
          where: { active: true, symbol: ticker },
          orderBy: { updatedAt: 'desc' },
        });
        tiers = Number(bot?.maxPyramidTiers ?? 1) || 1;
        baseSize = Number(bot?.baseSize ?? 0.01) || 0.01;
      } catch { /* default policy */ }

      if (tiers <= 1) {
        blockers.push({
          key: 'duplicate-position',
          message: `Duplicate blocked for ${ticker}: ${open.length} open position(s) on ${brokerId.toUpperCase()}. Close existing or wait for cooldown.`,
          hint: `Close ${open.map(p => p.ticket ? `#${p.ticket}` : '').filter(Boolean).join(', ') || 'the existing position'} — or set maxPyramidTiers > 1 on the bot to allow scale-in`,
        });
      } else {
        // Scale-in path: same profit + SL-locked conditions as the retired
        // pyramid logic (#721 decisions) — never a second implementation.
        const entry = open[0];
        const profit = Number(entry?.profit ?? entry?.unrealizedPnl ?? 0);
        const sl = Number(entry?.sl ?? entry?.stopLoss ?? 0);
        const price = Number(entry?.priceCurrent ?? entry?.currentPrice ?? entry?.avgCost ?? 0);
        const lockedIn = sl > 0 && (
          side === 'BUY' ? sl >= price : sl <= price
        );
        const tier = Math.max(open.length, Math.ceil((Number(entry?.volume ?? 1)) / baseSize));

        if (profit <= 0) {
          blockers.push({
            key: 'scale-in-not-green',
            message: `Scale-in blocked for ${ticker}: existing position is not in profit`,
            hint: 'Close the losing position first — scaling into a loser is not allowed',
          });
        } else if (!lockedIn) {
          blockers.push({
            key: 'scale-in-not-locked',
            message: `Scale-in blocked for ${ticker}: existing position's profit is not locked in`,
            hint: 'Set a broker SL at breakeven-or-better on the open position',
          });
        } else if (tier >= tiers) {
          blockers.push({
            key: 'max-tier',
            message: `Pyramid tier limit reached (${tier}/${tiers})`,
            hint: 'Raise maxPyramidTiers on the bot or wait for the position to close',
          });
        }
        // otherwise: scale-in allowed — falls through to remaining gates.
      }
    }

    // ── 4. Diversification pre-check (same check the bot runs) ──
    try {
      const div = await this.diversification.checkPreTrade(ticker, brokerId);
      if (div.blocked) {
        blockers.push({
          key: 'diversification',
          message: `Diversification: ${div.reason}`,
          hint: 'Reduce exposure or close another position',
        });
      }
    } catch {
      /* non-fatal */
    }

    // ── 5. 60s symbol cooldown — DB-backed mirror of the bot's cooldown ──
    try {
      const recentTrade = await this.prisma.trade.findFirst({
        where: { symbol: ticker, openedAt: { gte: new Date(Date.now() - 60_000) } },
        orderBy: { openedAt: 'desc' },
      });
      if (recentTrade) {
        blockers.push({
          key: 'cooldown',
          message: `${ticker} traded within the last 60s — cooldown active`,
          hint: 'Wait a few seconds and try again',
        });
      }
    } catch {
      /* non-fatal */
    }

    // Duplicate guard as final structural check (execution-phase parity).
    if (blockers.length === 0 && open.length === 0) {
      try {
        const dup = await this.duplicateGuard.checkDuplicate(ticker, brokerId, protocolId ?? undefined);
        if (dup.blocked) {
          blockers.push({
            key: 'duplicate-position',
            message: dup.reason || 'Duplicate position',
            hint: 'Close the existing position or wait for cooldown',
          });
        }
      } catch {
        /* non-fatal */
      }
    }

    return { feasible: blockers.length === 0, blockers };
  }
}
