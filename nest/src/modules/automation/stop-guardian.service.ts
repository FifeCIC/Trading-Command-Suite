/**
 * StopGuardianService — directive-based trailing stop management.
 *
 * Monitors open MT5 positions and adjusts stop-loss levels using
 * directive consensus rather than simple price-distance rules.
 *
 * Talks directly to the MT5 bridge for raw position data (ticket, sl, tp).
 */

import { Injectable, Logger } from '@nestjs/common';
import { TradingStrategyService } from '../trading/trading-strategy.service';
import { DirectivesService } from '../directives/directives.service';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import { NotificationService } from '../notifications/notifications.service';
import { StopGuardianService as StopAdjustmentRecorder } from '../trading/stop-guardian.service';

interface Mt5RawPosition {
  ticket: number;
  symbol: string;
  type: string;
  volume: number;
  priceOpen: number;
  priceCurrent: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  comment: string;
}

export interface GuardianState {
  enabled: boolean;
  tickIntervalMs: number;
  tickCount: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  lastTickMs: number;
  guardedPositions: GuardedPosition[];
  recentAdjustments: StopAdjustment[];
  /**
   * ⚠️ #892 — why the last stop edit was REFUSED by the broker, if it was.
   *
   * `0 adjusted` is ambiguous: it reads as "nothing needed adjusting", and before
   * this field the alternative — "positions needed adjusting and the broker rejected
   * every one" — produced exactly the same output. Measured 2026-09-18: three
   * positions cleared the confidence gate, every edit was refused with
   * `HTTP 400 {"error": "Market closed"}`, and nothing anywhere said so.
   */
  lastBridgeRefusal: { at: string; path: string; detail: string } | null;
  /**
   * ⚠️ #893 — symbols the BROKER reported as closed, and when the guardian will
   * probe again. A computed view (see `getState()`), not persisted state.
   *
   * The guardian used to attempt a stop edit per eligible position per tick at any
   * hour. With the market closed the broker refused every one (`HTTP 400
   * {"error": "Market closed"}`) — measured 2026-09-18: 3 refused calls per tick,
   * one tick every 30s, for as long as the market stayed shut. Nothing was
   * mis-applied (the refusal is honest); the cost was pointless broker traffic and
   * a pause in stop maintenance that was invisible.
   *
   * The backoff is REFUSAL-DRIVEN on purpose: the closure is never PREDICTED from
   * bar staleness or session tables, because a wrong "closed" answer would silently
   * stop ALL stop maintenance. Only the broker's own refusal arms it.
   */
  marketClosedBackoff?: Array<{ symbol: string; retryAt: string }>;
}

export interface GuardedPosition {
  ticket: number;
  symbol: string;
  strategyId: string;
  strategyName: string;
  side: 'BUY' | 'SELL';
  currentSl: number | null;
  recommendedSl: number | null;
  stopConfidence: number;
  wickFilterPassed: boolean;
  lastEvaluatedAt: string | null;
}

export interface StopAdjustment {
  timestamp: string;
  ticket: number;
  symbol: string;
  oldSl: number | null;
  newSl: number;
  reason: string;
  stopConfidence: number;
}

/**
 * The directives this guardian READS (#888).
 *
 * ⚠️ Every ID here must ALSO be REGISTERED in `directives.module.ts`, or it resolves
 * to nothing. `Map.get()` returns `undefined` for a key that was never `set` — it
 * does not throw — so an unregistered ID reads as "no evidence" and silently lowers
 * the consensus instead of raising an error.
 *
 * MEASURED 2026-09-18 (#890): 3 of these 4 were unregistered — two sat in
 * `providers` (constructed, never referenced) and one was not imported at all. A
 * `>= 55` threshold calibrated for FOUR signals was therefore applied to ONE, and
 * the guardian never adjusted a stop while every registry count looked healthy.
 * Enforced at build time by `validate-guardian-directive-ids.cjs`
 * (INV-GUARDIAN-DIRECTIVE-RESOLVABLE) and at runtime by the shortfall error in `tick()`.
 *
 * ⚠️ MUST list EXACTLY the IDs fetched with `resultsMap.get(...)` below.
 *
 * `DirectivesService.runAll(input, filter)` runs ALL registered directives when the
 * filter is omitted, and this file used to omit it. Measured 2026-09-18: **505
 * directives evaluated per pass** (101 registered x 5 positions) costing **780ms**, to
 * read these four. The waste was invisible because the result map is only ever indexed
 * by the keys below - the other ~97 results were computed and discarded.
 *
 * ⚠️ Adding a `.get('new-id')` below WITHOUT adding it here does not throw. It silently
 * returns `undefined`, so the guard reads "no evidence" instead of that directive's real
 * answer - a behaviour change disguised as a missing value. Pinned by
 * `stop-guardian.service.spec.ts`.
 *
 * ⚠️ This declaration must sit ABOVE `@Injectable()`, not between it and the class: a
 * decorator applies to the next declaration, so inserting a const there decorates the
 * const (TS1206 "Decorators are not valid here"). The Jest suite did NOT catch that -
 * ts-jest transpiles more permissively; `nest run build` did.
 */
