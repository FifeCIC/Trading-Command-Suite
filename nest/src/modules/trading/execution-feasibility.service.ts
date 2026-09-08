import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { DuplicateGuardService } from './duplicate-guard.service';
import { GlobalDiversificationService } from '../diversification/global-diversification.service';
import { PyramidPolicyService } from './pyramid-policy.service';

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
    private readonly pyramidPolicy: PyramidPolicyService,
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

    // ── 3. Duplicate-position / scale-in policy (#721) — ONE shared library ──
    let positions: any[] = params.positions ?? [];
    if (!params.positions) {
      try {
        if (adapter?.getPositions) positions = (await adapter.getPositions()) ?? [];
      } catch {
        positions = [];
      }
    }

    const pyramid = await this.pyramidPolicy.evaluate({
      symbol: ticker,
      side,
      brokerId,
      positions,
    });
    for (const b of pyramid.blockers) {
      blockers.push({ key: b.key, message: b.message, hint: b.hint });
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
    if (blockers.length === 0 && !pyramid.hasOpenPosition) {
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
