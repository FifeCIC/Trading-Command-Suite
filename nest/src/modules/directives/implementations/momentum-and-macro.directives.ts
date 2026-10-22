/**
 * Momentum, Macro & Pattern Directives
 * ====================================
 * ⚠️ RENAMED 2026-09-10. This file was `placeholder-directives.stub.ts`, and the
 * name caused real harm: it led an investigation to describe its contents as
 * "not real data" and to question whether live scoring was running on
 * placeholders. It is not and never was — the participants here compute from
 * real market bars. The name was a leftover from when the file DID hold stubs.
 *
 * WHAT THIS FILE ACTUALLY CONTAINS
 * --------------------------------
 * Directives with real implementations whose math lives inline rather than in a
 * dedicated `*.directive.ts` file. A directive belongs here when its logic is
 * short enough that a separate file adds ceremony, not clarity.
 *
 * Real, `readiness: 'ready'`, and consumed by live protocols:
 *   - `volatility-tools`        ATR(14) + percentile rank + bonus  (25 protocols)
 *   - `analyst-adjustments`     momentum-acceleration proxy        (19 protocols)
 *   - `moving-averages`         SMA20/50/200 alignment             (4 protocols)
 *   - `macd`                    MACD(12,26,9) crossover            (3 protocols)
 *   - `sp500-regime`            SMA200 regime                     (2 protocols)
 *   - `mean-reversion`          Bollinger sigma-distance          (2 protocols)
 *   - `conviction-growth`       multi-timeframe EMA/SMA           (2 protocols)
 *   - `spy-qqq-relative-strength` 5d/20d momentum acceleration     (4 protocols)
 *
 * The remainder are `readiness: 'beta'` or lower and are wired into NO protocol,
 * so they cannot influence execution. Before promoting one to `ready`, verify
 * its math against real bars — see the directive audit checklist in
 * `interfaces/directive.interface.ts`.
 *
 * HISTORY (why the old name was once accurate)
 * --------------------------------------------
 * This file originally held ~55 stubs returning a constant `stubResult`. Issue
 * #641 removed 28 dead classes and 14 dead standalone files; the survivors were
 * reimplemented in place and promoted on 2026-08-15. The `stubResult` factory
 * below is the vestige — it is retained only because a few `beta` classes still
 * call it, and it is a marker for "not implemented" rather than a source of
 * scores. Those classes are excluded from scoring by their readiness tier.
 *
 * DO NOT add a stub here for a NEW directive — an unimplemented directive should
 * be `readiness: 'alpha'` so it is excluded from the composite entirely.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { retiredCalendarClaim } from './retired-calendar-claim';
import { rsi, sma, ema, bollingerBands, macd, atr } from '../utils/indicators';

/**
 * Marker result for a class that is declared but not yet implemented.
 *
 * ⚠️ MUST NOT be reachable from a `ready` directive. A `ready` class returning
 * this would present "not implemented" as a real zero reading, which is the
 * same class of fault as the fabricated-score bug fixed on 2026-09-10. Callers
 * are `beta`-tier classes, which scoring excludes.
 */
function stubResult(directiveId: string, phpFile?: string): DirectiveResult {
  const src = phpFile
    ? `Math in TradePress includes/scoring-system/directives/${phpFile}`
    : 'Documented in strategy docs — not yet spec\'d as directive';
  return {
    signalClass: 'neutral',
    score: 0,
    confidence: 0,
    reason: `[STUB] ${directiveId}: Not yet implemented. ${src}.`,
    // `unmeasured` so that if one of these ever escapes the readiness filter it
    // contributes no score and can never trip a risk gate or fabricate a grade.
    unmeasured: true,
    metadata: { performance: 'stub', status: 'underperforming', stubbedAt: '2026-06-10' },
  };
}

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}


// ===========================================================================
// Momentum
// ===========================================================================













// ===========================================================================
// Trend
// ===========================================================================

@Injectable()
export class MovingAveragesDirective implements IDirective {
  readonly id = 'moving-averages';
  readonly name = 'Moving Averages Alignment';
  readonly description = 'Bullish MA alignment (20>50>200).';
  readonly priority = 72;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const; // promoted beta→ready 2026-08-15 — real SMA20/50/200 alignment math

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };

    const sma20 = sma(closes, 20);
    const sma50 = closes.length >= 50 ? sma(closes, 50) : sma20;
    const sma200 = closes.length >= 200 ? sma(closes, 200) : (closes.length >= 50 ? sma50 : sma20);
    const lastClose = closes[closes.length - 1];

    // BASE (15-85): trend strength from price position relative to SMAs
    const dist20 = sma20 > 0 ? ((lastClose - sma20) / sma20) * 100 : 0;
    const dist50 = sma50 > 0 ? ((lastClose - sma50) / sma50) * 100 : dist20;
    const avgDist = (dist20 + dist50) / 2;
    const baseScore = Math.round(mapRange(avgDist, -5, 5, 15, 85));

    // BONUS: full bullish/bearish alignment
    let bonusScore = 0;
    let bonusLabel = '';
    const fullBullish = lastClose > sma20 && sma20 > sma50 && sma50 > sma200;
    const fullBearish = lastClose < sma20 && sma20 < sma50 && sma50 < sma200;
    if (fullBullish) { bonusScore = 15; bonusLabel = 'full bullish alignment'; }
    else if (fullBearish) { bonusScore = 15; bonusLabel = 'full bearish alignment'; }
    else {
      const bullCount = (lastClose > sma20 ? 1 : 0) + (sma20 > sma50 ? 1 : 0) + (sma50 > sma200 ? 1 : 0);
      if (bullCount >= 2) { bonusScore = 8; bonusLabel = 'partial bullish (2/3)'; }
    }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = avgDist > 1 ? 'bullish' : avgDist < -1 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.abs(avgDist) * 0.08).toFixed(2)),
      reason: `MA alignment: price ${avgDist.toFixed(1)}% vs SMAs, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, avgDist, sma20, sma50, sma200 },
    };

  }
}



@Injectable()
export class PriceAboveSma50Directive implements IDirective {
  readonly id = 'price-above-sma-50';
  readonly name = 'Price Above SMA 50';
  readonly description = 'Price sustaining above 50-day SMA.';
  readonly priority = 68;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 60) return { score: 0, confidence: 0.1, reason: `Need 60+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const s50 = sma(closes, 50);
    if (s50 === 0 || isNaN(s50)) return { score: 0, confidence: 0.1, reason: 'SMA calculation failed', signalClass: 'neutral' };
    const lastPrice = closes[closes.length - 1];
    const pctAbove = ((lastPrice - s50) / s50) * 100;
    // Check how many of last 5 closes were above SMA50
    let aboveCount = 0;
    for (let i = closes.length - 5; i < closes.length; i++) {
      if (i >= 0 && closes[i] > s50) aboveCount++;
    }
    if (pctAbove > 5 && aboveCount >= 5) return { score: 80, confidence: 0.6, reason: `Strong above SMA50: +${pctAbove.toFixed(1)}% (${aboveCount}/5 bars)`, signalClass: 'bullish' };
    if (pctAbove > 0 && aboveCount >= 3) return { score: 55, confidence: 0.4, reason: `Above SMA50: +${pctAbove.toFixed(1)}%`, signalClass: 'bullish' };
    if (pctAbove < -5) return { score: 60, confidence: 0.4, reason: `Below SMA50: ${pctAbove.toFixed(1)}%`, signalClass: 'bearish' };
    if (pctAbove < 0) return { score: 30, confidence: 0.3, reason: `Slightly below SMA50`, signalClass: 'bearish' };
    return { score: Math.round(20 + pctAbove * 2), confidence: 0.25, reason: `At SMA50 +${pctAbove.toFixed(1)}%`, signalClass: 'neutral' };
  }
}

// ===========================================================================
// Volatility
// ===========================================================================



@Injectable()
export class VolatilityToolsDirective implements IDirective {
  readonly id = 'volatility-tools';
  readonly name = 'Volatility Calculator';
  readonly description = 'Historical vol, ATR percentile, beta proxy utility.';
  readonly priority = 66;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const; // promoted beta→ready 2026-08-15 — real ATR(14) math, signalClass neutralised, reachable maxScore

  calculate(input: DirectiveInput): DirectiveResult {

    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };

