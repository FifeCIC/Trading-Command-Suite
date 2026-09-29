import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Mt5Adapter } from '../providers/adapters/mt5.adapter';
import { MarketDataService } from '../market-data/market-data.service';
import { DirectivesService } from '../directives/directives.service';
import { ProtocolGatingService } from './protocol-gating.service';
import { ScoreHistoryService } from './score-history.service';
import { getDirectiveSuitability } from '../directives/directive-suitability.registry';
import type { DirectiveInput, DirectiveResult } from '../directives/interfaces/directive.interface';

/**
 * ExitConsensusService — evaluate an OPEN position FOR EXIT, separately from entry scoring.
 * ==========================================================================================
 *
 * ⚠️ WHY THIS EXISTS, AND WHY IT IS SEPARATE.
 *
 * Every mechanism that could have protected an open position was measured to be inert or
 * advisory (2026-09-28):
 *
 *   • the 5 "exit" directives live in `mt5-technical-core-v1`, `active = 0` — they have NEVER
 *     run. Measured: 0 appearances in 6,693 score breakdowns over 3 days, while control
 *     directives appeared 426–6,687 times. The diagrams page claims they "contribute scores to
 *     the composite"; reality is that they contribute nothing, because they never execute.
 *   • `simTsl` records a decision point and places/moves NOTHING (by design, #936/R20=A).
 *   • `ExitSignalService` is advisory, was dark (a ticker passed where a `symbolId` is
 *     required — #1014's sibling, fixed), and reads the **Trading 212** book rather than the
 *     40 bot-managed MT5 positions.
 *
 * So a position had exactly one protective actor: the broker stop, plus the owner's hand.
 * MEASURED consequence, 376 closed trades by `closeReason`: broker/terminal 58, system:time-stop
 * 36, broker:sl 27 — and **no score- or signal-driven close has ever been recorded**.
 *
 * This service is the missing evaluation. It answers ONE question per open position:
 * **"what does the combination of what we know say about keeping this position?"**
 *
 * ── THE FIVE INPUTS (P1–P5) ────────────────────────────────────────────────────────────────
 *
 *   P1 PROFIT STATE    entry vs now vs PEAK, and the GIVE-BACK from that peak.
 *   P2 CONVICTION      the 5 exit directives run IN ISOLATION and read as a verdict, not
 *                      folded into an entry composite as points.
 *   P3 DIRECTION       score trend + velocity (regression slope over recent scores).
 *   P5 PROTECTION      the live stop's distance vs the bot's own declared `slPct`, and whether
 *                      the stop is already beyond entry (profit locked in).
 *
 * ⚠️ P4 (calendar risk — `minutesUntilClose` / weekend exposure) is NOT yet included. It is the
 * next input, and it is the one that drives "accelerate the gap closure as the session ends".
 *
 * ── NO BEST-PRICE WATERMARK NEEDED ────────────────────────────────────────────────────────
 *
 * `StopGuardianService.simTslWatermark` is an in-memory `Map`, so a restart forgets the peak and
 * the measurement is silently wrong. The peak does not need to be remembered at all: it is
 * DERIVED from candles between the position's `openedAt` and now. That survives restarts, is
 * correct even if the process was down, and — critically — avoids keying a watermark on our
 * `trade.brokerTicket`, which is an ORDER ticket for scale-ins while MT5 matches on
 * `position_id` (issue #1014). Deriving it sidesteps that class of bug entirely.
 *
 * ── ADVISORY ONLY ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ THIS SERVICE PLACES NOTHING, MOVES NO STOP, AND CLOSES NOTHING. Acting on a verdict is a
 * MATHS change and needs a copied configuration and a monitored comparison before it can touch
 * a live position. It exists so the decision becomes MEASURABLE first — the same boundary
 * `observeSimulatedTsl()` draws, for the same reason.
 */

