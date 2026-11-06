import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { Mt5SymbolRouter, orderRouteProblems } from '../providers/mt5/mt5-symbol-router.service';
import { DuplicateGuardService } from './duplicate-guard.service';
import { GlobalDiversificationService } from '../diversification/global-diversification.service';
import { PyramidPolicyService } from './pyramid-policy.service';

/**
 * ExecutionFeasibilityService — #723 shared trade-acceptance assessment.
 * ======================================================================
 *
 * WHAT KIND OF THING THIS IS (vocabulary)
 * --------------------------------------
 * This is a GUARDRAIL: a rule that constrains what an automated system may do, enforced OUTSIDE the
 * component that made the decision. It is also a CONDITIONAL EDGE in the pipeline graph — pass → send,
 * block → hold. Both words carry the same design constraint, and it is the reason this file must never
 * grow a way to OVERRIDE its own verdict: a component allowed to overrule its own guardrail is not
 * enforcing one. The caller may explain a block, surface a hint, or ask for a different symbol; it
 * cannot turn a block into a pass.
 *
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
  /**
   * Machine-readable facts behind the blocker, when the blocker has one.
   *
   * ⚠️ ADDED 2026-11-06 (#835). `size-below-minimum` already computed the exact floor and the
   * broker it came from — but only into the human `message`, so a caller that wanted to ACT on it
   * (raise the size to the minimum) would have had to parse English. That is how a second, drifting
   * floor lookup gets written. Carrying the number here means there is one source for it.
   */
  params?: {
    /** Volume floor in lots, as the broker reports it. */
    floor?: number;
    /** Broker whose floor this is. A number or a broker NAME — `symbol_route.brokerId` is an int
     *  while `broker_config.id` is a name, so this cannot be typed as one of them. */
    broker?: number | string | null;
    /** Order size that was rejected, in lots. */
    size?: number;
  };
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
   * The account's position model, cached briefly.
   *
   * ⚠️ `unknown` is a legitimate answer and is returned as such — it makes both the scale-in policy
   * and the duplicate guard fall back to their conservative rule. It is never coerced to 'netting'.
   */
  private positionModelCache = new Map<string, { at: number; model: string | null }>();

  /**
   * ⚠️ KEYED BY ROUTED BROKER, AND ASKED OF THE ROUTED BROKER (2026-11-05).
   *
   * This used to be keyed by the ADAPTER id (`'mt5'`) and answered from `adapter.getAccount()`,
   * which reads the DEFAULT bridge. So `positionModel` was always the PRIMARY account's — measured
   * live: GER40 routes to account 3 (`hedging`) and was judged with account 2's `netting`, so
   * `pyramid-policy` treated the account as netting and refused a second position. That refusal
   * ("Duplicate blocked for GER40: 1 open position(s)") IS what the decision log showed every two
   * minutes from 14:08 to 14:28, and it is why the per-bot pyramid scoping never engaged.
   *
   * A cache key shared by two accounts is the same defect one layer down — netting on the primary
   * would have been cached and reused for the hedged account for a minute at a time.
   */
  private async accountPositionModel(routedBrokerId: number | null | undefined, adapter: any): Promise<string | null> {
    const key = routedBrokerId != null ? `broker:${routedBrokerId}` : 'primary';
    const hit = this.positionModelCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.model;
    let model: string | null = null;
    try {
      const acct = await adapter?.getAccount?.(routedBrokerId ?? undefined);
      const raw = acct && (acct as any).positionModel;
      if (typeof raw === 'string' && raw.length > 0) model = raw;
    } catch { model = null; }
    this.positionModelCache.set(key, { at: Date.now(), model });
    return model;
  }

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
     * Order size in lots. Both phases now supply it: EXECUTION passes the size actually being
     * placed, and GENERATION passes the persisted manual-trade default so the volume-floor check
     * can appear on the card BEFORE the click. (It used to be omitted at generation, so
     * `size-below-minimum` could never fire there — the operator always learned after committing,
     * which inverted the two-phase design. #914.)
     */
    size?: number | null;
    /**
     * The bot about to trade. Given, the scale-in policy uses ITS `maxPyramidTiers` and — on a
     * hedging account — only counts positions THIS bot opened, so two bots can hold one symbol.
     *
     * ⚠️ ADDED 2026-11-04. Optional on purpose: the manual path and the ladder (which has no bot)
     * legitimately pass nothing, and omitting it keeps the previous behaviour exactly.
     */
    strategyId?: string | null;
    /** The account's position model (`netting` | `exchange` | `hedging`), when known. */
    positionModel?: string | null;
  }): Promise<FeasibilityResult> {
    const { symbol, side, brokerId, protocolId } = params;
    const blockers: FeasibilityBlocker[] = [];
    const ticker = symbol.toUpperCase();
    const adapter = this.adapterFactory.create(brokerId);

    // ── Route integrity — the FIRST question: can an order reach a broker at all? (#914) ──
    //
    // The checks below ask ONE bridge for its rules about this symbol. That question is only
    // meaningful when the route actually targets an MT5 bridge. Measured 2026-09-20: a BTC
    // manual trade was refused "0.1 lots is below BTC's 1-lot minimum on broker 0" — every part
    // wrong. The route was `→ binance, brokerId 0, brokerSymbol NULL`; `getUrl(0)` returned the
    // DEFAULT bridge because `0` is falsy; and the bare ticker matched `Nasdaq\ETF\BTC`, so a
    // crypto position was measured against a US ETF's lot floor. The refusal named a broker that
    // was never asked, with a "fix" (raise to 1 lot) that would have multiplied the position.
    //
    // ⚠️ Do NOT "loosen" this by skipping the check. The same problems are what
    // `Mt5Adapter.placeOrder()` and `Mt5TradingService.placeOrder()` refuse on — one shared
    // implementation (`orderRouteProblems`), so the card, the click and the broker agree.
    const adapterId = (adapter as any)?.id;
    // ⚠️ `resolveForOrder`, NOT `resolve` (#1002). The card must show the route the ORDER will
    // actually travel — and since #1002 the order path may prefer a broker that can trade the
    // symbol over the default one. Using the feed route here would let the card say "broker 2"
    // while the click went to broker 3, which is the card/click/broker disagreement this shared
    // check exists to prevent.
    const route = adapterId === 'mt5' ? (this.symbolRouter?.resolveForOrder(ticker) ?? null) : null;
    const routedBrokerId = route?.brokerId;
    // #1079 — the account THIS order will trade on, resolved from the SAME route above. One
    // provider id (`mt5`) spans several accounts, so the duplicate checks below must scope by
    // account or a position on broker 3 blocks an order routed to broker 2. `null` (no route /
    // no configured account) keeps the checks in their conservative provider-wide mode.
    const routedAccountId = routedBrokerId !== undefined
      ? ((adapter as any)?.getConfiguredAccountId?.(routedBrokerId) ?? null)
      : null;
    const brokerSymbol = route?.brokerSymbol || ticker;
    const routeProblems = adapterId === 'mt5'
      ? orderRouteProblems(
          ticker,
          route,
          this.symbolRouter?.brokerIds?.() ?? [],
          // ⚠️ brokerSymbol is passed through — `broker_symbol` is keyed by the BROKER's name,
          // so a mapped route (USTEC → NAS100) must ask with the mapped name (2026-10-12).
          this.symbolRouter ? (b, s, bs) => this.symbolRouter!.canTradeOn(b, s, bs) : undefined,
        )
      : [];
    if (routeProblems.length > 0) {
      blockers.push({
        key: 'route-unverified',
        message: `${ticker} cannot be ordered on MT5: ${routeProblems.join('; ')}`,
        hint:
          'No action available — this symbol can only be traded once its route targets an active ' +
          'MT5 bridge and carries a verified broker-native symbol',
      });
    }

    // ── 1. Broker symbol availability (#719) — cached bridge symbol list ──
    // Check the broker that ACTUALLY serves this symbol (per symbol_route), not
    // just the default bridge — otherwise a symbol routed to another broker
    // (e.g. GER40 on Pepperstone) is wrongly reported unavailable (#747).
    //
    // ⚠️ LISTED ≠ TRADEABLE — see 1b below. These two checks are deliberately
    // separate: this one answers "does the broker quote it?", which is NOT enough to
    // justify offering a trade.
    //
    // ⚠️ #914 — skipped entirely when the route failed integrity: asking the default bridge
    // about a symbol it does not serve is how the fabrication happened.
    if (routeProblems.length === 0) {
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
            // The floor and its broker, structurally — so the caller can RAISE the size to the
            // minimum instead of asking the operator to read the message and retype a number (#835).
            params: { floor: Number(info.volumeMin), broker: routedBrokerId ?? brokerId ?? null, size: params.size },
          });
        }
      } catch {
        /* unknown trade mode — do not block */
      }
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

    // ── The bot's own identity, when the caller supplied it ──────────────────────────────────────
    // `magic` is the attribution key (#1018); the scale-in policy needs it to tell THIS bot's
    // position from another bot's on the same symbol. One indexed read, and only when a bot is
    // named, so the manual/ladder paths are unchanged.
    let incomingMagic: number | null = null;
    let positionModel: string | null = params.positionModel ?? null;
    if (params.strategyId) {
      try {
        const bot: any = await this.prisma.tradingStrategy.findUnique({ where: { id: params.strategyId } });
        if (bot && bot.magic != null) incomingMagic = Number(bot.magic);
      } catch { /* unknown — the policy falls back to its symbol-wide rule */ }
    }
    if (positionModel == null) {
      // Asked once per ROUTED broker and cached for a minute: this runs per envelope in the
      // generation phase, and a bridge round-trip per envelope is how #1000 (a blocked /health)
      // happened. ⚠️ `routedBrokerId`, not the adapter id — the model belongs to the account the
      // order joins (2026-11-05, see accountPositionModel).
      positionModel = await this.accountPositionModel(routedBrokerId, adapter);
    }

    const pyramid = await this.pyramidPolicy.evaluate({
      symbol: ticker,
      side,
      brokerId,
      positions,
      accountId: routedAccountId,
      strategyId: params.strategyId ?? null,
      positionModel,
      incomingMagic,
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
        const dup = await this.duplicateGuard.checkDuplicate(
          ticker, brokerId, protocolId ?? undefined, undefined, routedAccountId, positionModel,
        );
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