    const atrVals = atr(highs, lows, closes, 14);
    if (!atrVals.length) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'ATR calculation failed' };
    const currentAtr = atrVals[atrVals.length - 1];
    const lastClose = closes[closes.length - 1];
    const atrPct = (currentAtr / lastClose) * 100;

    // BASE (15-70): ATR percentile in recent range
    const sortedAtr = [...atrVals.slice(-20)].sort((a, b) => a - b);
    const rank = sortedAtr.findIndex(v => v >= currentAtr);
    const percentile = rank >= 0 ? (rank / sortedAtr.length) * 100 : 50;
    const baseScore = Math.round(mapRange(percentile, 0, 100, 15, 70));

    // BONUS: extreme ATR
    let bonusScore = 0;
    let bonusLabel = '';
    if (atrPct > 3) { bonusScore = 20; bonusLabel = 'extreme volatility (ATR>3%)'; }
    else if (atrPct > 1.5) { bonusScore = 10; bonusLabel = 'elevated volatility'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass: 'neutral', // 2026-08-14: volatility is direction-neutral — low ATR ≠ bullish
      score: total,
      confidence: Number((0.3 + Math.min(0.3, atrPct * 0.08)).toFixed(2)),
      reason: `Vol: ATR=${atrPct.toFixed(2)}% (p${percentile.toFixed(0)}), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, atrPct, percentile },
    };

  }
  private extract(input: DirectiveInput) { const bars = input.bars; return { highs: bars.map(b => b.high), lows: bars.map(b => b.low), closes: bars.map(b => b.close) }; }
}

// ===========================================================================
// Volume
// ===========================================================================







// ===========================================================================
// Candlestick Patterns
// ===========================================================================







@Injectable()
export class PinBarPatternDirective implements IDirective {
  readonly id = 'pin-bar-pattern';
  readonly name = 'Pin Bar Pattern';
  readonly description = 'Pin bar rejecting lower prices = support confirmed.';
  readonly priority = 66;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 10) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 10+ bars, have ${bars.length}` };

    const last = bars[bars.length - 1];
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    if (range <= 0) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Zero-range bar' };
    const upperWick = last.high - Math.max(last.open, last.close);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const maxWick = Math.max(upperWick, lowerWick);
    const wickBodyRatio = body > 0 ? maxWick / body : 10;

    // BASE (15-60): wick-to-body ratio
    const baseScore = Math.round(mapRange(wickBodyRatio, 1, 5, 15, 60));

    // BONUS: extreme ratios + context
    let bonusScore = 0;
    let bonusLabel = '';
    if (wickBodyRatio >= 5) { bonusScore = 20; bonusLabel = 'extreme wick ratio (' + wickBodyRatio.toFixed(1) + 'x)'; }
    else if (wickBodyRatio >= 3) { bonusScore = 10; bonusLabel = 'strong pin bar'; }

    // Context bonus: at new extreme
    const recentHighs = bars.slice(-10, -1).map(b => b.high);
    const recentLows = bars.slice(-10, -1).map(b => b.low);
    const avgHigh = recentHighs.reduce((a, b) => a + b, 0) / recentHighs.length;
    const avgLow = recentLows.reduce((a, b) => a + b, 0) / recentLows.length;
    if (lowerWick > upperWick && last.low < avgLow) { bonusScore += 10; bonusLabel += (bonusLabel ? ' + ' : '') + 'at new low'; }
    if (upperWick > lowerWick && last.high > avgHigh) { bonusScore += 10; bonusLabel += (bonusLabel ? ' + ' : '') + 'at new high'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const isBullish = lowerWick > upperWick && last.close > last.open;
    const signalClass: 'bullish' | 'bearish' | 'neutral' = isBullish ? 'bullish' : (!isBullish && maxWick > body * 2) ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.min(0.35, wickBodyRatio * 0.06)).toFixed(2)),
      reason: `Pin bar: wick/body=${wickBodyRatio.toFixed(1)}x, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, wickBodyRatio, upperWick, lowerWick },
    };

  }
}



// ===========================================================================
// Macro / Regime
// ===========================================================================



// ===========================================================================
// Temporal / Calendar
// ===========================================================================



@Injectable()
export class FridayPositioningDirective implements IDirective {
  // ── RETIRED 2026-10-09 (#879) ──
  // CLAIMED: "end-of-week profit-taking" — a day-of-week lookup table (Friday 30, other days
  // 8-20) that SCORED ON EVERY DAY OF THE WEEK with no measurement behind any cell.
  // MEASURED: the family's dated biases were tested with difference-in-differences and did not
  // reproduce (friday-drift 50.7% vs a 52.7% baseline; monday-effect +0.44pp t=0.36;
  // turnaround-tuesday +0.35pp t=0.30 — 0 of 45 symbols at the honest threshold). Unmeasured.
  readonly id = 'friday-positioning';
  readonly name = 'Friday Positioning (retired)';
  readonly description =
    'RETIRED — the asserted end-of-week positioning effect is unmeasured; the old form scored every day of the week from a lookup table. See #879.';
  readonly priority = 30;
  readonly maxScore = 50;
  readonly version = '3.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('Friday positioning retired: unmeasured day-of-week claim (#879). Contributes nothing.');
  }
}

@Injectable()
export class MidweekMomentumDirective implements IDirective {
  readonly id = 'midweek-momentum';
  readonly name = 'Midweek Momentum';
  readonly description = 'Tue-Thu historically strongest sessions for trend continuation.';
  readonly priority = 32;
  readonly maxScore = 55;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 5) {
      return {
        signalClass: 'neutral',
        score: 0,
        confidence: 0.1,
        reason: 'Need 5+ bars',
        // UNMEASURED — not enough data to judge midweek momentum at all
        // (INV-NO-FABRICATED-READING).
        unmeasured: true,
      };
    }
    const lastBar = bars[bars.length - 1];
    const day = lastBar.timestamp ? new Date(lastBar.timestamp).getUTCDay() : new Date().getUTCDay();
    const closes = bars.map(b => b.close);
    const lastClose = closes[closes.length - 1];
    const prevClose = closes[Math.max(0, closes.length - 5)];
    const recentReturn = prevClose > 0 ? ((lastClose - prevClose) / prevClose) * 100 : 0;

    const isMidweek = day >= 2 && day <= 4;

    // ── DIRECTION REQUIRES A REAL MOVE, NOT A SIGN TEST ─────────────────
    // ⚠️ Was `isMidweek && recentReturn > 0 ? 'bullish' : 'neutral'` — a sign
    // test, so momentum of +0.01% (indistinguishable from zero) produced a full
    // `bullish` classification. Meanwhile `baseScore` mapped `recentReturn`
    // across `-2..3` → `10..35`, so a NEGATIVE return still scored up to ~10
    // while being classified neutral: a non-zero score with no direction, i.e. a
    // number that could not be acted on.
    //
    // Direction now needs the same ±0.5% move the bonus tiers already treat as
    // meaningful, and below it the directive reports UNMEASURED rather than a
    // fabricated floor. See INV-NO-FABRICATED-READING.
    const MIDWEEK_DIRECTIONAL_PCT = 0.5;

    if (!isMidweek) {
      return {
        signalClass: 'neutral',
        score: 0,
        confidence: 0.1,
        reason: `Not midweek (day ${day}) — the Tue–Thu bias does not apply, so there is nothing to measure.`,
        unmeasured: true,
      };
    }

    if (Math.abs(recentReturn) < MIDWEEK_DIRECTIONAL_PCT) {
      return {
        signalClass: 'neutral',
        score: 0,
        confidence: 0.1,
        reason:
          `Midweek (day ${day}) but the ${recentReturn.toFixed(2)}% move is below the ` +
          `${MIDWEEK_DIRECTIONAL_PCT}% threshold — no measurable momentum bias. Reporting UNMEASURED ` +
          `rather than scoring a direction from the sign of a near-zero number.`,
        unmeasured: true,
      };
    }

    // ── Measured: a real midweek move in a real direction ────────────────
    // baseScore now scales the ABSOLUTE move, so the score reflects how strong
    // the move is rather than rising on a negative return.
    const baseScore = Math.round(mapRange(Math.abs(recentReturn), MIDWEEK_DIRECTIONAL_PCT, 3, 10, 35));

    let bonusScore = 0;
    let bonusLabel = '';
    if (Math.abs(recentReturn) > 1.5) {
      bonusScore = 20;
      bonusLabel = `strong midweek momentum (${recentReturn > 0 ? '+' : ''}${recentReturn.toFixed(1)}%)`;
    } else if (Math.abs(recentReturn) > 1) {
      bonusScore = 10;
      bonusLabel = `moderate midweek momentum (${recentReturn > 0 ? '+' : ''}${recentReturn.toFixed(1)}%)`;
    }

    // Direction from the (now thresholded) sign — the magnitude was verified above.
    const signalClass: 'bullish' | 'bearish' | 'neutral' = recentReturn > 0 ? 'bullish' : 'bearish';

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass,
      score: total,
      confidence: Number((0.3 + (Math.abs(recentReturn) > 1 ? 0.15 : 0)).toFixed(2)),
      reason: `Midweek momentum: day ${day}, ${recentReturn > 0 ? '+' : ''}${recentReturn.toFixed(1)}% recent, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, dayOfWeek: day, recentReturn },
    };

  }
}