// ── DECISION (2026-09-29, primary) ──
// WHAT:      The verdict stays ADVISORY. No acting exit is built, and this service must not be
//            given the ability to close a position, move a stop, or place anything.
// WHY:       MEASURED three independent ways over the trades we already have. `#1024` — a simple
//            give-back rule, 8 settings: best improves the mean +0.035%/trade, the mean stays
//            NEGATIVE, and it cuts 17-29 winners; the early-stop rule is a wash (0.000). `#1027` —
//            the REAL 5-directive verdict with the REAL `arguesExitFor`: EXIT level fires on 77 of
//            166 trades for delta -0.0080%, i.e. WORSE; REDUCE level fires on 153 of 166 for delta
//            +0.0272%, but the mean is STILL NEGATIVE and it cuts 61 winners (31 turn red).
//            So "the app loses because it exits too late" is refuted, and the lever is the loss
//            MAGNITUDE, not the exit moment: fixing the 46 time-stops to break-even still leaves
//            -101.26, while the 30 stop-outs are -308.62 — a stop-out costs 4.3x what a win earns.
// INSTEAD OF: building the acting exit that `#1019` proposed, which was the plan until this was
//            measured. ⚠️ The premise is refuted; the CAPABILITY is not — see REVERSE BY.
// REVERSE BY: Run the measurement these replays did NOT run: whether the verdict works as a
//            SELECTOR (whether it fires on the RIGHT trades, not merely whether leaving was better
//            when it did)', over a tighter/wider STOP and a different SIZE — both of which every
//            test so far held fixed at the incumbent. If that shows positive expectation, reverse
//            this and build the actor as a COPY per `maths-change-requires-ab`.
// REGISTER:  docs/SETTLED-DECISIONS.md row 46
// GUARD:     NONE, deliberately — and said plainly rather than implied. `npm run replay:verdict`
//            (self-test 12/12; two guards canaried in both directions, restore hash-verified)
//            re-runs the measurement, but a replay is a MEASUREMENT, not a gate: nothing fails the
//            build if an actor is added here anyway.

/** The exit directives, named explicitly so this evaluation is auditable and separable. */
export const EXIT_DIRECTIVE_IDS = [
  'momentum-exhaustion',
  'target-achieved',
  'regime-shift-exit',
  'time-stop',
  'chandelier-exit',
] as const;

export type ConvictionLevel = 'EXIT' | 'REDUCE' | 'HOLD' | 'NO_DATA';

// ── DECISION (2026-09-29, primary) ──
// WHAT:      An exit directive with no direction declares `exitScoreThreshold`; a score at or above
//            it argues an exit for EITHER side. Omitting the threshold means the directive does not
//            get to argue an exit at all — `time-stop` omits it deliberately.
// WHY:       `arguesExit` was derived from `signalClass` alone, so two directives that hardcode
//            `signalClass: 'neutral'` could never argue an exit — `regime-shift-exit` reached score
//            100 with the reason "Exit recommended." and was invisible to all 17 open positions.
// INSTEAD OF: an inline ternary in `runExitDirectives()`, which was untestable — that is WHY the
//            two directives stayed muted with nobody noticing. Extracted so it can be canaried.
//            Also instead of keying on `directionBias === 'neutral'`, which would have SILENTLY
//            DISABLED `chandelier-exit` (neutral bias, real bullish/bearish, 6 live exits).
// REVERSE BY: delete the `byThreshold` branch in `arguesExitFor()` and the `exitScoreThreshold`
//            declaration on `regime-shift-exit`; behaviour returns to directional-only. The
//            directional path is untouched either way, so nothing else needs changing.
// REGISTER:  docs/SETTLED-DECISIONS.md row 45
// GUARD:     nest/src/modules/scoring/exit-consensus.service.spec.ts (12 tests, canaried both ways)
/**
 * ⚠️ #1020 — THE RULE THAT DECIDES WHETHER ONE DIRECTIVE ARGUES AN EXIT.
 *
 * Extracted from `runExitDirectives()` for one reason: it was inline in a private method, so the
 * defect it now fixes had NO test, and the two directives it silently muted were invisible. A rule
 * that cannot be called cannot be canaried.
 *
 * ⚠️ IT DELIBERATELY DOES NOT TAKE `directionBias`. The first design keyed on it — `directionBias ===
 * 'neutral'` meaning "read the score instead of the class" — and that would have SILENTLY DISABLED
 * `chandelier-exit`, which declares neutral bias while emitting real bullish/bearish and arguing 6
 * exits on live data. `directive.interface.ts` already documented why: *"a `neutral` directionBias is
 * valid for a dynamic two-sided directive."* The number of arguments here is the guard against that
 * mistake recurring.
 *
 * Two INDEPENDENT ways to argue, because they answer different questions:
 *   • `direction` — the directive made a claim about direction and it opposes the position's side.
 *   • `threshold` — the directive has no direction to offer ("regime is breaking, get out" is true
 *     for a long and a short alike), so it declared a side-agnostic `exitScoreThreshold`.
 * A directive that clears BOTH reports `direction`, the more specific claim.
 */
