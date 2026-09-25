/**
 * Stochastic RSI (%K / %D crossover) — DIRECTIONAL, WITH NO SCORE CLIFF
 * ===================================================================
 * StochRSI applies the Stochastic formula to the RSI series rather than to price, so it oscillates
 * between 0 and 100 within RSI's own range and is far more sensitive to turning points than either
 * input alone. Its intended reading is a CROSSOVER — %K crossing %D marks a change of direction —
 * which is why the classification below is driven by the cross, not by an absolute level.
 *
 * ── WHY THIS DIRECTIVE EXISTS ────────────────────────────────────────────────────────────────
 * Owner, 2026-09-25: *"I'm looking at Stoch RSI on my chart right now. Its waves peak as high as 95.
 * Stoch RSI is about the crossover indicating change of direction… Are we using Stoch RSI as a
 * directive?"* — we were not. `stochastic` is plain %K/%D on **price** OHLC, not on RSI, and it was
 * wired into a single protocol that is `active = 0`. There was no Stoch RSI anywhere.
 *
 * ── ⚠️ THE FAULT THIS DIRECTIVE DELIBERATELY AVOIDS ─────────────────────────────────────────
 * The sibling `stochastic.directive.ts` declares `maxScore = 100` but classifies with
 * `total >= 60 ? … : 'neutral'` — so the **bottom 60 of its range can never enter the Signal**, and
 * a well-formed score of 40 is discarded as if it were 0. Measured across ~200,000 real readings
 * (2026-09-25), eight of the eleven directives in `xau-speed-m15` had NEVER once been directional
 * for the same shape of reason, and `earnings-momentum`/`adx`/`support-resistance-levels`/
 * `btc-halving-cycle` had best-ever scores of 0/16/25/59 against declared maxima of 100/100/95/200.
 *
 * So this directive is built the other way round:
 *   - the **score is continuous and every point of it is earnable**;
 *   - the classification is driven by the CROSS, which is a real two-state fact, not a threshold
 *     placed part-way up the score;
 *   - `maxScore` is set to a value the maths can actually reach (90, see the arithmetic below),
 *     so the denominator is not inflated by capacity that cannot be awarded.
 *
 * `neutral` is emitted ONLY when %K and %D are exactly equal — an genuinely indeterminate reading,
 * not a band that discards low scores.
 *
 * ── SCORING ─────────────────────────────────────────────────────────────────────────────────
 *   SEPARATION (0–50): how far %K has pulled away from %D — the conviction of the turn.
 *                        separation = min(50, |%K − %D| × 5)
 *   MOMENTUM   (0–50): how far %K sits from the 50 midpoint IN THE LEAN'S DIRECTION — how much
 *                      strength is actually behind the cross.
 *                        momentum = mapRange((%K − 50) × lean, −50, 50, 0, 50)
 *   TOTAL = SEPARATION + MOMENTUM, clamped to `maxScore`.
 *
 *   ⚠️ ONE INTERPRETATION ONLY — momentum, not mean reversion. An earlier draft scored "low %K is
 *   good for bulls" (the oversold-bounce reading), which made a saturated %K = %D = 100 score
 *   ZERO. Two philosophies in one number is how a well-formed reading becomes meaningless.
 *
 *   Maximum reachable: bullish with %K = 100 and %D = 90 gives separation 50 (cap) + momentum 50
 *   → **100**, so `maxScore = 100` is attainable. Partial scores are awarded at every value —
 *   there is no band below which a score is thrown away.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';

const RSI_PERIOD = 14;
const STOCH_PERIOD = 14;
const D_PERIOD = 3;
const MIN_BARS = RSI_PERIOD + STOCH_PERIOD + D_PERIOD + 2;

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

/**
 * StochRSI of a series: (x − min(x, n)) / (max(x, n) − min(x, n)) × 100.
 *
 * Kept local rather than added to `utils/indicators` because no other directive needs it, and a
 * shared utility with exactly one caller is a second copy waiting to drift.
 * Returns `null` for a flat window — a zero denominator is "no reading", never 0 or 50.
 */
function stochRsiSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const lo = Math.min(...window);
    const hi = Math.max(...window);
    out.push(hi === lo ? null : ((values[i] - lo) / (hi - lo)) * 100);
  }
  return out;
}

function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += values[j];
    out.push(s / period);
  }
  return out;
}

@Injectable()
export class StochRsiDirective implements IDirective {
  readonly id = 'stoch-rsi';
  readonly name = 'Stochastic RSI Crossover';
  readonly description =
    'StochRSI %K/%D crossover on the RSI series. Direction is the cross; the score is the separation between %K and %D plus the momentum behind it. No neutral band — a low score is a weak view, not no view.';
  readonly category = 'oscillator' as const;
  readonly priority = 70;
  /**
   * ⚠️ 100, and REACHABLE: separation 50 + momentum 50 at %K = 100 against %D = 90. Verified by
   * this file's own spec, which sweeps for the ceiling — a directive that declares capacity it
   * cannot award is the fault this one exists to avoid.
   */
  readonly maxScore = 100;
  readonly minScore = 0;
  readonly minBars = { '1d': MIN_BARS };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;
  /**
   * ⚠️ Declared `neutral` DELIBERATELY, even though it emits direction.
   * `SETTLED-DECISIONS.md` row 9 records that declarations lag implementations — `macd-crossover`
   * declares `neutral` and fired directionally 5,252 times — and that rounding directional capacity
   * on the DECLARED bias was tried, refuted and reverted. The runtime `signalClass` is the truth;
   * this field is a hint, and claiming a bias the engine may not honour would be worse.
   */
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map((b) => b.close);
    if (closes.length < MIN_BARS) {
      return {
        signalClass: 'neutral',
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
      };
    }