@Injectable()
export class AdvancedWeeklyRhythmDirective implements IDirective {
  readonly id = 'advanced-weekly-rhythm';
  readonly name = 'Advanced Weekly Rhythm Composite';
  readonly description = 'Day-of-week composite: Mon bearish, Tue-Thu bullish, Fri neutral.';
  readonly priority = 35;
  readonly maxScore = 60;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 5) {
      return {
        signalClass: 'neutral',
        score: 0,
        confidence: 0.1,
        reason: 'Need 5+ bars',
        // UNMEASURED — not enough data to judge weekly rhythm (INV-NO-FABRICATED-READING).
        unmeasured: true,
      };
    }
    const lastBar = bars[bars.length - 1];
    const day = lastBar.timestamp ? new Date(lastBar.timestamp).getUTCDay() : new Date().getUTCDay();
    const closes = bars.map(b => b.close);
    const recentReturn = closes.length > 5 ? (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100 : 0;

    // Day-of-week bias: Tue–Thu positive, Mon/Fri/Sat slightly negative, Sun more so.
    const dayBias: Record<number, number> = { 0: -8, 1: -5, 2: 10, 3: 15, 4: 10, 5: 0, 6: -5 };
    const bias = dayBias[day] || 0;

    // ⚠️ DIRECTION REQUIRES A REAL MOVE, NOT A SIGN TEST (INV-NO-FABRICATED-READING).
    //
    // Was `bias > 0 && recentReturn > 0 ? 'bullish' : ...` — a sign test, so a
    // +0.01% move alongside a positive day bias produced a full `bullish`
    // classification, while `baseScore` mapped `bias + trendAlignment` across
    // `-15..25` → `15..40` and therefore returned a non-zero score on a flat or
    // negative week. A direction from the sign of a near-zero number is a coin-flip,
    // and a score with no measurable input behind it is a fabricated reading.
    const RHYTHM_DIRECTIONAL_PCT = 0.5;

    if (Math.abs(recentReturn) < RHYTHM_DIRECTIONAL_PCT) {
      return {
        signalClass: 'neutral',
        score: 0,
        confidence: 0.1,
        reason:
          `Weekly rhythm: day ${day} bias=${bias}, but the ${recentReturn.toFixed(2)}% move is below the ` +
          `${RHYTHM_DIRECTIONAL_PCT}% threshold — no measurable trend to align with the day bias. ` +
          `Reporting UNMEASURED rather than scoring direction from a near-zero number.`,
        metadata: { dayOfWeek: day, bias, recentReturn },
        unmeasured: true,
      };
    }

    // Trend aligned WITH the day bias = the confluence this directive looks for.
    const trendAlignment = recentReturn * (bias >= 0 ? 1 : -1);
    const baseScore = Math.round(mapRange(bias + trendAlignment, -15, 25, 15, 40));

    let bonusScore = 0;
    let bonusLabel = '';
    if (bias > 0 && recentReturn > 1) { bonusScore = 20; bonusLabel = 'bullish confluence (midweek + uptrend)'; }
    else if (bias < 0 && recentReturn < -1) { bonusScore = 15; bonusLabel = 'bearish confluence'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    // Direction from the thresholded sign — the magnitude was verified above.
    const signalClass: 'bullish' | 'bearish' | 'neutral' = recentReturn > 0 ? 'bullish' : 'bearish';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.abs(bias) * 0.01 + Math.abs(recentReturn) * 0.03).toFixed(2)),
      reason: `Weekly rhythm: day ${day} bias=${bias}, ${recentReturn.toFixed(1)}% recent, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, dayOfWeek: day, bias, recentReturn },
    };

  }
}

@Injectable()
export class SpyOptionsExpiryDirective implements IDirective {
  // ── RETIRED 2026-10-09 (#879) ──
  // CLAIMED: "OpEx week (3rd Friday proximity)" — unmeasured, with a base of 10-30 by
  // calendar day (a non-zero score EVERY day of the month), and `dow === 5` can never match
  // the Sun-Thu stamped bars anyway (#880). Same shape as opex-gamma, retired with it.
  readonly id = 'spy-options-expiry';
  readonly name = 'SPY Options Expiry Effect (retired)';
  readonly description =
    'RETIRED — the asserted OpEx-week effect is unmeasured; scored every calendar day and no Friday-stamped bars exist (#880). See #879.';
  readonly priority = 28;
  readonly maxScore = 45;
  readonly version = '3.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('SPY options expiry retired: unmeasured OpEx-week claim (#879). Contributes nothing.');
  }
}

@Injectable()
export class SpyMonthEndRebalancingDirective implements IDirective {
  // ── RETIRED 2026-10-09 (#879) ──
  // CLAIMED: "month-end institutional rebalancing flow (last 3 trading days)" — unmeasured.
  // RETURNED: base scores of 10/15/22/30 by calendar day — i.e. a NON-ZERO SCORE ON EVERY DAY
  // OF THE MONTH, with no bar of market evidence behind any of them (mode-3 breach by design).
  // MEASURED 2026-10-09: ~10 month-end windows exist in the daily history (2025-12-25 ->
  // 2026-10-08) — far below what an honest threshold (>=3.2 sigma) needs. Unmeasured; zero.
  // Kept so protocol references resolve. See #879.
  readonly id = 'spy-month-end-rebalancing';
  readonly name = 'SPY Month-End Rebalancing (retired)';
  readonly description =
    'RETIRED — the asserted month-end rebalancing flow is unmeasured (~10 windows vs a threshold that needs years); it also scored on every day of the month. See #879.';
  readonly priority = 28;
  readonly maxScore = 45;
  readonly minScore = 0;
  readonly version = '3.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('Month-end rebalancing retired: unmeasured — ~10 windows in the available history, and '
        + 'the old form scored on every calendar day. No basis to assert; see #879.');
  }
}

@Injectable()
export class SpyQqqRelativeStrengthDirective implements IDirective {
  readonly id = 'spy-qqq-relative-strength';
  readonly name = 'SPY/QQQ Relative Strength';
  readonly description = 'Symbol vs broad market momentum as relative strength proxy.';
  readonly priority = 42;
  readonly maxScore = 70;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const; // promoted beta→ready 2026-08-15 — real 5d/20d momentum-acceleration math (name is aspirational: uses own bars, not SPY/QQQ)

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const ret20 = (closes[closes.length-1] - closes[closes.length-21]) / Math.max(0.01, closes[closes.length-21]) * 100;
    const acceleration = ret5 - (ret20 / 4);
    const momentumRatio = ret5 / Math.max(0.01, Math.abs(ret20));

    // BASE (15-50): self-trend relative strength
    const baseScore = Math.round(mapRange(acceleration, -3, 3, 15, 50));

    // BONUS: divergence / strong ratio
    let bonusScore = 0;
    let bonusLabel = '';
    if (acceleration > 2) { bonusScore = 20; bonusLabel = 'strong relative acceleration'; }
    else if (acceleration < -2) { bonusScore = 15; bonusLabel = 'strong relative deceleration'; }
    if (Math.abs(momentumRatio) > 3) { bonusScore += 5; bonusLabel += (bonusLabel ? ' + ' : '') + 'momentum divergence'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = acceleration > 0.5 ? 'bullish' : acceleration < -0.5 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.abs(acceleration) * 0.06).toFixed(2)),
      reason: `SPY/QQQ RS proxy: 5d ${ret5.toFixed(1)}% vs 20d ${ret20.toFixed(1)}%, accel=${acceleration.toFixed(1)}%, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, ret5, ret20, acceleration },
    };

  }
}

// ===========================================================================
// Crypto
// ===========================================================================







// ===========================================================================
// Equity-Specific
// ===========================================================================

@Injectable()
export class NvdaEarningsMomentumDirective implements IDirective {
  readonly id = 'nvda-earnings-momentum';
  readonly name = 'NVDA Earnings Momentum';
  readonly description = 'NVDA-specific: post-earnings drift and momentum proxy.';
  readonly priority = 38;
  readonly maxScore = 65;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const isNvda = input.symbol.toUpperCase() === 'NVDA';
    if (!isNvda) return { signalClass: 'neutral', score: 5, confidence: 0.1, reason: 'Not NVDA — directive only applies to NVDA' };
    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Need 20+ bars' };
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const bb = bollingerBands(closes, 20, 2);
    const expanding = bb && bb.upper.length >= 5 && (bb.upper[bb.upper.length-1] - bb.lower[bb.lower.length-1]) > (bb.upper[bb.upper.length-5] - bb.lower[bb.lower.length-5]) * 1.2;