export function arguesExitFor(
  side: 'buy' | 'sell',
  signalClass: string,
  score: number,
  exitScoreThreshold?: number,
): { arguesExit: boolean; via: 'direction' | 'threshold' | null } {
  const byDirection = side === 'buy' ? signalClass === 'bearish' : signalClass === 'bullish';
  const hasThreshold = Number.isFinite(Number(exitScoreThreshold));
  const byThreshold = hasThreshold && Number(score) >= Number(exitScoreThreshold);
  if (byDirection) return { arguesExit: true, via: 'direction' };
  if (byThreshold) return { arguesExit: true, via: 'threshold' };
  return { arguesExit: false, via: null };
}

export interface ExitDirectiveVerdict {
  id: string;
  name: string;
  /** `bullish` | `bearish` | `neutral` — from the directive's OWN runtime result. */
  signalClass: string;
  /** `true` when this verdict argues for leaving the position (bearish on a long). */
  arguesExit: boolean;
  /**
   * ⚠️ #1020 — WHY it argues, or `null` when it does not. Load-bearing, for the same reason
   * `barsTimeframe` is: two different questions reach the same `arguesExit: true`, and a reader who
   * cannot tell them apart cannot price the verdict. `direction` means the directive made a claim
   * opposing the position's side; `threshold` means it declared a side-agnostic
   * `exitScoreThreshold` and its score alone cleared it.
   */
  arguesExitVia: 'direction' | 'threshold' | null;
  score: number;
  maxScore: number;
  /**
   * The bar cadence this verdict was ACTUALLY computed on.
   *
   * ⚠️ Load-bearing. Each exit directive declares a `minTimeframe` (target-achieved D1, time-stop
   * D1, regime-shift-exit H1, momentum-exhaustion M15). If the bar store cannot supply it, this
   * records the finer cadence that was used instead, so a verdict computed BELOW its declared
   * minimum is visible in the payload rather than assumed. MEASURED 2026-09-28: requesting
   * D1/H1/M15 returned zero bars for every open position, which silently produced NO verdicts —
   * conviction `NO_DATA` across the board, a worse failure than the mismatch it was fixing.
   */
  barsTimeframe: string;
  /** The directive's declared `minTimeframe`, for comparison against `barsTimeframe`. */
  declaredMinTimeframe: string;
  reason: string;
}

export interface ExitAssessment {
  ticket: string;
  brokerId: string | null;
  symbol: string;
  side: 'buy' | 'sell';
  bot: string | null;

  // ── P1 profit state ──
  entryPrice: number;
  currentPrice: number;
  profitPct: number;
  peakPrice: number | null;
  peakProfitPct: number | null;
  /**
   * How much of the peak profit has been handed back — `null` when the peak is UNKNOWN.
   *
   * ⚠️ `null` is load-bearing and must NEVER be rendered as `0`. `0` asserts "still at the peak",
   * which is a claim about the market; `null` says we could not measure it. Collapsing the two
   * turns an unreadable window into a reassuring zero — the exact defect this field caused on
   * 2026-09-28, when a mis-windowed peak reported a 6.56% give-back that did not exist.
   */
  giveBackPct: number | null;

  // ── P5 protection state ──
  stopLoss: number | null;
  stopDistancePct: number | null;
  /** The bot's own declared stop distance — the #927 floor's anchor. */
  declaredStopPct: number | null;
  /** `true` when the live stop is already beyond entry, i.e. profit is locked in. */
  stopInProfit: boolean;

  // ── P2 conviction ──
  conviction: ConvictionLevel;
  verdicts: ExitDirectiveVerdict[];

  // ── P3 direction ──
  scoreTrend: string | null;
  scoreVelocity: number | null;

  // ── verdict ──
  /** Advisory only. Nothing consumes this to act, yet. */
  action: 'PROTECT' | 'WATCH' | 'HOLD' | 'NO_DATA';
  reasons: string[];
  asOf: string;
}