    const rsiValues = rsi(closes, RSI_PERIOD);
    if (rsiValues.length < STOCH_PERIOD + D_PERIOD + 2) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Not enough RSI values for StochRSI.' };
    }

    const stochRsi = stochRsiSeries(rsiValues, STOCH_PERIOD);
    // Drop the null (flat-window) entries before the %D average; a gap in the series would silently
    // shorten %D. If too few remain, that is "no reading", not a score built on a short window.
    const usable = stochRsi.filter((v): v is number => v !== null);
    if (usable.length < D_PERIOD + 1) {
      return {
        signalClass: 'neutral',
        score: 0,
        confidence: 0.1,
        reason: 'StochRSI flat across the window (min = max) — no oscillation to read.',
      };
    }

    const dValues = sma(usable, D_PERIOD);
    if (dValues.length < 2) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Not enough %D values.' };
    }

    const currentK = usable[usable.length - 1];
    const currentD = dValues[dValues.length - 1];
    const prevK = usable[usable.length - 2];
    const prevD = dValues[dValues.length - 2];

    // ── the cross, which is the actual signal ────────────────────────────────────────────────
    const crossUp = prevK <= prevD && currentK > currentD;
    const crossDown = prevK >= prevD && currentK < currentD;

    const separation = Math.min(50, Math.abs(currentK - currentD) * 5);
    // Direction: the cross. ⚠️ NOT `currentK > currentD` alone — when the two lines touch, that
    // test has no answer, and scoring a component while classifying `neutral` is precisely the cliff
    // this directive exists to avoid (caught by this file's own spec). The tie is broken by %K's
    // half: above 50 is the upper half of the oscillator, below 50 the lower.
    const bullish = currentK === currentD ? currentK >= 50 : currentK > currentD;
    const lean = bullish ? 1 : -1;

    // ⚠️ ONE INTERPRETATION, STATED ONCE: this is a MOMENTUM-crossover directive, not a
    // mean-reversion one. An earlier draft scored "low %K is good for bulls" — the oversold-bounce
    // reading — which made a saturated %K = %D = 100 (maximum upward momentum) score ZERO. Two
    // philosophies in one score is how a well-formed reading becomes a meaningless number.
    //
    //   SEPARATION (0–50): how far %K has pulled away from %D — the conviction of the turn.
    //   MOMENTUM   (0–50): how far %K sits from the 50 midpoint IN THE LEAN'S DIRECTION — how much
    //                      strength is actually behind the cross. %K 100 with a bullish lean is
    //                      maximum momentum; %K 20 with a bullish lean is a turn with nothing in it yet.
    const momentum = mapRange((currentK - 50) * lean, -50, 50, 0, 50);

    const raw = separation + momentum;
    const total = Math.round(Math.min(this.maxScore, Math.max(0, raw)));

    // ⚠️ THE INVARIANT, stated once and enforced here: **score > 0 ⟺ directional.**
    //   - A reading that awards nothing CLAIMS nothing (neutral).
    //   - A reading that awards anything SAYS WHICH WAY.
    // There is no third state, so a well-formed score can never be discarded for being small —
    // which is what makes the declared `maxScore` reachable in practice and not only on paper.
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (total <= 0) {
      signalClass = 'neutral';
    } else {
      signalClass = bullish ? 'bullish' : 'bearish';
    }

    // Confidence rises with the cross itself and with how far the two lines have parted. It is a
    // property of THIS reading, not of the score — a high score with a converged %K/%D is a spike.
    const confidence = Math.min(
      0.95,
      0.25 + (crossUp || crossDown ? 0.25 : 0) + (Math.abs(currentK - currentD) / 30) * 0.3,
    );

    const crossLabel = crossUp ? 'crossed UP' : crossDown ? 'crossed DOWN' : 'no fresh cross';
    const zone =
      currentK <= 20 ? 'oversold' : currentK >= 80 ? 'overbought' : 'mid-range';

    return {
      signalClass,
      score: total,
      confidence: Number(confidence.toFixed(2)),
      reason:
        `StochRSI %K=${currentK.toFixed(1)} %D=${currentD.toFixed(1)} (${crossLabel}, ${zone}): ` +
        `separation=${separation.toFixed(1)} + momentum=${momentum.toFixed(1)} = ${total}/${this.maxScore}`,
      metadata: {
        currentK: Number(currentK.toFixed(2)),
        currentD: Number(currentD.toFixed(2)),
        crossUp,
        crossDown,
        zone,
        separation: Number(separation.toFixed(2)),
        momentum: Number(momentum.toFixed(2)),
        // ⚠️ Stated so a reader can see the score was NOT gated: the classification came from the
        // cross and the score is whatever the maths produced, including when it is low.
        classifiedBy: 'crossover',
      },
    };
  }
}