    // BASE (15-45): NVDA momentum strength
    const baseScore = Math.round(mapRange(ret5, -5, 5, 15, 45));

    // BONUS: post-earnings drift patterns
    let bonusScore = 0;
    let bonusLabel = '';
    if (ret5 > 3 && !expanding) { bonusScore = 20; bonusLabel = 'strong momentum + stable vol (post-earnings drift)'; }
    else if (Math.abs(ret5) > 5) { bonusScore = 15; bonusLabel = 'high magnitude move (potential earnings event)'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = ret5 > 1 ? 'bullish' : ret5 < -1 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + Math.abs(ret5) * 0.06).toFixed(2)),
      reason: `NVDA earnings momentum: ${ret5.toFixed(1)}% 5d, vol ${expanding ? 'expanding' : 'stable'}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, ret5, volExpanding: expanding },
    };

  }
}

@Injectable()
export class TslaSentimentAmplifierDirective implements IDirective {
  readonly id = 'tsla-sentiment-amplifier';
  readonly name = 'TSLA Sentiment Amplifier';
  readonly description = 'TSLA-specific: RSI extremes + volume surge detection.';
  readonly priority = 38;
  readonly maxScore = 65;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const isTsla = input.symbol.toUpperCase() === 'TSLA';
    if (!isTsla) return { signalClass: 'neutral', score: 5, confidence: 0.1, reason: 'Not TSLA — directive only applies to TSLA' };
    const closes = input.bars.map(b => b.close);
    if (closes.length < 15) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Need 15+ bars' };
    const r = rsi(closes, 14);
    const currentRsi = r[r.length - 1];
    const volumes = input.bars.map(b => b.volume || 0);
    const avgVol = volumes.slice(0, -1).reduce((a,b) => a+b, 0) / Math.max(1, volumes.length - 1);
    const currentVol = volumes[volumes.length - 1];
    const volRatio = avgVol > 0 ? currentVol / avgVol : 1;

    // BASE (15-50): volatility regime + RSI
    const volScore = mapRange(volRatio, 0.5, 2.5, 0, 25);
    const rsiExtreme = currentRsi < 30 || currentRsi > 70 ? 25 : mapRange(Math.abs(currentRsi - 50), 0, 20, 0, 25);
    const baseScore = Math.round(15 + volScore + rsiExtreme);

    // BONUS: extreme contrarian setups
    let bonusScore = 0;
    let bonusLabel = '';
    if (currentRsi < 30 && volRatio > 1.3) { bonusScore = 15; bonusLabel = 'oversold + vol surge (contrarian buy)'; }
    else if (currentRsi > 75 && volRatio > 1.3) { bonusScore = 15; bonusLabel = 'overbought + vol surge (top signal)'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = currentRsi < 35 ? 'bullish' : currentRsi > 70 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.min(0.3, (volRatio - 1) * 0.2)).toFixed(2)),
      reason: `TSLA sentiment: RSI ${currentRsi.toFixed(0)}, vol ${volRatio.toFixed(1)}x, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, currentRsi, volRatio },
    };

  }
}

// ===========================================================================
// Fundamental
// ===========================================================================