const STOP_GUARDIAN_DIRECTIVES = new Set([
  'atr-trailing-stop',
  'supertrend',
  'chandelier-exit',
  'wick-filter',
]);

/**
 * #927 — THE TRAIL DISTANCE FLOOR.
 * ==================================
 *
 * MEASURED DEFECT (2026-09-21): the trail target was `currentPrice − 3 × ATR(5m)` with "never
 * loosen" as its only guard. On FX, `3 × ATR(5m)` is ~0.03–0.11% of price, while the strategy's
 * declared stop distance (`slPct`) is ~1%. So as soon as the price was roughly flat, the trail
 * moved the stop from 1% away to ~0.05% away — a ~20x reduction in one edit, with no minimum
 * distance to stop it. Seven positions closed between 12:40 and 13:08 UTC, **every close price
 * exactly a guardian-set stop** (`stop_adjustment`, oldSl → newSl): EURGBP −1.012% → −0.031%,
 * NZDJPY −1.028% → **+0.058%**. A market pullback smaller than the position's own declared risk
 * hit every one of them simultaneously because they were all trailed to the same tiny distance.
 *
 * THE RULE NOW: a trailing tighten may never leave the stop closer to price than the position's
 * declared stop distance. `3 × ATR` can still WIDEN the trail (a genuinely volatile market
 * deserves more room) but can never tighten it inside the declared risk. The declared distance is
 * the strategy's own `slPct` from entry — the same number the protective floor uses, so the trail
 * and the floor finally agree about what this position tolerates.
 *
 * Keeping these as exported pure functions is deliberate: the tick calls them, and the spec
 * canaries them in both directions without a bridge, a position or a clock.
 */
export function declaredStopDistance(entryPrice: number, slPct: number): number {
  const pct = Number(slPct);
  const safePct = Number.isFinite(pct) && pct > 0 ? pct : 1;
  const entry = Number(entryPrice);
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  return Math.abs(entry * (safePct / 100));
}

/** The distance a trailing tighten must leave between price and the stop (price units). */
export function trailDistanceFor(atrValue: number, declaredDistance: number): number {
  const atr = Number(atrValue);
  const atrTrail = Number.isFinite(atr) && atr > 0 ? 3 * atr : 0;
  return Math.max(atrTrail, declaredDistance);
}

/**
 * #927 — validation, not decoration. Returns a problem string when a proposed trail would leave
 * the stop closer to price than the declared distance; the tick REFUSES the modify in that case.
 * With `trailDistanceFor` max()ing, this should never fire — which is exactly why it exists: it
 * makes the invariant checkable (and canaried) rather than implied by one `Math.max` nobody
 * re-reads.
 */
export function trailDistanceProblem(trailDistance: number, declaredDistance: number): string | null {
  if (!(declaredDistance > 0)) return null; // no declared distance → nothing to enforce
  if (trailDistance + 1e-9 >= declaredDistance) return null;
  return (
    `trail distance ${trailDistance.toFixed(5)} is inside the declared stop distance ` +
    `${declaredDistance.toFixed(5)} — refusing to place a stop tighter than the position's own risk (#927)`
  );
}

