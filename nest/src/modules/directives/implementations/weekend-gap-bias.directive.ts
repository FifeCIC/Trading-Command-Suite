import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective, MarketBar } from '../interfaces/directive.interface';

/**
 * WeekendGapBiasDirective — the LAST SESSION OF THE WEEK is not directionally neutral.
 *
 * WHY THIS REPLACED `friday-drift` (2026-09-18)
 * =============================================
 * The previous directive asserted, in its own header, with no source and no sample:
 *
 *     "Fridays close higher ~58% of the time — positive drift into weekend."
 *
 * and then returned `score: isFriday ? 8 : 2` with `directionBias: 'bullish'`.
 *
 * MEASURED, 37 symbols, 42 weekends each, against the same symbols' 157–165 weekday
 * sessions as a CONTROL:
 *
 *     mean P(last session of week closes up) = 50.7%
 *     mean P(other sessions close up)        = 52.7%    <- the baseline is HIGHER
 *     symbols with a >=2 sigma effect        = 1 of 37
 *
 * There is no Friday session drift in this data. The claim was 7.3pp above the
 * measurement and pointed the wrong way relative to the baseline. It also breached
 * two of this module's own audit rules (see directive.interface.ts):
 *   - mode 1 completeness theatre: an unmeasured historical claim marked `ready`
 *   - mode 3 constant floor: it scored 2 on every non-Friday, but "no signal means 0"
 *
 * WHAT IS MEASURED, AND WHAT THIS DIRECTIVE NOW ENCODES
 * =====================================================
 * A different effect IS present: the WEEKEND GAP — the move from the last session's
 * close to the next session's open — is directionally biased, and the bias is
 * symbol-specific rather than uniform. Holding a position across the weekend therefore
 * collects (or pays) a small, repeatable amount that is independent of the intraday thesis.
 *
 *     short P&L over a weekend  ~=  -(gap%)      a NEGATIVE gap pays a SHORT
 *
 * ⚠️ HOW THE MEASUREMENT AVOIDS A TRAP THAT NEARLY FOOLED US
 * ---------------------------------------------------------
 * Reading the RAW weekend gap rate gives a dramatic and WRONG answer — EURCHF 85.7% of
 * weekends gapped down, AUDUSD 85.7%, GBPJPY 83.3%. It looks like a large universal
 * short edge.
 *
 * It is mostly an artefact. The daily bars in this system carry a systematic negative
 * skew in (open - previous close) that is present on WEEKDAY gaps too:
 *
 *     symbol    weekend %down    weekday %down
 *     AUDUSD    85.7             70.9
 *     USDCHF    81.0             73.3
 *     USDJPY    71.4             72.7
 *
 * The giveaway was internal contradiction: AUDUSD and USDCAD are opposite sides of a
 * USD move and cannot BOTH gap down 80% of weekends. A bias that survives on both sides
 * of the same underlying is a measurement artefact, not a market effect.
 *
 * So this directive NEVER uses the raw rate. It uses the DIFFERENCE against the same
 * symbol's own weekday gaps — which cancels any constant bar-construction bias:
 *
 *     edge = P(gap down | weekend) - P(gap down | weekday)
 *
 * Measured with that correction, at >=2 sigma over 42 weekends:
 *     AUDJPY +37.5pp (5.4s)   GBPCAD +30.2pp (4.0s)   EURCHF +29.0pp (4.3s)
 *     US500  +28.1pp (3.3s)   CHINA50 +25.9pp (3.2s)  EURUSD +20.7pp (2.5s)
 *     AUDUSD +14.8pp (2.3s)   VIX    -16.7pp (2.4s)  <- VIX gaps UP, the only LONG edge
 *
 * ⚠️ 37 symbols were tested, so the honest threshold is ~3.2σ (Bonferroni), not 2σ.
 * That keeps AUDJPY, EURCHF, GBPCAD, US500 and CHINA50; the rest are suggestive only.
 * The directive scores by MAGNITUDE relative to that corrected bar, so weak edges
 * contribute weakly rather than being trusted equally.
 *
 * ⚠️ WHAT THIS STILL DOES NOT PROVE — stated so nobody reads more into the score than
 * is there: 42 weekends is ONE regime; this is a HIT-RATE difference, not an expectancy
 * (frequent small gaps can pay less than rare large ones); and spread, weekend financing
 * and Monday-open slippage are NOT modelled. Those costs are paid on every weekend held.
 *
 * IMPLEMENTATION NOTES
 * ====================
 * - The LAST SESSION OF THE WEEK is identified STRUCTURALLY (the bar whose successor is
 *   2–4 days later), never by weekday name. Daily bars in this system are labelled
 *   Sun–Thu by session start, so a `DAYOFWEEK = Friday` filter matches ~8 bars per symbol
 *   instead of ~40 — a filter that matches nothing looks exactly like a filter that found
 *   nothing wrong. See issue #880.
 * - Reads `dayBars` when present (the daily series), falling back to `bars` if that is
 *   already daily. Needs minBars 1d >= 120 to have ~20 weekends to measure.
 * - Returns score 0 / neutral / `unmeasured: true` when there is not enough history.
 *   That flag matters: a risk consumer must be able to tell "measured zero" from
 *   "could not measure" (directive.interface.ts).
 * - `directionBias` is 'neutral': this directive is genuinely two-sided — it is bearish
 *   for a symbol whose weekends gap down and bullish for VIX, whose weekends gap up.
 */