@Injectable()
export class DividendYieldAttractiveDirective implements IDirective {
  readonly id = 'dividend-yield-attractive';
  readonly name = 'Attractive Dividend Yield';
  readonly description = 'Low volatility proxy for dividend-paying stability.';
  readonly priority = 36;
  readonly maxScore = 55;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };
    const bb = bollingerBands(closes, 20, 2);
    if (!bb || !bb.upper.length) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'BB calculation failed' };
    const bandwidth = (bb.upper[bb.upper.length-1] - bb.lower[bb.lower.length-1]) / bb.middle[bb.middle.length-1];
    const ret20 = (closes[closes.length-1] - closes[0]) / Math.max(0.01, closes[0]) * 100;

    // BASE (10-40): price stability (low vol = dividend stock proxy)
    const stabilityScore = mapRange(bandwidth, 0.02, 0.15, 40, 10);
    const returnScore = ret20 > 0 ? mapRange(ret20, 0, 10, 0, 15) : 0;
    const baseScore = Math.round(10 + stabilityScore * 0.6 + returnScore * 0.4);

    // BONUS: ex-div proximity proxy
    let bonusScore = 0;
    let bonusLabel = '';
    if (bandwidth < 0.05 && ret20 > 0 && ret20 < 5) { bonusScore = 15; bonusLabel = 'low-vol steady gainer (dividend proxy)'; }
    else if (bandwidth < 0.08) { bonusScore = 8; bonusLabel = 'low volatility stability'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass: ret20 > 0 && bandwidth < 0.08 ? 'bullish' : 'neutral',
      score: total,
      confidence: Number((0.2 + (bandwidth < 0.08 ? 0.15 : 0)).toFixed(2)),
      reason: `Dividend proxy: bandwidth ${(bandwidth*100).toFixed(1)}%, 20d ${ret20.toFixed(1)}%, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, bandwidth, ret20 },
    };

  }
}



// ===========================================================================
// Composite
// ===========================================================================





// ===========================================================================
// Risk / Support-Resistance
// ===========================================================================







@Injectable()
export class TimeBasedSupportDirective implements IDirective {
  readonly id = 'time-based-support';
  readonly name = 'Time-Based Support';
  readonly description = 'VWAP and round-number support/resistance levels.';
  readonly priority = 55;
  readonly maxScore = 80;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 10) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 10+ bars, have ${bars.length}` };

    let cumPV = 0, cumVol = 0;
    for (const bar of bars) { const tp = (bar.high + bar.low + bar.close) / 3; const v = bar.volume || 0; cumPV += tp * v; cumVol += v; }
    if (cumVol <= 0) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'No volume for VWAP' };
    const vwap = cumPV / cumVol;
    const lastClose = bars[bars.length - 1].close;
    const deviation = ((lastClose - vwap) / vwap) * 100;
    const roundLevel = Math.round(lastClose);
    const distFromRound = Math.abs(lastClose - roundLevel) / Math.max(0.01, lastClose) * 100;

    // BASE (15-60): proximity to VWAP and round numbers
    const vwapProximity = Math.max(0, 1 - Math.abs(deviation) / 3);
    const roundProximity = Math.max(0, 1 - distFromRound / 1.5);
    const baseScore = Math.round(mapRange(vwapProximity * 0.6 + roundProximity * 0.4, 0, 1, 15, 60));

    // BONUS: at key levels
    let bonusScore = 0;
    let bonusLabel = '';
    if (Math.abs(deviation) < 0.5) { bonusScore += 15; bonusLabel = 'at VWAP'; }
    if (distFromRound < 0.3) { bonusScore += 10; bonusLabel += (bonusLabel ? ' + ' : '') + 'near round number ' + roundLevel; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = deviation < -1 ? 'bullish' : deviation > 1 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + (bonusScore > 0 ? 0.2 : 0)).toFixed(2)),
      reason: `Time support: ${deviation.toFixed(2)}% vs VWAP ${vwap.toFixed(2)}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, deviation, vwap, distFromRound },
    };

  }
}

// ===========================================================================
// ISA / Special
// ===========================================================================

@Injectable()
export class IsaResetDirective implements IDirective {
  // ── RETIRED 2026-10-09 (#879) ──
  // CLAIMED: "UK ISA tax-year reset timing (April 6th)" — unmeasured. The claim is also the
  // STRANGEST in the family for a trading direct: a UK tax-wrapper administration date is not
  // a market mechanism.
  // RETURNED: base scores of 5/12/15/20 by calendar day — a NON-ZERO SCORE ON EVERY DAY OF THE
  // YEAR (mode-3 breach by design).
  // MEASURED 2026-10-09: ONE 6 April exists in the daily history (2026-04-06) — unmeasurable.
  // Unmeasured; zero. Kept so protocol references resolve. See #879.
  readonly id = 'isa-reset';
  readonly name = 'ISA Reset (retired)';
  readonly description =
    'RETIRED — the asserted UK ISA tax-year reset effect is unmeasured (one occurrence in the history), and a tax-administration date is not a market mechanism. See #879.';
  readonly priority = 20;
  readonly maxScore = 30;
  readonly minScore = 0;
  readonly version = '3.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('ISA reset retired: unmeasured — one 6 April in the available history; a tax-wrapper date '
        + 'is not a measured market mechanism. No basis to assert; see #879.');
  }
}

// ===========================================================================
// Additional TradePress Directives (rounding out the full 56)
// ===========================================================================





@Injectable()
export class BasicWeeklyRhythmDirective implements IDirective {
  // ── RETIRED 2026-10-09 (#879) ──
  // CLAIMED: "day-of-week statistical edge + volume pattern" — unmeasured; the lookup table
  // scored EVERY day (8-22) and asserted a midweek bullish bias from the calendar.
  readonly id = 'basic-weekly-rhythm';
  readonly name = 'Basic Weekly Rhythm Composite (retired)';
  readonly description =
    'RETIRED — the asserted day-of-week edge is unmeasured; the old form scored every day of the week. See #879.';
  readonly priority = 34;
  readonly maxScore = 55;
  readonly version = '3.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('Basic weekly rhythm retired: unmeasured day-of-week claim (#879). Contributes nothing.');
  }
}

@Injectable()
export class IntradayUPatternDirective implements IDirective {
  readonly id = 'intraday-u-pattern';
  readonly name = 'Intraday U-Pattern';
  readonly description = 'U-shaped recovery: early weakness followed by afternoon strength.';
  readonly priority = 40;
  readonly maxScore = 70;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 10) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 10+ bars, have ${bars.length}` };

    const mid = Math.floor(bars.length / 2);
    const firstHalf = bars.slice(0, mid);
    const secondHalf = bars.slice(mid);
    const firstOpen = firstHalf[0].open;
    const firstClose = firstHalf[firstHalf.length - 1].close;
    const firstReturn = firstOpen > 0 ? ((firstClose - firstOpen) / firstOpen) * 100 : 0;
    const secondOpen = secondHalf[0].open;
    const secondClose = secondHalf[secondHalf.length - 1].close;
    const secondReturn = secondOpen > 0 ? ((secondClose - secondOpen) / secondOpen) * 100 : 0;

    // BASE (15-55): U-pattern strength = magnitude of recovery
    const recoveryMagnitude = Math.max(0, secondReturn - Math.min(0, firstReturn));
    const baseScore = Math.round(mapRange(recoveryMagnitude, 0, 3, 15, 55));

    // BONUS: pronounced U-pattern
    let bonusScore = 0;
    let bonusLabel = '';
    if (firstReturn < -0.5 && secondReturn > 0.5) { bonusScore = 15; bonusLabel = 'classic U-pattern'; }
    else if (firstReturn < -0.3 && secondReturn > 0.3) { bonusScore = 8; bonusLabel = 'weak U-pattern'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = secondReturn > 0 && firstReturn < 0 ? 'bullish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + (firstReturn < 0 && secondReturn > 0 ? 0.25 : 0)).toFixed(2)),
      reason: `U-pattern: 1st half ${firstReturn.toFixed(1)}%, 2nd half +${secondReturn.toFixed(1)}%, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, firstReturn, secondReturn, recoveryMagnitude },
    };

  }
}

@Injectable()
export class InstitutionalTimingDirective implements IDirective {
  // ── RETIRED 2026-10-09 (#879) ──
  // CLAIMED: "quarter-end / month-end institutional rebalancing" — unmeasured; base 10-35 by
  // calendar day with a weekday proxy, i.e. a non-zero score EVERY trading day. Same shape as
  // spy-month-end-rebalancing, retired with it.
  readonly id = 'institutional-timing';
  readonly name = 'Institutional Timing (retired)';
  readonly description =
    'RETIRED — the asserted quarter/month-end rebalancing proxy is unmeasured; the old form scored every trading day. See #879.';
  readonly priority = 30;
  readonly maxScore = 50;
  readonly version = '3.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('Institutional timing retired: unmeasured quarter/month-end claim (#879). Contributes nothing.');
  }
}

@Injectable()
export class MacdDirective implements IDirective {
  readonly id = 'macd';
  readonly name = 'MACD (General)';
  readonly description = 'Line/signal relationship, histogram, divergence.';
  readonly priority = 75;
  readonly maxScore = 110;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const; // promoted beta→ready 2026-08-15 — real MACD(12,26,9) crossover math

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 35) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 35+ bars, have ${closes.length}` };

    const result = macd(closes, 12, 26, 9);
    if (!result || !result.macd.length) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'MACD calculation failed' };
    const m = result.macd[result.macd.length - 1];
    const s = result.signal[result.signal.length - 1];
    const prevM = result.macd[result.macd.length - 2];
    const prevS = result.signal[result.signal.length - 2];
    const hist = m - s;
    const prevHist = prevM - prevS;

    // BASE (15-75): MACD histogram strength
    const maxHist = Math.max(...result.macd.map((v, i) => Math.abs(v - (result.signal[i] || 0))).slice(-50));
    const histNorm = maxHist > 0 ? Math.abs(hist) / maxHist : 0;
    const baseScore = Math.round(mapRange(histNorm, 0, 1, 15, 60) + (m > 0 ? 15 : 0));

    // BONUS: crossover events
    let bonusScore = 0;
    let bonusLabel = '';
    const crossedUp = prevM <= prevS && m > s;
    const crossedDown = prevM >= prevS && m < s;
    if (crossedUp) { bonusScore = 25; bonusLabel = 'bullish crossover' + (m < 0 ? ' below zero' : ''); }
    else if (crossedDown) { bonusScore = 20; bonusLabel = 'bearish crossover'; }
    else if (m > 0 && hist > prevHist && hist > 0) { bonusScore = 10; bonusLabel = 'histogram expanding bullish'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = crossedUp || (m > 0 && hist > 0) ? 'bullish' : crossedDown || (m < 0 && hist < 0) ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.abs(histNorm) * 0.4 + (bonusScore > 0 ? 0.1 : 0)).toFixed(2)),
      reason: `MACD=${m.toFixed(4)} sig=${s.toFixed(4)} hist=${hist.toFixed(4)}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, macdLine: m, signalLine: s, histogram: hist },
    };

  }
}

// ===========================================================================
// Aspirational (strategy docs — no PHP source yet)
// ===========================================================================

@Injectable()
export class AdaptiveRiskMonitorDirective implements IDirective {
  readonly id = 'adaptive-risk-monitor';
  readonly name = 'Adaptive Risk Monitor';
  readonly description = 'Dynamic position sizing from volatility regime.';
  readonly priority = 64;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };
    const a = atr(highs, lows, closes, 14);
    if (a.length < 14) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'ATR calculation failed' };
    const currentAtr = a[a.length - 1];
    const prevAtr = a[Math.max(0, a.length - 10)];
    const lastClose = closes[closes.length - 1];
    const atrPct = (currentAtr / lastClose) * 100;
    const volRatio = prevAtr > 0 ? currentAtr / prevAtr : 1;

    // BASE (15-65): volatility regime
    const volPctScore = mapRange(atrPct, 0.5, 5, 15, 65);
    const trendScore = volRatio > 1 ? mapRange(volRatio, 1, 2, 0, 15) : 0;
    const baseScore = Math.round(volPctScore * 0.8 + trendScore * 0.2);

    // BONUS: high-risk periods
    let bonusScore = 0;
    let bonusLabel = '';
    if (atrPct > 4) { bonusScore = 25; bonusLabel = 'extreme vol — reduce sizing'; }
    else if (atrPct > 2.5 && volRatio > 1.3) { bonusScore = 15; bonusLabel = 'vol expanding — caution'; }
    else if (volRatio < 0.7) { bonusScore = 10; bonusLabel = 'vol contracting — favorable'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = atrPct < 1.5 ? 'bullish' : atrPct > 3 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.3 + Math.min(0.3, atrPct * 0.06)).toFixed(2)),
      reason: `Risk monitor: ATR=${atrPct.toFixed(2)}%, vol ${volRatio > 1.1 ? 'expanding' : volRatio < 0.9 ? 'contracting' : 'stable'}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, atrPct, volRatio },
    };

  }
}

@Injectable()
export class AnalystAdjustmentsDirective implements IDirective {
  readonly id = 'analyst-adjustments';

