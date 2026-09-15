import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { Mt5SymbolRouter } from '../providers/mt5/mt5-symbol-router.service';
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

/**
 * MT5 `SYMBOL_TRADE_MODE_FULL` — the ONLY trade mode at which the bridge's `/order`
 * pre-flight (`scripts/mt5-bridge/mt5_bridge_v2.py`) will accept an order.
 * 0 = disabled, 1 = long only, 2 = short only, 3 = close only.
 *
 * ⚠️ The value is PER BROKER, not per symbol: US500 reports 0 on MetaQuotes (:5000)
 * and 4 on Pepperstone (:5001). Keep this in step with the bridge's own constant.
 */
const SYMBOL_TRADE_MODE_FULL = 4;

@Injectable()
export class ExecutionFeasibilityService {
  private readonly logger = new Logger(ExecutionFeasibilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly duplicateGuard: DuplicateGuardService,
    private readonly diversification: GlobalDiversificationService,
    private readonly pyramidPolicy: PyramidPolicyService,
    private readonly symbolRouter?: Mt5SymbolRouter,
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
    /**
     * Order size in lots. EXECUTION phase only — the ladder does not know which size it
     * will be asked for, so generation-time calls omit it and the volume-floor check
     * (which needs it) simply does not run in that phase.
     */
    size?: number | null;
  }): Promise<FeasibilityResult> {
    const { symbol, side, brokerId, protocolId } = params;
    const blockers: FeasibilityBlocker[] = [];
    const ticker = symbol.toUpperCase();
    const adapter = this.adapterFactory.create(brokerId);

    // ── 1. Broker symbol availability (#719) — cached bridge symbol list ──
    // Check the broker that ACTUALLY serves this symbol (per symbol_route), not
    // just the default bridge — otherwise a symbol routed to another broker
    // (e.g. GER40 on Pepperstone) is wrongly reported unavailable (#747).
    //
    // ⚠️ LISTED ≠ TRADEABLE — see 1b below. These two checks are deliberately
    // separate: this one answers "does the broker quote it?", which is NOT enough to
    // justify offering a trade.
    const adapterId = (adapter as any)?.id;
    const routedBrokerId = adapterId === 'mt5' ? this.symbolRouter?.getBrokerId(ticker) : undefined;
    const brokerSymbol = (adapterId === 'mt5' ? this.symbolRouter?.getBrokerSymbol(ticker) : ticker) || ticker;
    try {
      const raw = await (adapter as any)?.getSymbols?.(routedBrokerId);
      const names: Set<string> | null = raw instanceof Set
        ? raw
        : Array.isArray(raw) ? new Set(raw.map((n: any) => String(n).toUpperCase())) : null;
      if (names && names.size > 0 && !names.has(brokerSymbol.toUpperCase()) && !names.has(ticker)) {
        blockers.push({
          key: 'symbol-unavailable',
          message: `Broker ${brokerId} has no ${ticker} instrument`,
          hint: 'No action available — this symbol cannot trade on this broker',
        });
      }
    } catch {
      /* unknown availability — do not block */
    }

    // ── 1b. Broker TRADE MODE and VOLUME FLOOR — the /order pre-flight, mirrored ──
    //
    // The bridge refuses an order when `tradeMode !== 4` or `volume < volumeMin`, and it
    // refuses BEFORE calling order_send. Neither fact was visible here, so a card could
    // read fully actionable while the broker would reject the click. Measured 2026-09-15:
    // US500 — listed on BOTH bridges, `tradeMode 0` (disabled) on MetaQuotes, 4 on
    // Pepperstone, and `volumeMin 0.1` on both against a manual default of 0.01 lots.
    //
    // ⚠️ Unknown (broker unreachable → `null`) must NOT block: "we could not ask" is not
    // evidence of untradeability, and the bridge still refuses safely at click time.
    try {
      const tradability = await (adapter as any)?.getSymbolTradability?.(routedBrokerId);
      const info = tradability instanceof Map
        ? (tradability.get(brokerSymbol.toUpperCase()) ?? tradability.get(ticker))
        : undefined;
      if (info && info.tradeMode !== SYMBOL_TRADE_MODE_FULL) {
        blockers.push({
          key: 'symbol-not-tradeable',
          message: `Broker ${routedBrokerId ?? brokerId} reports ${ticker} as NOT tradeable (trade mode ${info.tradeMode})`,
          hint: 'Route the symbol to a broker that reports it tradeable (symbol_route), or trade a symbol this broker accepts',
        });
      }
      if (info && info.volumeMin != null && params.size != null && params.size < info.volumeMin) {
        blockers.push({
          key: 'size-below-minimum',
          message: `${params.size} lots is below ${brokerSymbol}'s ${info.volumeMin}-lot minimum on broker ${routedBrokerId ?? brokerId}`,
          hint: `Raise the manual trade size to at least ${info.volumeMin} lots (Settings → manual trade defaults)`,
        });
      }
    } catch {
      /* unknown trade mode — do not block */
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