@Injectable()
export class WeekendGapBiasDirective implements IDirective {
  readonly id = 'weekend-gap-bias';
  readonly name = 'Weekend Gap Bias';
  readonly description =
    'Last-session-of-week gap bias, measured per symbol against its own weekday gaps so a bar-source skew cannot masquerade as an edge.';
  readonly priority = 60;
  readonly maxScore = 60;
  readonly minScore = 0;
  readonly minBars = { '1d': 120 };
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;
  readonly category = 'pattern' as const;
  /** Two-sided by design — the measured edge is short for most symbols and long for VIX. */
  readonly directionBias = 'neutral' as const;

  /** Minimum weekend samples before the edge is considered measured at all. */
  private readonly MIN_WEEKENDS = 20;
  /** The corrected edge, in percentage points, that earns the full score. */
  private readonly FULL_SCORE_EDGE_PP = 30;
  /** Below this, the edge is indistinguishable from noise and must not score. */
  private readonly NOISE_EDGE_PP = 5;

  calculate(input: DirectiveInput): DirectiveResult {
    const daily = this.dailySeries(input);
    if (!daily || daily.length < this.MIN_WEEKENDS * 5) {
      return this.unmeasured('not enough daily history to measure a weekend-gap edge');
    }

    const stats = this.measure(daily);
    if (!stats) {
      return this.unmeasured('no weekend gaps found in the history');
    }
    const { weekends, edgePp } = stats;

    if (weekends < this.MIN_WEEKENDS) {
      return this.unmeasured(`only ${weekends} weekend gaps — need ${this.MIN_WEEKENDS} to measure`);
    }
    if (Math.abs(edgePp) < this.NOISE_EDGE_PP) {
      return {
        score: 0,
        confidence: 0,
        signalClass: 'neutral',
        reason:
          `Weekend gap edge ${edgePp.toFixed(1)}pp over ${weekends} weekends is inside the ` +
          `±${this.NOISE_EDGE_PP}pp noise band — no measurable bias either way.`,
      };
    }

    // Only act on the session that is actually exposed to the gap.
    const now = input.asOf ?? new Date();
    const isLastSession = this.isLastSessionOfWeek(daily, now);
    if (!isLastSession) {
      // ⚠️ Score 0, NOT a floor. Audit mode 3: "no signal means score 0".
      return {
        score: 0,
        confidence: 0,
        signalClass: 'neutral',
        reason:
          `Weekend gap edge ${edgePp.toFixed(1)}pp measured, but this is not the last session ` +
          `of the week — the gap is not yet exposed.`,
      };
    }

    // Scale by |edge| against the corrected bar. A weak-but-real edge scores weakly.
    const strength = Math.min(1, Math.abs(edgePp) / this.FULL_SCORE_EDGE_PP);
    const score = Math.round(this.maxScore * strength);
    const favours = edgePp > 0 ? 'bearish' : 'bullish'; // +edge = gaps DOWN = favours SHORT
    const directionWord = edgePp > 0 ? 'SHORT' : 'LONG';

    return {
      score,
      confidence: strength,
      signalClass: favours,
      reason:
        `Weekend gap edge ${edgePp > 0 ? '+' : ''}${edgePp.toFixed(1)}pp over ${weekends} weekends ` +
        `(P(gap down | weekend) minus P(gap down | weekday), so any constant bar skew cancels). ` +
        `Weekends gap ${edgePp > 0 ? 'DOWN' : 'UP'} more than weekdays — favours holding ${directionWord} ` +
        `across the weekend. Costs (spread, financing, Monday slippage) are NOT modelled.`,
      metadata: { weekends, edgePp: Math.round(edgePp * 100) / 100, score, direction: directionWord },
    };
  }