  // ── DECISION (2026-10-09, primary) ──
  // WHAT:      The DISPLAY NAME is 'Momentum Acceleration'. The ID stays `analyst-adjustments`.
  // WHY:       The name was the last dishonest artefact of this directive — there is no analyst
  //            feed (the description has said so since 2026-09-10), it is a price-momentum proxy.
  //            The ID is a load-bearing KEY: measured today, 11 ACTIVE protocols reference it via
  //            protocol_directive_entry, and it is written into score breakdowns and seeds. A
  //            half-done ID migration orphans protocol entries SILENTLY — the repo's most
  //            expensive failure signature. The user reads the NAME; fix the lie where it is read.
  // INSTEAD OF: Renaming the id to `momentum-acceleration` (#766 criterion 4's other reading).
  // REVERSE BY: Restoring `readonly name = 'Analyst Adjustments'` — one line. The DB converges
  //            from the class on boot (`directives.module.ts` → `seedToDatabase()` upserts `name`).
  // REGISTER:  docs/SETTLED-DECISIONS.md row 78.
  // GUARD:     none — 🔴 unguarded by design; a spec pinning a display string would be ceremony.
  readonly name = 'Momentum Acceleration';
  readonly description = 'Price momentum proxy for sentiment shifts (analyst revisions unavailable).';
  readonly priority = 50;
  // ⚠️ maxScore corrected 80 → 70 (2026-10-20, #1131). MODE 9 measured
  // the highest score this directive's own return arithmetic can produce as 70;
  // the extra 10 points were permanent, unearnable capacity in every
  // protocol denominator. See node nest/scripts/directive-guard.cjs (MODE 9).
  readonly maxScore = 70;
  readonly version = '3.0.0';
  readonly readiness = 'ready' as const;

  /**
   * ⚠️ HONESTY CONTRACT (rewritten 2026-09-10).
   *
   * This directive has NO analyst feed. It infers conviction from price momentum,
   * and it must say so rather than manufacture certainty. The previous version
   * ended with:
   *
   *     score = Math.round(30 + accelerating * 5)          // confidence 0.25
   *     signalClass = accelerating > 0 ? 'bullish' : 'bearish'
   *
   * Two faults, both measured live:
   *
   *  1. A FABRICATED FLOOR. The `30 +` produced a non-zero score even when
   *     momentum was flat — a number with no market basis behind it. Measured:
   *     1,125 `bullish` readings averaged 30.9 with a minimum of EXACTLY 30, and
   *     630 `bearish` averaged 29.7 with a maximum of EXACTLY 30. 94% of 1,755
   *     readings sat inside a 27–50 band, i.e. inside the invented offset.
   *
   *  2. DIRECTION FROM NOISE. It emitted a tradeable direction from the SIGN of
   *     `accelerating`, so momentum of +0.02% — indistinguishable from zero —
   *     produced a full `bullish` classification. For the index protocols this
   *     was the ONLY directional directive, so a coin-flip WAS the composite.
   *
   * This matters because the app may one day trade real money: when a symbol
   * halts or a feed stops, the correct output is "I cannot measure this", never
   * a plausible number. So the flat branch returns `unmeasured: true` with
   * score 0 and a neutral class — it contributes nothing to the composite and
   * can never trip a risk gate.
   *
   * The genuine branches below are unchanged: they fire only on a momentum move
   * large enough to be a real observation, not a rounding artefact.
   *
   * Naming note: the id remains `analyst-adjustments` for compatibility with 8
   * live protocol configs, but the NAME is misleading — there is no analyst
   * data here. Prefer `momentum-acceleration` if the id is ever migrated.
   */
  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 15) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Need 15+ bars, have ${closes.length}`,
        signalClass: 'neutral',
        unmeasured: true,
      };
    }

    // Momentum acceleration: the 5-bar return now vs the previous 5-bar return.
    // A real observation, used by the branches below.
    const ret5 = (closes[closes.length - 1] - closes[closes.length - 6]) / Math.max(0.01, closes[closes.length - 6]) * 100;
    const ret5prev = closes.length > 11
      ? (closes[closes.length - 6] - closes[closes.length - 11]) / Math.max(0.01, closes[closes.length - 11]) * 100
      : 0;
    const accelerating = ret5 - ret5prev;

    const volumeSurge = (input.bars[input.bars.length - 1].volume || 0)
      > (input.bars.slice(-11, -1).reduce((s, b) => s + (b.volume || 0), 0) / 10) * 1.3;

    // ── Measured branches (unchanged): each requires a real momentum move ──
    if (accelerating > 2 && volumeSurge) {
      return {
        score: 70, confidence: 0.5,
        reason: `Momentum accelerating +${accelerating.toFixed(1)}% with volume surge — bullish momentum proxy`,
        signalClass: 'bullish',
      };
    }
    if (accelerating > 1) {
      return {
        score: 50, confidence: 0.35,
        reason: `Momentum accelerating +${accelerating.toFixed(1)}%`,
        signalClass: 'bullish',
      };
    }
    if (accelerating < -2) {
      return {
        score: 45, confidence: 0.3,
        reason: `Momentum decelerating ${accelerating.toFixed(1)}% — bearish momentum proxy`,
        signalClass: 'bearish',
      };
    }

    // ── Unmeasured: |accelerating| < 1% is momentum noise, not a signal ──
    // No score (the old `30 +` was invented), no direction (the old sign test
    // was a coin-flip), and `unmeasured` so the risk engine never derives
    // severity from it and the composite does not count it.
    return {
      score: 0,
      confidence: 0.1,
      reason:
        `No measurable momentum shift: change ${accelerating >= 0 ? '+' : ''}${accelerating.toFixed(2)}% is ` +
        `below the 1% threshold, and no analyst feed is available. Reporting UNMEASURED rather than ` +
        `fabricating a sentiment score.`,
      signalClass: 'neutral',
      unmeasured: true,
    };
  }
}

@Injectable()
export class ConvictionGrowthDirective implements IDirective {
  readonly id = 'conviction-growth';
  readonly name = 'Conviction Growth';
  readonly description = 'Multi-timeframe conviction for position scaling.';
  readonly priority = 66;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const; // promoted beta→ready 2026-08-15 — real multi-timeframe EMA/SMA conviction math

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 60) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 60+ bars, have ${closes.length}` };
    let signals = 0;
    const details: string[] = [];
    const ema10 = ema(closes, 10);
    const lastClose = closes[closes.length - 1];
    if (ema10.length > 0 && lastClose > ema10[ema10.length - 1]) { signals++; details.push('EMA10 bullish'); }
    else if (ema10.length > 0) { signals--; details.push('EMA10 bearish'); }
    if (closes.length >= 55) {
      const ema50 = ema(closes, 50);
      if (ema50.length >= 5) {
        const slopeEma50 = ema50[ema50.length - 1] - ema50[ema50.length - 5];
        if (slopeEma50 > 0) { signals++; details.push('EMA50 rising'); }
        else { signals--; details.push('EMA50 falling'); }
      }
    }
    const s200 = sma(closes, 200);
    if (s200 > 0) {
      if (lastClose > s200) { signals++; details.push('above SMA200'); }
      else { signals--; details.push('below SMA200'); }
    }
    if (input.dayBars && input.dayBars.length >= 10) {
      const dayCloses = input.dayBars.map(b => b.close);
      const dayEma10 = ema(dayCloses, 10);
      if (dayEma10.length >= 2 && dayEma10[dayEma10.length - 1] > dayEma10[dayEma10.length - 2]) {
        signals++; details.push('daily EMA10 rising');
      }
    }

    // BASE (20-70): signal count mapped to score
    const baseScore = Math.round(mapRange(signals, -3, 4, 20, 70));

    // BONUS: accelerating conviction
    let bonusScore = 0;
    let bonusLabel = '';
    if (signals >= 3) { bonusScore = 30; bonusLabel = 'high conviction (' + signals + ' aligned signals)'; }
    else if (signals >= 2) { bonusScore = 15; bonusLabel = 'growing conviction'; }
    else if (signals <= -2) { bonusScore = 10; bonusLabel = 'strong bearish conviction'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = signals >= 2 ? 'bullish' : signals <= -2 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + Math.abs(signals) * 0.12).toFixed(2)),
      reason: `Conviction: ${signals} signals (${details.join(', ')}), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, signalCount: signals, details },
    };

  }
}

@Injectable()
export class EarningsImplementationDirective implements IDirective {
  readonly id = 'earnings-implementation';
  readonly name = 'Earnings Strategy Implementation';
  readonly description = 'Volatility compression proxy for pre-earnings positioning.';
  readonly priority = 46;
  readonly maxScore = 70;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };
    const bb = bollingerBands(closes, 20, 2);
    if (!bb || !bb.upper.length || bb.upper.length < 10) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'BB calculation failed' };
    const recentWidths: number[] = [];
    for (let i = Math.max(0, bb.lower.length - 10); i < bb.lower.length; i++) {
      recentWidths.push((bb.upper[i] - bb.lower[i]) / Math.max(0.01, bb.middle[i]));
    }
    const currentWidth = recentWidths[recentWidths.length - 1];
    const avgWidth = recentWidths.slice(0, -1).reduce((a,b) => a+b, 0) / Math.max(1, recentWidths.length - 1);
    const widthRatio = avgWidth > 0 ? currentWidth / avgWidth : 1;
    const compressing = widthRatio < 0.8;
    const expanding = widthRatio > 1.3;

    // BASE (10-50): proximity to earnings via vol compression
    const baseScore = Math.round(mapRange(widthRatio, 0.5, 1.5, 50, 10));

    // BONUS: report week proximity
    let bonusScore = 0;
    let bonusLabel = '';
    if (compressing) { bonusScore = 20; bonusLabel = 'pre-earnings vol compression'; }
    else if (expanding) { bonusScore = 10; bonusLabel = 'post-earnings vol expansion'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass: 'neutral',
      score: total,
      confidence: Number((0.15 + (compressing ? 0.2 : 0.1)).toFixed(2)),
      reason: `Earnings implementation: BB width ${(currentWidth*100).toFixed(1)}% (${compressing ? 'compressing' : expanding ? 'expanding' : 'stable'}), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, currentWidth: currentWidth*100, widthRatio, compressing },
    };

  }
}

