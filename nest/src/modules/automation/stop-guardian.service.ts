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

        // 8. ATR-based recommended SL
        const atrValue = this.computeAtr(bars);
        const currentPrice = pos.priceCurrent;
        let recommendedSl: number | null = null;

        if (atrValue > 0) {
          const trailDistance = 3 * atrValue;
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

        // 9. Execute modification — two-layer stops (#721 decision 6):
        //    (a) protective floor: an UNLOCKED position (SL=0) is an emergency
        //        — set a relaxed broker-side disaster stop immediately, exempt
        //        from the cadence throttle.
        //    (b) normal trailing: tighten toward the ATR stop, throttled.
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
              `Consensus ${stopConfidence} | ATR=${atrValue.toFixed(5)} | Wick=${wickScore ?? 'n/a'}`,
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
    return this.state;
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
   * Relaxed broker-side protective stop (#721 decision 6) — the disaster
   * floor every position MUST carry, independent of the tighter app-managed
   * trailing stop. Distance = the strategy's own slPct from entry.
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
  private modifyBlockedReason(ticket: number, priority: boolean): string | null {
    const now = Date.now();
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
    const blocked = this.modifyBlockedReason(pos.ticket, priority);
    if (blocked) {
      this.logThrottle(pos.symbol, pos.ticket, blocked);
      return false;
    }

    const ok = await this.bridgePost('/order/modify', {
      ticket: pos.ticket,
      sl: newSl,
    });

    if (ok) {
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