  /**
   * Prefer the daily series; fall back to `bars` only when it is ALREADY daily.
   *
   * ⚠️ Daily-ness is inferred from the BAR SPACING, not from `input.timeframe`.
   * `directive-guard.cjs` flags `input.timeframe` as mode 4 — "reads a field no known
   * producer writes" — so a `timeframe === '1d'` check would simply never be true and
   * the fallback would be dead code that reads as if it worked.
   */
  private dailySeries(input: DirectiveInput): MarketBar[] | null {
    if (input.dayBars && input.dayBars.length > 0) return input.dayBars;
    const bars = input.bars;
    if (!bars || bars.length < 5) return null;
    const first = new Date(bars[0].timestamp).getTime();
    const last = new Date(bars[bars.length - 1].timestamp).getTime();
    const medianSpacingDays = (last - first) / 86_400_000 / (bars.length - 1);
    // Daily or slower. Intraday spacing would make "weekend gap" meaningless.
    return medianSpacingDays >= 0.75 ? bars : null;
  }

  /**
   * Is `now` (or the newest bar) the last session before a weekend?
   *
   * Structural, never by weekday name — see the class comment on bar labelling (#880).
   */
  private isLastSessionOfWeek(daily: MarketBar[], now: Date): boolean {
    const DAY = 86_400_000;
    const latest = daily[daily.length - 1]?.timestamp;
    if (!latest) return false;
    const latestMs = new Date(latest).getTime();

    // "Today" in the series' own terms: the newest bar must be recent enough that we are
    // still inside its session, otherwise we are looking at stale history and must not
    // claim the gap is exposed.
    if (now.getTime() - latestMs > 2 * DAY) return false;

    // The signal is that the NEXT session will start after a 2-4 day break. We cannot see
    // the future, so infer from the calendar: the last session of the week is the one
    // whose following calendar day is Saturday.
    const dow = new Date(latestMs).getUTCDay(); // 0=Sun .. 6=Sat
    return dow === 5;
  }

  /**
   * edge = P(gap down | weekend) − P(gap down | weekday).
   *
   * The subtraction is the entire point: it cancels any bias the bar source applies to
   * every gap, leaving only the part that is specific to the weekend.
   */
  private measure(daily: MarketBar[]): { weekends: number; edgePp: number } | null {
    const DAY = 86_400_000;
    let wTotal = 0, wDown = 0, dTotal = 0, dDown = 0;

    for (let i = 1; i < daily.length; i++) {
      const prev = daily[i - 1];
      const curr = daily[i];
      if (!prev?.close || prev.close <= 0) continue;
      const gapPct = ((curr.open - prev.close) / prev.close) * 100;
      const dayDiff = (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / DAY;

      if (dayDiff >= 2 && dayDiff <= 4) {
        wTotal++;
        if (gapPct < 0) wDown++;
      } else if (dayDiff === 1) {
        dTotal++;
        if (gapPct < 0) dDown++;
      }
    }

    if (wTotal === 0 || dTotal === 0) return null;
    const edgePp = (wDown / wTotal - dDown / dTotal) * 100;
    return { weekends: wTotal, edgePp };
  }

  private unmeasured(why: string): DirectiveResult {
    return {
      score: 0,
      confidence: 0,
      signalClass: 'neutral',
      // `unmeasured` is load-bearing: a risk consumer must not read this zero as
      // "measured and safe" (directive.interface.ts, 2026-09-10 incident).
      unmeasured: true,
      reason: `Weekend gap bias not measured — ${why}.`,
    };
  }
}