@Injectable()
export class EarningsWhispersDirective implements IDirective {
  readonly id = 'earnings-whispers';
  readonly name = 'Earnings Whispers';
  readonly description = 'Recent price gap as proxy for whisper surprise.';
  readonly priority = 44;
  readonly maxScore = 65;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 5) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 5+ bars, have ${bars.length}` };
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const gapPct = prev.close > 0 ? ((last.open - prev.close) / prev.close) * 100 : 0;
    const gapUp = last.open > prev.high * 1.005;
    const gapDown = last.open < prev.low * 0.995;
    const gapMagnitude = Math.abs(gapPct);

    // BASE (10-45): gap magnitude
    const baseScore = Math.round(mapRange(gapMagnitude, 0, 5, 10, 45));

    // BONUS: large drift
    let bonusScore = 0;
    let bonusLabel = '';
    if (gapUp && gapPct > 2) { bonusScore = 20; bonusLabel = 'large gap up (positive whisper)'; }
    else if (gapUp && gapPct > 1) { bonusScore = 10; bonusLabel = 'gap up'; }
    else if (gapDown && gapPct < -2) { bonusScore = 15; bonusLabel = 'large gap down (negative surprise)'; }
    else if (gapDown) { bonusScore = 8; bonusLabel = 'gap down'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = gapUp ? 'bullish' : gapDown ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.15 + Math.min(0.25, gapMagnitude * 0.06)).toFixed(2)),
      reason: `Earnings whispers: gap ${gapPct.toFixed(1)}% (${gapUp ? 'up' : gapDown ? 'down' : 'none'}), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, gapPct, gapUp, gapDown },
    };

  }
}

@Injectable()
export class LikeZacksDirective implements IDirective {
  readonly id = 'like-zacks';
  readonly name = 'Zacks-Style Rank Proxy';
  readonly description = 'Trend strength ranking from price momentum as earnings revision proxy.';
  readonly priority = 52;
  readonly maxScore = 85;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    // 2026-10-09 (#766): same shape as sp500-regime — the old form returned a pro-rated
    // floor (`Math.round(10 * closes.length / 50)`, up to 10) on a could-not-measure path.
    // 0 + unmeasured: a number the directive cannot derive does not enter the composite.
    if (closes.length < 50) return { signalClass: 'neutral', score: 0, unmeasured: true, confidence: 0.1, reason: `Insufficient data: need 50 bars, have ${closes.length} — unmeasured` };
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const ret10 = (closes[closes.length-1] - closes[closes.length-11]) / Math.max(0.01, closes[closes.length-11]) * 100;
    const ret20 = (closes[closes.length-1] - closes[closes.length-21]) / Math.max(0.01, closes[closes.length-21]) * 100;
    const ema20Vals = ema(closes, 20);
    const ema50Vals = ema(closes, 50);
    const aboveEma20 = ema20Vals.length > 0 && closes[closes.length-1] > ema20Vals[ema20Vals.length-1];
    const aboveEma50 = ema50Vals.length > 0 && closes[closes.length-1] > ema50Vals[ema50Vals.length-1];

    // BASE (5-60): multi-period momentum composite
    let rankScore = 0;
    if (ret5 > 2) rankScore += 20; else if (ret5 > 0) rankScore += 10;
    if (ret10 > 3) rankScore += 20; else if (ret10 > 0) rankScore += 10;
    if (ret20 > 5) rankScore += 20; else if (ret20 > 0) rankScore += 10;
    if (aboveEma20) rankScore += 10;
    if (aboveEma50) rankScore += 5;
    const baseScore = Math.round(mapRange(rankScore, 0, 85, 5, 60));