@Injectable()
export class ExitConsensusService {
  private readonly logger = new Logger(ExitConsensusService.name);
  /** Bar arrays keyed `${symbolId}|${timeframe}` — the loop asks 5 directives × N positions. */
  private readonly barCache = new Map<string, Promise<any[]>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mt5: Mt5Adapter,
    private readonly marketData: MarketDataService,
    private readonly directives: DirectivesService,
    private readonly protocolGating: ProtocolGatingService,
    private readonly scoreHistory: ScoreHistoryService,
  ) {}

  /**
   * Assess every OPEN broker position. Bot book only — Trading 212 holdings are a data-import
   * concern and are deliberately excluded (owner direction, 2026-09-28).
   */
  async assessAll(): Promise<ExitAssessment[]> {
    // Bars are fetched once per (symbol, timeframe) per call. Reset so a repeated call never
    // reports a decision made on stale bars.
    this.barCache.clear();
    let positions: any[] = [];
    try {
      positions = await (this.mt5 as any).getPositions();
    } catch (err) {
      this.logger.warn(`Could not read broker positions: ${(err as Error).message}`);
      return [];
    }
    if (!Array.isArray(positions) || positions.length === 0) return [];

    const bots = await this.loadBotMap();

    const out: ExitAssessment[] = [];
    for (const p of positions) {
      try {
        out.push(await this.assessOne(p, bots));
      } catch (err) {
        this.logger.warn(`Exit assessment failed for ${p?.symbol}: ${(err as Error).message}`);
      }
    }
    // Most give-back first — the position handing back the most profit is the one to look at.
    // ⚠️ `null` (unknown peak) sorts LAST, never as 0: an unmeasured give-back is not a small one.
    return out.sort((a, b) => (b.giveBackPct ?? -1) - (a.giveBackPct ?? -1));
  }

  /** Active bots by symbol, for the declared stop distance and the bot's name. */
  private async loadBotMap(): Promise<Map<string, { name: string; slPct: number | null }>> {
    const map = new Map<string, { name: string; slPct: number | null }>();
    try {
      const rows = await this.prisma.tradingStrategy.findMany({
        where: { active: true },
        select: { name: true, symbol: true, slPct: true },
      });
      for (const r of rows) {
        const key = String(r.symbol || '').toUpperCase();
        if (!map.has(key)) map.set(key, { name: r.name, slPct: r.slPct ?? null });
      }
    } catch (err) {
      this.logger.warn(`Could not load bot map: ${(err as Error).message}`);
    }
    return map;
  }

  private async assessOne(
    pos: any,
    bots: Map<string, { name: string; slPct: number | null }>,
  ): Promise<ExitAssessment> {
    const symbol = String(pos.ticker || pos.symbol || '').toUpperCase();
    const side: 'buy' | 'sell' = String(pos.side || 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
    const entry = Number(pos.avgCost ?? pos.priceOpen ?? 0);
    const current = Number(pos.currentPrice ?? 0);
    const bot = bots.get(symbol) ?? null;

    // ── P1 profit state. The PEAK is derived, not remembered. ──
    const openedAtMs = toMs(pos.openedAt);
    const peak = await this.derivePeak(symbol, side, openedAtMs);
    const profitPct = entry > 0 ? ((side === 'buy' ? current - entry : entry - current) / entry) * 100 : 0;
    const peakProfitPct =
      peak == null || entry <= 0 ? null : ((side === 'buy' ? peak - entry : entry - peak) / entry) * 100;
    const giveBackPct = peakProfitPct == null ? null : Math.max(0, peakProfitPct - profitPct);

    // ── P5 protection state ──
    const sl = pos.sl == null ? null : Number(pos.sl);
    const stopDistancePct = sl != null && current > 0 ? (Math.abs(current - sl) / current) * 100 : null;
    const stopInProfit =
      sl != null && entry > 0 && (side === 'buy' ? sl > entry : sl < entry);

    // ── P2 conviction: the exit directives, run in ISOLATION ──
    const { verdicts, conviction } = await this.runExitDirectives(symbol, side);

    // ── P3 direction ──
    const { trend, velocity } = await this.scoreDirection(symbol);

    const reasons: string[] = [];
    for (const v of verdicts.filter((x) => x.arguesExit)) {
      reasons.push(`${v.name} argues exit (${v.score}/${v.maxScore}): ${v.reason}`);
    }
    if (giveBackPct != null && giveBackPct >= 0.2) {
      reasons.push(
        `Gave back ${giveBackPct.toFixed(2)}% of price from the peak (peak ${peakProfitPct!.toFixed(2)}% → now ${profitPct.toFixed(2)}%).`,
      );
    }
    if (peak == null) {
      reasons.push('PEAK UNKNOWN: the open time or the bar window could not be read, so give-back is not measurable for this position.');
    }
    if (stopInProfit) reasons.push('Stop is already beyond entry — profit is locked in.');
    if (stopDistancePct != null && bot?.slPct && stopDistancePct < bot.slPct * 0.25) {
      reasons.push(
        `Stop is ${stopDistancePct.toFixed(3)}% from price — much tighter than the declared ${bot.slPct}% (#927 floor is the guard against this).`,
      );
    }
    if (trend === 'collapsing' || trend === 'declining') {
      reasons.push(`Composite score ${trend} (velocity ${velocity ?? '?'}).`);
    }

    // ── Advisory action. PROTECT-first: a weakening position IN PROFIT is a give-back risk,
    //    so the answer is to tighten or capture — never to loosen. ──
    let action: ExitAssessment['action'] = 'HOLD';
    const noEvidence = conviction === 'NO_DATA' && trend == null;
    if (noEvidence) {
      action = 'NO_DATA';
      reasons.push('NO EVIDENCE: no exit-directive verdict and no score history — this position is unjudgeable, which is not the same as safe.');
    } else if (conviction === 'EXIT' && profitPct > 0) {
      action = 'PROTECT';
    } else if (giveBackPct != null && giveBackPct >= 0.2 && profitPct > 0) {
      // ⚠️ Requires giveBackPct != null. An unmeasurable peak must never produce PROTECT.
      action = 'PROTECT';
    } else if (conviction === 'REDUCE' || conviction === 'EXIT' || (giveBackPct != null && giveBackPct > 0) || trend === 'declining') {
      action = 'WATCH';
    }

    return {
      ticket: String(pos.brokerTicket ?? pos.ticket ?? ''),
      brokerId: pos.brokerId != null ? String(pos.brokerId) : null,
      symbol,
      side,
      bot: bot?.name ?? null,
      entryPrice: entry,
      currentPrice: current,
      profitPct: round(profitPct, 4),
      peakPrice: peak == null ? null : round(peak, 5),
      peakProfitPct: peakProfitPct == null ? null : round(peakProfitPct, 4),
      giveBackPct: giveBackPct == null ? null : round(giveBackPct, 4),
      stopLoss: sl,
      stopDistancePct: stopDistancePct == null ? null : round(stopDistancePct, 4),
      declaredStopPct: bot?.slPct ?? null,
      stopInProfit,
      conviction,
      verdicts,
      scoreTrend: trend,
      scoreVelocity: velocity,
      action,
      reasons: [...new Set(reasons)].slice(0, 8),
      asOf: new Date().toISOString(),
    };
  }

  /**
   * The peak FAVOURABLE price since the position opened, derived from the bar store.
   *
   * ⚠️ FAILS CLOSED — returns `null` (peak UNKNOWN) rather than a number, whenever the window
   * cannot be established with certainty. It does NOT fall back to `max(entry, current)`.
   *
   * MEASURED FAILURE, 2026-09-28 — this method previously returned a number unconditionally, and
   * its filter read `Number.isFinite(t) ? t >= from : true`. `openedAt`/`timestamp` can arrive as
   * a `Date`, a number, or a string depending on whether they came from the bridge or Prisma, so
   * an unparseable value took the `: true` branch and INCLUDED the bar. That quietly widened the
   * window to every bar in the store: GOOGL (opened 25/09, entry 343.21) reported a peak of
   * 366.45 against a TRUE high-since-open of **345.56** — a 6.56% "give-back" that did not exist,
   * which then fired `action = PROTECT` and reached the owner as a decision. Plausible number, no
   * error, wrong shape — the exact defect class this repo treats as the most expensive kind.
   *
   * The old comment called the `: true` branch a safety net ("must not silently drop data").
   * Including an unreadable bar is not the safe direction — it INVENTS a peak the position never
   * saw. An unreadable window is an unknown, and an unknown must stay unknown.
   */
  private async derivePeak(
    symbol: string,
    side: 'buy' | 'sell',
    openedAtMs: number | null,
  ): Promise<number | null> {
    if (openedAtMs == null) return null;
    try {
      const sym = await this.prisma.symbol.findFirst({
        where: { ticker: symbol },
        select: { id: true },
      });
      if (!sym) return null;
      // ⚠️ 1000 is the bar store's real ceiling — asking for 2000 silently returns 1000.
      const bars = await this.barsAt(sym.id, '5m', 1000);
      if (bars.length === 0) return null;

      let best: number | null = null;
      let considered = 0;
      for (const b of bars) {
        const t = toMs(b?.timestamp);
        // An unreadable timestamp makes the WINDOW unreadable. Bail out; do not skip the bar.
        if (t == null) return null;
        if (t < openedAtMs) continue;
        const v = Number(side === 'buy' ? b?.high : b?.low);
        if (!Number.isFinite(v)) continue;
        considered++;
        best = best == null ? v : side === 'buy' ? Math.max(best, v) : Math.min(best, v);
      }
      if (best == null || considered === 0) return null;
      return best;
    } catch (err) {
      this.logger.warn(`Peak derivation failed for ${symbol}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Fetch (and memoise) bars for a symbol at a timeframe. */
  private barsAt(symbolId: string, timeframe: string, count: number): Promise<any[]> {
    const key = `${symbolId}|${timeframe}`;
    const hit = this.barCache.get(key);
    if (hit) return hit;
    const p = (async () => {
      const rows = (await this.marketData.getBars(symbolId, timeframe, count)) as any[];
      return Array.isArray(rows) ? rows : [];
    })().catch((err) => {
      this.logger.warn(`Bar fetch failed (${timeframe}): ${(err as Error).message}`);
      return [];
    });
    this.barCache.set(key, p);
    return p;
  }

  /**
   * Run the 5 exit directives and reduce them to ONE conviction level.
   *
   * ⚠️ This is the "segregated evaluation" the owner asked for: these directives produce a
   * VERDICT here, not points in an entry composite. In the composite a bearish exit signal is
   * diluted against every entry directive and typically disappears into HOLD.
   *
   * A verdict `arguesExit` when its runtime `signalClass` points against the POSITION'S side:
   * bearish for a long, bullish for a short. `neutral` never argues an exit — a neutral reading
   * is the absence of a directional claim, not a reason to leave.
   */
  private async runExitDirectives(
    symbol: string,
    side: 'buy' | 'sell',
  ): Promise<{ verdicts: ExitDirectiveVerdict[]; conviction: ConvictionLevel }> {
    const verdicts: ExitDirectiveVerdict[] = [];
    let symId: string | null = null;
    try {
      const sym = await this.prisma.symbol.findFirst({
        where: { ticker: symbol },
        select: { id: true },
      });
      symId = sym?.id ?? null;
    } catch (err) {
      this.logger.warn(`Could not resolve symbol ${symbol}: ${(err as Error).message}`);
    }
    if (!symId) return { verdicts, conviction: 'NO_DATA' };

    for (const id of EXIT_DIRECTIVE_IDS) {
      const inst: any = this.directives.get(id);
      if (!inst || typeof inst.calculate !== 'function') continue;

      // ⚠️ CADENCE. Every one of these directives reads `input.bars` — the PRIMARY array — and
      // each declares a `minTimeframe` (target-achieved D1, time-stop D1, regime-shift-exit H1,
      // momentum-exhaustion M15, chandelier-exit structural). Feeding them all 5m bars, as this
      // first did, evaluates a D1 directive over ~a day of 5-minute noise: the verdict is computed
      // on a cadence its own registry declares unsuitable, and it still returns a confident
      // `signalClass`. Same defect family as the #1013 bar-starvation bug. We now fetch at the
      // directive's OWN declared minimum, so a D1 directive sees D1 bars.
      const declared = String(getDirectiveSuitability(id)?.minTimeframe ?? 'H1');
      // ⚠️ TWO VOCABULARIES. The suitability registry declares `minTimeframe` as 'D1'/'H1'/'M15';
      // the bar store is keyed '1d'/'1h'/'15m'. Querying with the registry's spelling returns an
      // EMPTY array and NO error — so every directive silently skipped and conviction collapsed to
      // NO_DATA across the board (seen live 2026-09-28: "No D1 bars for GOOGL — target-achieved
      // skipped"). A name is a claim; the store's own keys are the definition. Translated here.
      const wanted = toStoreTimeframe(declared);
      let tf = wanted;
      let bars = await this.barsAt(symId, tf, 400);
      if (bars.length === 0) {
        // Fall back to the finest cadence the store DOES hold, and record it in `barsTimeframe`
        // so a verdict computed below its declared minimum is visible rather than assumed.
        tf = '5m';
        bars = await this.barsAt(symId, tf, 400);
      }
      if (bars.length === 0) {
        this.logger.warn(`No ${wanted} or 5m bars for ${symbol} — ${id} skipped`);
        continue;
      }
      if (tf !== wanted) {
        this.logger.log(`${symbol}: no ${wanted} bars — ${id} evaluated on ${tf} (below its declared ${declared})`);
      }

      let result: DirectiveResult | null = null;
      try {
        result = inst.calculate({ symbol, bars, timeframe: tf } as DirectiveInput);
      } catch (err) {
        this.logger.warn(`Exit directive ${id} threw on ${symbol}: ${(err as Error).message}`);
        continue;
      }
      if (!result) continue;
      const signalClass = String(result.signalClass ?? 'neutral');
      // ⚠️ #1020 — the rule lives in `arguesExitFor()` so it can be CALLED and canaried. It was
      // inline here, in a private method, which is why the two directives it silently muted had no
      // test. See that function for why it deliberately does NOT take `directionBias`.
      const { arguesExit, via: arguesExitVia } = arguesExitFor(
        side,
        signalClass,
        Number(result.score ?? 0),
        (inst as any).exitScoreThreshold,
      );
      verdicts.push({
        id,
        name: String(inst.name ?? id),
        signalClass,
        arguesExit,
        arguesExitVia,
        score: round(Number(result.score ?? 0), 2),
        maxScore: Number(inst.maxScore ?? 0),
        barsTimeframe: tf,
        declaredMinTimeframe: declared,
        reason: String(result.reason ?? ''),
      });
    }

    if (verdicts.length === 0) return { verdicts, conviction: 'NO_DATA' };
    const arguing = verdicts.filter((v) => v.arguesExit).length;
    const conviction: ConvictionLevel = arguing >= 2 ? 'EXIT' : arguing === 1 ? 'REDUCE' : 'HOLD';
    return { verdicts, conviction };
  }

  /** Score trend for the symbol, by ticker (the type-safe path added for #1014's sibling). */
  private async scoreDirection(
    symbol: string,
  ): Promise<{ trend: string | null; velocity: number | null }> {
    try {
      const history = await this.scoreHistory.getHistoryByTicker(symbol, 10);
      if (!history || history.length < 2) return { trend: null, velocity: null };
      const values = history.map((h) => Number(h.value) || 0);
      const n = values.length;
      const meanX = (n - 1) / 2;
      const meanY = values.reduce((a: number, b: number) => a + b, 0) / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - meanX) * (values[i] - meanY);
        den += (i - meanX) ** 2;
      }
      const slope = den !== 0 ? num / den : 0;
      const velocity = Math.round(slope * n);
      const trend = slope < -15 ? 'collapsing' : slope < -5 ? 'declining' : slope > 5 ? 'rising' : 'stable';
      return { trend, velocity };
    } catch {
      return { trend: null, velocity: null };
    }
  }

}

/**
 * Parse a timestamp that may arrive as a `Date`, an epoch number, or a string.
 *
 * ⚠️ Returns `null` when it cannot be read — and every caller treats `null` as "unknown", never
 * as "now" and never as "include it anyway". The three input shapes are not hypothetical: bars
 * come from Prisma (`Date`), the bridge sends ISO strings, and a cached value may be epoch ms.
 */
function toMs(v: any): number | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/**
 * Translate a suitability-registry timeframe ('D1', 'H1', 'M15') into the bar store's key
 * ('1d', '1h', '15m'). Already-mapped input passes through unchanged, so the mapping is safe to
 * apply twice.
 *
 * ⚠️ Exists because the two vocabularies LOOK compatible and are not. A mismatch here is silent:
 * the store returns no rows rather than raising, which reads as "no data" instead of "wrong key".
 */
function toStoreTimeframe(tf: string): string {
  const s = String(tf).trim().toUpperCase();
  if (/^\d+[MHDW]$/.test(s)) return s.toLowerCase(); // already store-shaped (e.g. '5M' -> '5m')
  const m = /^([MHDW])(\d+)$/.exec(s);
  if (m) return `${m[2]}${m[1].toLowerCase()}`; // M15 -> 15m, D1 -> 1d, H1 -> 1h, W1 -> 1w
  return String(tf).toLowerCase();
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((Number.isFinite(v) ? v : 0) * f) / f;
}