@Injectable()
export class StopGuardianService {
  private readonly logger = new Logger(StopGuardianService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly bridgeUrl: string;

  state: GuardianState = {
    enabled: false,
    tickIntervalMs: 30_000,
    tickCount: 0,
    lastTickAt: null,
    nextTickAt: null,
    lastTickMs: 0,
    guardedPositions: [],
    recentAdjustments: [],
    lastBridgeRefusal: null,
  };

  // ── Broker-modification throttle (#721 decision 6) ──
  // Brokers throttle SL/TP modifications — hammering `/order/modify` every
  // tick can trip rate limits or get positions re-quoted. Two knobs:
  //   per-position cadence (min gap between edits on ONE position)
  //   global cadence (max edits per minute across ALL positions)
  private readonly MIN_MODIFY_INTERVAL_MS = 60_000; // 1 edit per position per minute
  private readonly MAX_MODIFY_PER_MINUTE = 10;      // global cap per minute
  private lastModifyAt = new Map<number, number>(); // ticket → last modify timestamp
  private modifyTimes: number[] = [];               // timestamps of edits in the last 60s

  /**
   * ⚠️ #890 — throttles the "declared directive did not resolve" error.
   *
   * The shortfall is a property of the REGISTRY, not of any one position, so
   * unthrottled it would repeat for every position on every tick (5x30s) and
   * bury the log it lives in. Throttled to once per 30 minutes so it stays
   * visible without becoming noise.
   */
  private lastDirectiveShortfallAt = 0;
  private readonly DIRECTIVE_SHORTFALL_LOG_MS = 30 * 60_000;

  /**
   * ⚠️ #892 — throttles the "a modify was blocked" warning.
   *
   * The per-position cadence (60s between edits on ONE position, against a 30s
   * tick) blocks legitimately and repeatedly, so an unthrottled warning would be
   * mostly noise. The failure this exists to expose is the opposite one: a modify
   * that can NEVER go out. One line per 5 minutes keeps that visible without
   * training the reader to ignore the line.
   */
  private lastThrottleLogAt = 0;
  private readonly THROTTLE_LOG_MS = 5 * 60_000;

  /**
   * #927 — throttles the trail-refusal warning. It is a property of the COMPUTATION (global
   * throttle), not of a position: with `trailDistanceFor` max()ing it should never fire, and if
   * it does, that is "a guard caught something that should be impossible".
   */
  private lastTrailRefusalAt = 0;

  /**
   * ⚠️ #892 — deduplicates identical bridge refusals.
   *
   * The guardian retries every 30s. A closed market refuses every edit with an
   * identical body, so an unthrottled ERROR is 3 lines per tick (~8,600/day) and it
   * buries the one refusal that would matter. Keyed on CONTENT rather than time, so a
   * DIFFERENT refusal still prints immediately.
   */
  private lastRefusalKey = '';
  private lastRefusalLogAt = 0;
  private readonly REFUSAL_LOG_MS = 5 * 60_000;

  /**
   * ⚠️ #893 — per-SYMBOL retry-not-before after the broker answers "Market closed".
   *
   * Between probes the guardian does not call the bridge at all (see
   * `modifyBlockedReason`), so a shut market costs one probe round per symbol per
   * window instead of one round per tick. The value is the ONLY lever: a short
   * window reacts faster to a re-open (the FX weekend is ~47h, and the first
   * successful tighten can only happen after it), a long one wastes less traffic.
   * 15 minutes bounds the post-reopen delay while cutting weekend calls by ~97%
   * (3 symbols x 4 probes/h vs 3 per 30s tick).
   */
  private marketClosedUntil = new Map<string, number>();
  private readonly MARKET_CLOSED_BACKOFF_MS = 15 * 60_000;

  /**
   * #893 — the refusal body from the LAST `bridgePost` call, cleared before every
   * post so `applyModify` can attribute a failure to THIS call. Distinct from
   * `state.lastBridgeRefusal`, which is a historical record for `/status` and is
   * overwritten by any refusal from any path.
   */
  private lastRefusalDetail: string | null = null;

  constructor(
    private readonly strategyService: TradingStrategyService,
    private readonly directivesService: DirectivesService,
    private readonly mt5Connection: Mt5ConnectionManager,
    private readonly adjustmentRecorder: StopAdjustmentRecorder,
    private readonly notifications?: NotificationService,
  ) {
    this.bridgeUrl = this.mt5Connection.getUrl();
  }

  // ── Loop Control ──────────────────────────────────────

  start() {
    if (this.state.enabled) {
      return { started: false, message: 'Stop Guardian is already running' };
    }
    this.state.enabled = true;
    this.scheduleNext();
    this.logger.log('Stop Guardian started');
    return { started: true, message: 'Stop Guardian started' };
  }

  stop() {
    this.state.enabled = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.log('Stop Guardian stopped');
    return { stopped: true, message: 'Stop Guardian stopped' };
  }

  private scheduleNext() {
    if (!this.state.enabled) return;
    this.timer = setTimeout(() => {
      this.tick().catch((err) =>
        this.logger.error(`Guardian tick failed: ${(err as Error).message}`),
      );
    }, this.state.tickIntervalMs);
  }

  // ── Bridge Helpers ────────────────────────────────────

  private async bridgeGet<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.bridgeUrl}${path}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  private async bridgePost(path: string, body: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${this.bridgeUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        // ⚠️ #892 — the bridge answers a REFUSED modify with a 4xx and a body of
        // `{'success': false, 'error': '<mt5 error>'}`. Returning a bare `false`
        // threw that away, so a refused stop edit was indistinguishable from a
        // successful one at every layer above: the caller sees only a boolean, and
        // the guardian then reports `0 adjusted` — which reads as "nothing needed
        // adjusting" rather than "the broker said no".
        let detail = '';
        try {
          detail = (await res.text()).slice(0, 300);
        } catch {
          detail = '<body unreadable>';
        }
        // Recorded on the state so `GET /status` says WHY, not just that nothing moved.
        this.state.lastBridgeRefusal = {
          at: new Date().toISOString(),
          path,
          detail: detail || `HTTP ${res.status}`,
        };
        // #893 — remembered for ONE decision (see `lastRefusalDetail`): whether this
        // refusal means "market closed".
        this.lastRefusalDetail = detail;
        // Throttled by content — see REFUSAL_LOG_MS. A repeated identical refusal is
        // still recorded above; only its log line is suppressed.
        const key = `${path} ${res.status} ${detail}`;
        const now = Date.now();
        const isRepeat =
          this.lastRefusalKey === key && now - this.lastRefusalLogAt < this.REFUSAL_LOG_MS;
        if (!isRepeat) {
          this.lastRefusalKey = key;
          this.lastRefusalLogAt = now;
          this.logger.error(
            `Bridge POST ${path} refused: HTTP ${res.status} ${detail}`,
          );
        }
      }
      return res.ok;
    } catch (err) {
      // ⚠️ #892 — a TRANSPORT failure is a different cause from "the broker said
      // no", and without this line the two are identical to every caller. The
      // bridge being down, the request timing out, and a rejected price are three
      // problems with three different fixes.
      this.logger.error(
        `Bridge POST ${path} failed: ${(err as Error).message}`,
      );
      return false;
    }
  }

  // ── Main Tick ──────────────────────────────────────────

  async tick() {
    if (!this.state.enabled || this.ticking) return [];
    this.ticking = true;
    const tickStart = Date.now();
    this.state.tickCount++;
    this.state.lastTickAt = new Date().toISOString();

    const adjustments: StopAdjustment[] = [];

    // #888 — instrumentation, and the reason it is kept: these counters are how the change
    // is VERIFIED rather than asserted. `resultsMap.size` is the number of directives
    // actually evaluated for this position and is exactly what the
    // STOP_GUARDIAN_DIRECTIVES filter below controls.
    //   BEFORE the filter: 505 evaluated per pass (101 registered x 5 positions), 780ms,
    //                      to read four results.
    //   AFTER:             20 (4 x 5).
    // The gap was invisible because the result map is only ever indexed by the four keys
    // the guardian reads - the other ~97 results were computed and thrown away.
    let directivesEvaluated = 0;
    let directiveMs = 0;

    try {
      // 1. Fetch active auto-mode strategies
      const strategies = await this.strategyService.findAll();
      const autoStrats = strategies.filter(
        (s: any) => s.active && s.mode === 'auto',
      );

      if (autoStrats.length === 0) {
        this.finishTick(tickStart);
        return [];
      }

      // 2. Fetch raw MT5 positions
      const posData = await this.bridgeGet<{ positions: Mt5RawPosition[] }>('/positions');
      const positions = posData?.positions || [];

      if (positions.length === 0) {
        this.state.guardedPositions = [];
        this.finishTick(tickStart);
        return [];
      }

      // 3. Evaluate each auto-strategy position
      const guarded: GuardedPosition[] = [];

      for (const strat of autoStrats) {
        const pos = positions.find(
          (p: Mt5RawPosition) =>
            p.symbol === strat.symbol && (p.comment || '').includes('TCS'),
        );
        if (!pos) continue;

        const side: 'BUY' | 'SELL' = pos.type === 'buy' ? 'BUY' : 'SELL';

        // 4. Load bars
        const candleData = await this.bridgeGet<{ bars: any[] }>(
          `/candles?symbol=${encodeURIComponent(strat.symbol)}&timeframe=5m&limit=30`,
        );
        const bars = candleData?.bars || [];
        if (bars.length < 14) {
          guarded.push(this.makeGuarded(pos, strat, side, null, 0, true));
          continue;
        }

        // 5. Run stop-focused directives - scoped to exactly the four IDs below (#888).
        const dStart = Date.now();
        const resultsMap = await this.directivesService.runAll(
          {
            symbol: strat.symbol,
            bars,
          },
          STOP_GUARDIAN_DIRECTIVES,
        );
        directiveMs += Date.now() - dStart;
        directivesEvaluated += resultsMap.size;

        // ⚠️ #890 — SYMPTOM guard for a declared-but-unresolvable directive.
        //
        // `Map.get()` returns `undefined` for a key that was never `set`; it does not
        // throw. So a directive this guardian reads but the registry never REGISTERED
        // contributes nothing to `stopConfidence` below, and the guard reads that
        // absence as "no evidence" rather than as an error — the "plausible numbers,
        // no error" class this repo keeps re-finding.
        //
        // Measured 2026-09-18: 3 of these 4 IDs were unregistered, so a `>= 55`
        // threshold calibrated for FOUR signals was applied to ONE, and the guardian
        // sat at `0 adjusted, 5 guarded` on every pass while every registry count
        // looked healthy (101 registered = 101 register() calls).
        //
        // ⚠️ Being listed in `providers` is NOT registration — the class is
        // constructed but unreachable by `runAll(filter)`. That is how this happened.
        //
        // This names the shortfall without needing to know its cause. Its build-time
        // sibling — validate-guardian-directive-ids.cjs
        // (INV-GUARDIAN-DIRECTIVE-RESOLVABLE) — stops the next occurrence from ever
        // reaching a running process.
        const unresolved = [...STOP_GUARDIAN_DIRECTIVES].filter((id) => !resultsMap.has(id));
        if (unresolved.length > 0) {
          const now = Date.now();
          if (now - this.lastDirectiveShortfallAt >= this.DIRECTIVE_SHORTFALL_LOG_MS) {
            this.lastDirectiveShortfallAt = now;
            this.logger.error(
              `GUARDIAN DIRECTIVES UNRESOLVED — ${unresolved.join(', ')} not in the registry. ` +
                `stopConfidence is derived from ${resultsMap.size} of ` +
                `${STOP_GUARDIAN_DIRECTIVES.size} declared inputs, so the >= 55 consensus ` +
                `threshold is being applied to fewer signals than it was calibrated for. ` +
                `See INV-GUARDIAN-DIRECTIVE-RESOLVABLE.`,
            );
          }
        }

        const atrStop = resultsMap.get('atr-trailing-stop');
        const superTrend = resultsMap.get('supertrend');
        const chandelier = resultsMap.get('chandelier-exit');
        const wickFilter = resultsMap.get('wick-filter');

        // 6. Wick filter check
        const wickPassed = !(wickFilter as any)?.metadata?.isFakeout;
        const wickScore = wickFilter?.score ?? null;

        if (!wickPassed) {
          guarded.push(
            this.makeGuarded(pos, strat, side, pos.sl, 15, false),
          );
          continue;
        }

        // 7. Side-aware confidence — only DIRECTIONAL evidence counts, and it
        //    must be aligned with the position's side (bullish helps a BUY,
        //    bearish helps a SELL). Opposing evidence reduces confidence.
        //    Missing/neutral directives are "no evidence", never a neutral 50.
        const directives = [atrStop, superTrend, chandelier, wickFilter];
        let alignedSum = 0;
        let alignedCount = 0;
        let opposingSum = 0;
        let opposingCount = 0;
        for (const d of directives) {
          if (!d || d.signalClass === 'neutral') continue;
          const isBullish = d.signalClass === 'bullish';
          const aligned = side === 'BUY' ? isBullish : !isBullish;
          if (aligned) {
            alignedSum += d.score;
            alignedCount += 1;
          } else {
            opposingSum += d.score;
            opposingCount += 1;
          }
        }
        const alignedAvg = alignedCount > 0 ? alignedSum / alignedCount : 0;
        const opposingAvg = opposingCount > 0 ? opposingSum / opposingCount : 0;
        const stopConfidence = Math.max(0, Math.round(alignedAvg - opposingAvg));

        // 8. ATR-based recommended SL — with the #927 DISTANCE FLOOR
        //
        // ⚠️ The trail distance is `max(3 × ATR(5m), the declared stop distance)` — see the
        // #927 docblock on `declaredStopDistance` for the seven closes that made this necessary.
        // 3 × ATR may WIDEN the trail; it may never tighten it inside the declared risk.
        const atrValue = this.computeAtr(bars);
        const currentPrice = pos.priceCurrent;
        const entryPrice = Number(pos.priceOpen) || 0;
        const slPct = Number(strat?.slPct ?? 1) || 1;
        const declaredDistance = declaredStopDistance(entryPrice, slPct);
        const trailDistance = trailDistanceFor(atrValue, declaredDistance);
        // Validation before use: refuse to place a stop closer than the declared distance.
        const distanceProblem = trailDistanceProblem(trailDistance, declaredDistance);
        if (distanceProblem) {
          this.logTrailRefusal(pos, distanceProblem);
        }
        let recommendedSl: number | null = null;

        if (atrValue > 0 && !distanceProblem) {
          if (side === 'BUY') {
            recommendedSl = currentPrice - trailDistance;
            if (pos.sl != null && pos.sl > 0 && recommendedSl < pos.sl)
              recommendedSl = pos.sl;
          } else {
            recommendedSl = currentPrice + trailDistance;
            if (pos.sl != null && pos.sl > 0 && recommendedSl > pos.sl)
              recommendedSl = pos.sl;
          }
        }

        // 9. Execute modification — two-layer stops (#721 decision 6), with the #927 distance floor:
        //    (a) protective floor: an UNLOCKED position (SL=0) is an emergency
        //        — set a relaxed broker-side disaster stop immediately, exempt
        //        from the cadence throttle. Distance = the strategy's own slPct from entry.
        //    (b) normal trailing: tighten toward the ATR stop — but NEVER closer to price than the
        //        declared distance, so a tighten can only ever improve WHERE the stop sits, never
        //        reduce the risk distance the strategy declared.
        if (pos.sl == null || pos.sl <= 0) {
          const protective = this.protectiveSl(pos, side, strat);
          if (protective != null) {
            await this.applyModify(
              pos,
              protective,
              `Protective floor (was unlocked) | ${strat.slPct ?? 1}% from entry`,
              stopConfidence,
              side,
              adjustments,
              true,
            );
          }
        } else {
          const shouldAdjust =
            stopConfidence >= 55 &&
            recommendedSl !== null &&
            Math.abs(recommendedSl - (pos.sl || 0)) > 0.00001;

          if (shouldAdjust) {
            await this.applyModify(
              pos,
              recommendedSl!,
              // #927 — the distance is recorded as a PERCENTAGE of price so `stop_adjustment` can
              // be read (and audited) without recomputing ATR from the price columns.
              `Consensus ${stopConfidence} | ATR=${atrValue.toFixed(5)} | ` +
                `dist=${currentPrice > 0 ? ((trailDistance / currentPrice) * 100).toFixed(3) : 'n/a'}% | ` +
                `Wick=${wickScore ?? 'n/a'}`,
              stopConfidence,
              side,
              adjustments,
              false,
              {
                atrTrailingStop: atrStop?.score ?? null,
                superTrend: superTrend?.score ?? null,
                chandelierExit: chandelier?.score ?? null,
                wickFilter: wickScore,
              },
            );
          }
        }

        guarded.push(
          this.makeGuarded(
            pos,
            strat,
            side,
            recommendedSl,
            stopConfidence,
            true,
          ),
        );
      }

      this.state.guardedPositions = guarded;
    } catch (err) {
      this.logger.error(`Guardian tick error: ${(err as Error).message}`);
    }

    this.finishTick(tickStart);
    this.logger.log(
      `Guardian #${this.state.tickCount}: ${adjustments.length} adjusted, ${this.state.guardedPositions.length} guarded ` +
        `(${directivesEvaluated} directives evaluated in ${directiveMs}ms, pass ${Date.now() - tickStart}ms)`,
    );
    return adjustments;
  }

  async runNow() {
    const adjustments = await this.tick();
    return { run: true, adjustments };
  }

  getState(): GuardianState {
    return {
      ...this.state,
      // #893 — the live backoff view: which symbols are paused and until when.
      // Computed rather than stored so a stale entry can never read as an active
      // pause (an expired one is dropped here), and so the field needs no init.
      marketClosedBackoff: [...this.marketClosedUntil.entries()]
        .filter(([, until]) => until > Date.now())
        .map(([symbol, until]) => ({ symbol, retryAt: new Date(until).toISOString() })),
    };
  }

  // ── Private Helpers ────────────────────────────────────

  private finishTick(tickStart: number) {
    this.state.lastTickMs = Date.now() - tickStart;
    this.state.nextTickAt = new Date(
      Date.now() + this.state.tickIntervalMs,
    ).toISOString();
    this.ticking = false;
    this.scheduleNext();
  }

  private makeGuarded(
    pos: Mt5RawPosition,
    strat: any,
    side: 'BUY' | 'SELL',
    recommendedSl: number | null,
    stopConfidence: number,
    wickFilterPassed: boolean,
  ): GuardedPosition {
    return {
      ticket: pos.ticket,
      symbol: strat.symbol,
      strategyId: strat.id,
      strategyName: strat.name,
      side,
      currentSl: pos.sl,
      recommendedSl,
      stopConfidence,
      wickFilterPassed,
      lastEvaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Relaxed broker-side protective stop (#721 decision 6) — the stop set when a position is
   * found UNLOCKED (SL=0). Distance = the strategy's own slPct from entry.
   *
   * ⚠️ #927 (2026-09-21) — WHAT SURVIVES THE TRAIL, STATED EXACTLY.
   *
   * MT5 has ONE stop-loss field per position, so a trailing tighten REPLACES this value: the
   * floor's NUMBER cannot persist, and the comment here used to claim it was "independent of the
   * tighter app-managed trailing stop" — unimplementable as written. The gap that left was
   * measured: stops trailed to 0.03–0.11% from entry against a declared ~1%, and 7 positions
   * closed on those stops inside 28 minutes, every close at a guardian-set price.
   *
   * What the design guarantees instead is the DISTANCE: `trailDistanceFor()` never lets a tighten
   * leave the stop closer to price than this declared distance, and `trailDistanceProblem()` makes
   * that check explicit (the tick refuses the modify if it fails). The floor's number can be
   * replaced by a trail; the floor's risk distance cannot be shrunk by one.
   */
  private protectiveSl(
    pos: Mt5RawPosition,
    side: 'BUY' | 'SELL',
    strat: any,
  ): number | null {
    const entry = Number(pos.priceOpen);
    if (!entry || entry <= 0) return null;
    const slPct = Number(strat?.slPct ?? 1) || 1;
    const protective =
      side === 'BUY' ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
    return Number(protective.toFixed(5));
  }

  /**
   * Broker-throttle gate — returns `null` if a modify may be sent now, or the
   * reason it may not.
   *
   * ⚠️ #892 — this used to return a bare boolean and the caller logged the block
   * at `debug`, which Nest never prints at the default level. A stop edit that
   * could never go out was therefore completely invisible. Naming the reason is
   * what makes the two cases distinguishable: the per-position cadence is normal
   * and self-clearing, whereas the global cap means edits are being dropped.
   */
  private modifyBlockedReason(symbol: string, ticket: number, priority: boolean): string | null {
    const now = Date.now();
    // #893 — strongest reason first: the broker ALREADY said this market is closed.
    // Checked before `priority` is consulted because a shut market refuses a
    // protective floor exactly as it refuses a trailing tighten — attempting the
    // emergency write during the backoff window cannot succeed, and the backoff
    // always expires (15m) so the floor is still set promptly after a re-open.
    const closedUntil = this.marketClosedUntil.get(symbol) || 0;
    if (now < closedUntil) {
      return `market closed (broker refusal) — next probe in ${Math.ceil((closedUntil - now) / 60_000)}m (#893)`;
    }
    this.modifyTimes = this.modifyTimes.filter((t) => now - t < 60_000);
    // Global hard cap applies to everyone (incl. protective floors) to avoid
    // tripping broker throttling during a mass-unlock event.
    if (this.modifyTimes.length >= this.MAX_MODIFY_PER_MINUTE) {
      return `global cap — ${this.modifyTimes.length} modify(s) already sent in the last 60s (max ${this.MAX_MODIFY_PER_MINUTE})`;
    }
    if (!priority) {
      const last = this.lastModifyAt.get(ticket) || 0;
      if (now - last < this.MIN_MODIFY_INTERVAL_MS) {
        return `per-position cadence — ${Math.round((now - last) / 1000)}s since the last edit on #${ticket} (min ${this.MIN_MODIFY_INTERVAL_MS / 1000}s)`;
      }
    }
    return null;
  }

  /** Throttled so the legitimate cadence blocks cannot flood the log they live in. */
  private logThrottle(symbol: string, ticket: number, reason: string): void {
    const now = Date.now();
    if (now - this.lastThrottleLogAt < this.THROTTLE_LOG_MS) return;
    this.lastThrottleLogAt = now;
    this.logger.warn(`Stop modify blocked: ${symbol} #${ticket} — ${reason}`);
  }

  /**
   * #927 — throttles the "trail would violate the declared distance" warning.
   * As a property of the computation (not of a position), it is throttled globally; with
   * `trailDistanceFor` max()ing it should never fire, and if it ever does, once per 5 minutes is
   * the right loudness for "a guard just caught something that should be impossible".
   */
  private logTrailRefusal(pos: Mt5RawPosition, problem: string): void {
    const now = Date.now();
    if (now - this.lastTrailRefusalAt < this.THROTTLE_LOG_MS) return;
    this.lastTrailRefusalAt = now;
    this.logger.warn(`Trail tighten REFUSED for ${pos.symbol} #${pos.ticket} — ${problem}`);
  }

  /**
   * Post an SL modification, throttle-aware, and record + notify on success.
   * `priority` bypasses the per-position cadence (used for the protective
   * floor when a position is unlocked), but never the global cap.
   */
  private async applyModify(
    pos: Mt5RawPosition,
    newSl: number,
    reason: string,
    confidence: number,
    side: 'BUY' | 'SELL',
    adjustments: StopAdjustment[],
    priority: boolean,
    directiveScores?: Record<string, number | null>,
  ): Promise<boolean> {
    const blocked = this.modifyBlockedReason(pos.symbol, pos.ticket, priority);
    if (blocked) {
      this.logThrottle(pos.symbol, pos.ticket, blocked);
      return false;
    }

    // #893 — cleared so a refusal recorded during THIS call is unambiguous.
    this.lastRefusalDetail = null;
    const ok = await this.bridgePost('/order/modify', {
      ticket: pos.ticket,
      sl: newSl,
    });

    if (ok) {
      // #893 — a successful edit proves the market is open: drop any backoff.
      this.marketClosedUntil.delete(pos.symbol);
      const now = Date.now();
      this.lastModifyAt.set(pos.ticket, now);
      this.modifyTimes.push(now);

      const entry: StopAdjustment = {
        timestamp: new Date().toISOString(),
        ticket: pos.ticket,
        symbol: pos.symbol,
        oldSl: pos.sl,
        newSl,
        reason,
        stopConfidence: confidence,
      };
      adjustments.push(entry);
      this.state.recentAdjustments = [
        entry,
        ...this.state.recentAdjustments,
      ].slice(0, 50);
      this.logger.log(
        `Stop: ${pos.symbol} #${pos.ticket} SL ${pos.sl} → ${newSl} (${confidence}%)`,
      );
      // Persist the adjustment to the stop_adjustment audit trail (#476).
      this.adjustmentRecorder.recordAdjustment({
        tradeTicket: String(pos.ticket),
        symbol: pos.symbol,
        oldSl: pos.sl,
        newSl,
        oldTp: pos.tp,
        newTp: pos.tp,
        reason,
        directiveScores: directiveScores ?? undefined,
      });
      this.notifications
        ?.send({
          title: `🛡️ Stop adjusted — ${pos.symbol}`,
          body: `${side} #${pos.ticket} SL ${pos.sl} → ${newSl.toFixed(5)} — ${reason}`,
          symbol: pos.symbol,
          event: 'stop-adjusted',
          metadata: { ticket: pos.ticket, oldSl: pos.sl, newSl, side, reason },
        })
        .catch(() => {});
    } else if (/market\s+(is\s+)?closed/i.test(this.lastRefusalDetail ?? '')) {
      // #893 — the bridge answered `{"success": false, "error": "Market closed"}`.
      // That is the broker stating the market is shut, so re-asking every cadence
      // window cannot succeed. Arm the per-symbol backoff; `modifyBlockedReason`
      // then skips this symbol until it expires, and a later SUCCESS clears it.
      // Any OTHER refusal (invalid stops, no such position) deliberately does NOT
      // back off — those need attention, not silence.
      this.marketClosedUntil.set(pos.symbol, Date.now() + this.MARKET_CLOSED_BACKOFF_MS);
      this.logger.warn(
        `Stop edits for ${pos.symbol} paused ${Math.round(this.MARKET_CLOSED_BACKOFF_MS / 60_000)}m — broker refused with "Market closed" (#893)`,
      );
    }
    return ok;
  }

  private computeAtr(bars: any[]): number {
    const highs = bars.map((b: any) => b.high);
    const lows = bars.map((b: any) => b.low);
    const closes = bars.map((b: any) => b.close);
    const trueRanges: number[] = [];
    for (let i = 1; i < Math.min(15, bars.length); i++) {
      trueRanges.push(
        Math.max(
          highs[i] - lows[i],
          Math.abs(highs[i] - closes[i - 1]),
          Math.abs(lows[i] - closes[i - 1]),
        ),
      );
    }
    return trueRanges.length > 0
      ? trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length
      : 0;
  }
}