    // BONUS: strong Zacks-style rank
    let bonusScore = 0;
    let bonusLabel = '';
    if (rankScore >= 65) { bonusScore = 25; bonusLabel = 'strong buy proxy (rank ' + rankScore + '/85)'; }
    else if (rankScore >= 45) { bonusScore = 15; bonusLabel = 'buy proxy'; }
    else if (rankScore < 15) { bonusScore = 10; bonusLabel = 'weak rank (sell proxy)'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = rankScore >= 45 ? 'bullish' : rankScore < 15 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + rankScore * 0.005).toFixed(2)),
      reason: `Zacks proxy: rank ${rankScore}/85 (5d:${ret5.toFixed(1)}% 10d:${ret10.toFixed(1)}% 20d:${ret20.toFixed(1)}%), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, rankScore, ret5, ret10, ret20 },
    };

  }
}

@Injectable()
export class MeanReversionDirective implements IDirective {
  readonly id = 'mean-reversion';
  readonly name = 'Mean Reversion Strategy';
  readonly description = 'Statistical mean reversion with regime filters.';
  readonly priority = 71;
  readonly maxScore = 105;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const; // promoted beta→ready 2026-08-15 — real Bollinger sigma-distance mean reversion math

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 30) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${closes.length}` };

    const bb = bollingerBands(closes, 20, 2);
    if (!bb || !bb.upper.length) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'BB calculation failed' };
    const lastClose = closes[closes.length - 1];
    const upper = bb.upper[bb.upper.length - 1];
    const lower = bb.lower[bb.lower.length - 1];
    const middle = bb.middle[bb.middle.length - 1];
    const bandRange = upper - lower;
    if (bandRange <= 0) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Invalid band range' };

    // Distance from mean in sigma units (-1=lowerBB, 0=middle, 1=upperBB)
    const sigmaDist = (lastClose - middle) / (bandRange / 2);

    // BASE (15-75): continuous from sigma distance
    const baseScore = Math.round(mapRange(Math.abs(sigmaDist), 0, 1.2, 15, 75));

    // BONUS: extreme mean deviation
    let bonusScore = 0;
    let bonusLabel = '';
    if (sigmaDist <= -1) { bonusScore = 25; bonusLabel = 'at lower BB (oversold)'; }
    else if (sigmaDist <= -0.8) { bonusScore = 15; bonusLabel = 'near lower BB'; }
    else if (sigmaDist >= 1) { bonusScore = 25; bonusLabel = 'at upper BB (overbought)'; }
    else if (sigmaDist >= 0.8) { bonusScore = 15; bonusLabel = 'near upper BB'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = sigmaDist <= -0.5 ? 'bullish' : sigmaDist >= 0.5 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + Math.abs(sigmaDist) * 0.4).toFixed(2)),
      reason: `Mean reversion: ${sigmaDist.toFixed(2)}σ from BB mean, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, sigmaDist, lastClose, middle },
    };

  }
}

@Injectable()
export class ResistanceLevelsStrategyDirective implements IDirective {
  readonly id = 'resistance-levels-strategy';
  readonly name = 'Resistance Levels Strategy';
  readonly description = 'Multi-timeframe resistance with breakout/failure scoring.';
  readonly priority = 70;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 30) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${bars.length}` };

    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const lastClose = bars[bars.length - 1].close;
    const pivotHigh = Math.max(...highs.slice(-20, -1));
    const pivotLow = Math.min(...lows.slice(-20, -1));
    const range = pivotHigh - pivotLow;
    if (range <= 0) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'No valid pivot range' };

    // Distance from resistance as % of range
    const distFromResistance = ((pivotHigh - lastClose) / range) * 100;
    const distFromSupport = ((lastClose - pivotLow) / range) * 100;

    // BASE (15-75): proximity to resistance (closer = higher base)
    const baseScore = Math.round(mapRange(distFromResistance, 0, 50, 75, 15));

    // BONUS: breakout/breakdown
    let bonusScore = 0;
    let bonusLabel = '';
    const brokeResistance = lastClose > pivotHigh * 1.002;
    const brokeSupport = lastClose < pivotLow * 0.998;
    if (brokeResistance) { bonusScore = 25; bonusLabel = 'breakout above resistance'; }
    else if (brokeSupport) { bonusScore = 20; bonusLabel = 'breakdown below support'; }
    else if (distFromResistance < 5) { bonusScore = 15; bonusLabel = 'at resistance'; }
    else if (distFromSupport < 5) { bonusScore = 15; bonusLabel = 'at support'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = brokeResistance ? 'bullish' : brokeSupport ? 'bearish' : distFromSupport < 30 ? 'bullish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.3 + (brokeResistance || brokeSupport ? 0.25 : 0)).toFixed(2)),
      reason: `S/R: ${distFromResistance.toFixed(0)}% below resistance, ${distFromSupport.toFixed(0)}% above support, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, distFromResistance, distFromSupport, pivotHigh, pivotLow },
    };

  }
}

@Injectable()
export class Sp500RegimeDirective implements IDirective {
  readonly id = 'sp500-regime';
  readonly name = 'S&P 500 Regime Filter';
  readonly description = 'Market regime proxy: bull/correction/bear/recovery from price vs SMA200.';
  readonly priority = 70;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const; // promoted beta→ready 2026-08-15 — real SMA200 regime math

  /**
   * `structural` — a GATE, not a directional voter (#790, decided 2026-09-11).
   *
   * WHY THIS IS EXPLICIT NOW
   * ------------------------
   * This field was previously ABSENT. `category` is optional on `IDirective`, so the guard
   * `validate-directive-group-kind.cjs` (INV-GATE-MEMBERSHIP) could not classify this
   * directive and reported it as `⚠ no category — NOT CHECKED` on every build.
   *
   * It mattered because this directive sits in the `risk` gate of `vix-spike-v1` and
   * `vix-short-v1`, and the seed documents that deliberately:
   *     "Risk gate (SP500 regime) is mandatory."
   * So the PLACEMENT is intended. What was missing was the DECLARATION that makes the
   * intent machine-checkable.
   *
   * ⚠️ The `calculate()` method DOES return `bullish`/`bearish` (from SMA200 deviation and
   * slope) — which is why this was ambiguous. A gate may legitimately emit a direction to
   * express the direction it is gating FOR; the point of `structural` is that the scorer
   * treats it as a hurdle (multiplier), never as additive conviction
   * (`protocol-gating.service.ts` L689/L749/L763).
   *
   * ⚠️ If this is ever moved OUT of a risk gate, re-read `docs/SETTLED-DECISIONS.md` first —
   * `vix-short-v1`'s description states the gate is mandatory.
   */
  readonly category = 'structural' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    // 2026-10-09 (#766): the old form returned `Math.round(15 * closes.length / 200)` — a
    // PRO-RATED FLOOR of up to 15 on a path whose own reason says it could not measure
    // (measured live: 241 records/day at exactly 5 with "Need 200+ bars, have 72"). A value
    // the directive cannot derive must not enter the composite or a risk gate; the honest
    // return is 0 + unmeasured (interfaces/directive.interface.ts: "Set `unmeasured: true`
    // on any zero that means 'no reading'").
    if (closes.length < 200) return { signalClass: 'neutral', score: 0, unmeasured: true, confidence: 0.1, reason: `Insufficient data: need 200 bars, have ${closes.length} — unmeasured` };
    const lastClose = closes[closes.length - 1];
    const s200 = sma(closes, 200);
    if (s200 <= 0) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'SMA200 calculation failed' };
    const devPct = ((lastClose - s200) / s200) * 100;
    const s200recent = sma(closes.slice(-21, -1), 20);
    const slope200 = s200recent > 0 ? s200 - s200recent : 0;
    const slopeDir = slope200 > 0;

    // BASE (15-70): trend strength from SMA200 position
    const baseScore = Math.round(mapRange(devPct, -15, 15, 15, 70));

    // BONUS: breakout/breakdown
    let bonusScore = 0;
    let bonusLabel = '';
    if (devPct > 10 && slopeDir) { bonusScore = 30; bonusLabel = 'strong bull regime'; }
    else if (devPct > 5 && slopeDir) { bonusScore = 20; bonusLabel = 'bull regime'; }
    else if (devPct < -10 && !slopeDir) { bonusScore = 20; bonusLabel = 'bear regime'; }
    else if (devPct < -5) { bonusScore = 10; bonusLabel = 'correction'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = devPct > 0 && slopeDir ? 'bullish' : devPct < -5 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.3 + Math.abs(devPct) * 0.03).toFixed(2)),
      reason: `SP500 regime: ${devPct.toFixed(1)}% vs SMA200, SMA200 ${slopeDir ? 'rising' : 'falling'}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, devPct, slope200, slopeDir },
    };

  }
}

@Injectable()
export class VixStrategyDirective implements IDirective {
  readonly id = 'vix-strategy';
  readonly name = 'VIX-Based Strategy';
  readonly description = 'ATR percentile as VIX proxy for position sizing.';
  readonly priority = 63;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'beta' as const;

  /**
   * `structural` — a GATE, not a directional voter (#790, decided 2026-09-11).
   *
   * WHY THIS IS EXPLICIT NOW
   * ------------------------
   * This field was previously ABSENT (see the fuller note on `sp500-regime` above for why
   * that matters). `category` is optional on `IDirective`, so the guard reported this
   * directive as `⚠ no category — NOT CHECKED` on every build rather than enforcing it.
   *
   * WHY IT IS CORRECTLY A GATE, not a voter moved to a scoring group:
   *   1. Name and description say **"for position sizing"** — a size decision is a hurdle,
   *      not a directional conviction.
   *   2. It returns `bullish` or `neutral` and **never `bearish`** — it cannot express a
   *      short view, so it cannot act as a symmetric voter.
   *   3. Its score RISES with volatility (`percentile > 85` → +30 "extreme vol (VIX spike
   *      proxy)"). A high score therefore means "dangerous conditions", i.e. reduce size.
   *      Treated as conviction that would be inverted — a high score would *increase*
   *      BUY strength, which is the opposite of the intent.
   *
   * ⚠️ Point 3 is the reason this must NOT be "fixed" by moving it into a scoring group.
   * Point 2 alone would look like a weak voter; points 1+3 together make it a gate.
   */
  readonly category = 'structural' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    if (closes.length < 30) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${closes.length}` };
    const a = atr(highs, lows, closes, 14);
    if (a.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'ATR calculation failed' };
    const currentAtr = a[a.length - 1];
    const lastClose = closes[closes.length - 1];
    const atrPct = (currentAtr / lastClose) * 100;
    const atrVals = a.slice(-20);
    const sorted = [...atrVals].sort((a, b) => a - b);
    const rank = sorted.findIndex(v => v >= currentAtr);
    const percentile = rank >= 0 ? (rank / sorted.length) * 100 : 50;

    // BASE (15-60): ATR percentile as VIX proxy
    const baseScore = Math.round(mapRange(percentile, 0, 100, 15, 60));

    // BONUS: high vol regime
    let bonusScore = 0;
    let bonusLabel = '';
    if (percentile > 85) { bonusScore = 30; bonusLabel = 'extreme vol (VIX spike proxy)'; }
    else if (percentile > 70) { bonusScore = 20; bonusLabel = 'elevated vol regime'; }
    else if (percentile < 15) { bonusScore = 15; bonusLabel = 'low vol (complacency)'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = percentile < 30 ? 'bullish' : percentile > 70 ? 'neutral' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.3 + Math.min(0.3, Math.abs(percentile - 50) * 0.006)).toFixed(2)),
      reason: `VIX strategy: ATR ${atrPct.toFixed(2)}% (p${percentile.toFixed(0)}), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, atrPct, percentile },
    };

  }
}

@Injectable()
export class WeeklyRhythmStrategyDirective implements IDirective {
  // ── RETIRED 2026-10-09 (#879) ──
  // CLAIMED: "day-of-week statistical edges" — an unmeasured lookup table ("Tuesday
  // turnaround", "Wednesday strongest day") scoring every day 12-55 AND asserting direction
  // from the calendar. The Tuesday claim is the one just REFUTED by measurement (#879:
  // P(Tue up | red Mon) lift +0.35pp, t=0.30, 0 of 45 at the honest threshold).
  readonly id = 'weekly-rhythm-strategy';
  readonly name = 'Weekly Rhythm Strategy (retired)';
  readonly description =
    'RETIRED — the asserted day-of-week edges are unmeasured (the Tuesday turnaround was measured and did not reproduce). See #879.';
  readonly priority = 62;
  readonly maxScore = 85;
  readonly version = '3.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('Weekly rhythm strategy retired: unmeasured day-of-week edges; the Tuesday turnaround '
        + 'was measured and did not reproduce (+0.35pp, t=0.30). See #879.');
  }
}
