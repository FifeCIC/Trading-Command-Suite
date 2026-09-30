/**
 * surge.directive.ts — the three directives for the "Trade a Surge" strategy (#663).
 * ==============================================================================
 *
 * WHY THREE, AND WHY THEY ARE SEPARATE
 * ------------------------------------
 * A surge trade fails when detection and decision are the same act. The strategy is built on
 * separating them:
 *
 *   surge-detection         "a fast, large move just happened"      — DETECTION, immediate
 *   spike-hold-confirmation "did it hold, or fall back inside?"     — DECISION, waits for evidence
 *   surge-exhaustion        "is the move running out of fuel?"      — QUALITY, decelerating
 *
 * ⚠️ **THE THREE ARE NOT A SCORE OF THE SAME THING.** Detection fires on the event; the other two
 * can disagree with it — that disagreement is the whole design. A protocol that weights all three
 * equally is measuring one opinion three times, which is the commonest way a multi-directive
 * strategy backtests well and fails live.
 *
 * ── ⚠️ SIGNAL CLASS IS COMPUTED, NEVER DECLARED `neutral` ────────────────────────────────────
 * All three declare `directionBias: 'neutral'`, which per `directive.interface.ts` is *valid for a
 * dynamic two-sided directive* — and all three return a signalClass derived from the DATA. This is
 * the #1020 / #1027 defect avoided by construction: `regime-shift-exit` and `time-stop` hardcoded
 * `signalClass: 'neutral'`, and because `arguesExit` read only signalClass, **two of five exit
 * directives could never argue an exit, even at score 100**. A directive that returns `neutral`
 * regardless of its input is not a neutral directive, it is a mute one.
 *
 * ── ⚠️ `readiness: 'alpha'` IS THE HONEST TIER, NOT MODESTY ──────────────────────────────────
 * The interface default is `'alpha'` — *alpha until proven otherwise* — and a protocol can only
 * claim the readiness of its **weakest** directive. Nothing here has been validated against a live
 * book, so `beta` or `ready` would be an overclaim of exactly the kind `docs/readiness-tiers.md`
 * exists to prevent. These move up only on evidence.
 *
 * ── ⚠️ NOT ATTACHED TO ANY LIVE PROTOCOL, DELIBERATELY ──────────────────────────────────────
 * Registering a directive is additive; **attaching it to a live protocol changes what a tradeable
 * symbol scores**, which is a maths change and needs a copied configuration and a monitored
 * comparison (`maths-change-requires-ab.instructions.md`). That attachment is a separate decision.
 *
 * See `src/data/strategy-library-leads.js` → `trade-a-surge` for the strategy this implements.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/** Bars needed before any of these can say anything. Below it, every directive abstains. */
const MIN_BARS = 30;
const MIN_BARS_BY_TF: Record<string, number> = {
  '1m': MIN_BARS, '5m': MIN_BARS, '15m': MIN_BARS, '30m': MIN_BARS,
  '1h': MIN_BARS, '4h': MIN_BARS, '1d': MIN_BARS,
};

/** True range of one bar against the previous close — the ATR building block, inlined so these
 *  directives carry no dependency on another directive's private maths. */
function trueRange(bar: { high: number; low: number }, prevClose: number): number {
  return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
}

/** Average true range over `period` bars, ending at the last bar. */
function atr(bars: Array<{ high: number; low: number; close: number }>, period: number): number {
  const start = Math.max(1, bars.length - period);
  let sum = 0;
  let n = 0;
  for (let i = start; i < bars.length; i++) {
    sum += trueRange(bars[i], bars[i - 1].close);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Surge Detection — a fast, large move measured AGAINST VOLATILITY, not against a fixed percent.
 *
 * ⚠️ ATR-relative on purpose. The same 1% is noise on gold and a surge on an index, so a fixed
 * threshold would fire constantly on one instrument and never on another. The multiplier is the
 * strategy's one real tunable (see the placement note in `strategy-library-leads.js`).
 */
@Injectable()
export class SurgeDetectionDirective implements IDirective {
  readonly id = 'surge-detection';
  readonly name = 'Surge Detection';
  readonly description = 'Flags a fast, large move as a multiple of ATR. Direction follows the data: an up-surge is bullish, a down-surge bearish.';
  readonly priority = 30;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = MIN_BARS_BY_TF;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;

  /** The multiple of ATR a move must exceed to count. The strategy's headline tunable. */
  private static readonly ATR_MULTIPLE = 2.0;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (!bars || bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Need ${MIN_BARS}+ bars for a surge read (have ${bars?.length ?? 0})`, signalClass: 'neutral' };
    }

    const a = atr(bars, 14);
    if (a <= 0) {
      return { score: 0, confidence: 0.1, reason: 'ATR is zero — no volatility to measure a surge against', signalClass: 'neutral' };
    }

    const last = bars[bars.length - 1];
    const prevClose = bars[bars.length - 2].close;
    const move = last.close - prevClose;
    const magnitude = Math.abs(move);
    const multiple = magnitude / a;

    if (multiple < SurgeDetectionDirective.ATR_MULTIPLE) {
      // ⚠️ NO SURGE IS A REAL ANSWER, and it scores LOW rather than returning neutral-as-a-verdict.
      // The score still carries how close the move came, so a protocol can rank near-misses.
      const proximity = multiple / SurgeDetectionDirective.ATR_MULTIPLE;
      return {
        score: Math.round(proximity * 25),
        confidence: 0.3,
        reason: `Move is ${multiple.toFixed(2)}× ATR — below the ${SurgeDetectionDirective.ATR_MULTIPLE}× surge threshold`,
        signalClass: 'neutral',
      };
    }

    // Headroom above the threshold, saturating so one extreme bar cannot dominate a composite.
    const excess = Math.min(1, (multiple - SurgeDetectionDirective.ATR_MULTIPLE) / SurgeDetectionDirective.ATR_MULTIPLE);
    const score = Math.round(60 + excess * 40);
    const up = move > 0;
    return {
      score,
      confidence: Math.min(0.9, 0.5 + excess * 0.4),
      reason: `SURGE ${up ? 'UP' : 'DOWN'} — ${multiple.toFixed(2)}× ATR (${magnitude.toFixed(4)} over ${a.toFixed(4)} ATR)`,
      signalClass: up ? 'bullish' : 'bearish',
    };
  }
}

/**
 * Spike Hold Confirmation — did the move HOLD, or did price fall back inside it?
 *
 * ⚠️ BOTH OUTCOMES TRADE, IN OPPOSITE DIRECTIONS, and that is why this is a genuine two-sided
 * directive rather than a filter:
 *   • held above the spike → continuation → **bullish**
 *   • fell back inside     → failed spike → **bearish** (the fade)
 * Returning `neutral` for the failure case would collapse the two halves of the strategy into one
 * and make the fade branch unreachable — the #1020 defect.
 */
@Injectable()
export class SpikeHoldConfirmationDirective implements IDirective {
  readonly id = 'spike-hold-confirmation';
  readonly name = 'Spike Hold Confirmation';
  readonly description = 'Whether price held outside the spike bar range or fell back inside it. Held = continuation (bullish); failed = fade (bearish).';
  readonly priority = 40;
  readonly maxScore = 75;
  readonly minScore = 1;
  readonly minBars = MIN_BARS_BY_TF;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (!bars || bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Need ${MIN_BARS}+ bars to judge a hold (have ${bars?.length ?? 0})`, signalClass: 'neutral' };
    }

    const a = atr(bars, 14);
    if (a <= 0) {
      return { score: 0, confidence: 0.1, reason: 'ATR is zero — cannot judge a hold', signalClass: 'neutral' };
    }

    // Find the most recent "spike bar" — the largest single-bar move in the lookback — and judge
    // everything that followed against ITS range.
    let spikeIdx = -1;
    let spikeMag = 0;
    for (let i = Math.max(1, bars.length - 10); i < bars.length; i++) {
      const m = Math.abs(bars[i].close - bars[i - 1].close);
      if (m > spikeMag) { spikeMag = m; spikeIdx = i; }
    }
    if (spikeIdx < 0 || spikeMag < a * 1.5) {
      return { score: 0, confidence: 0.2, reason: 'No spike in the last 10 bars to judge a hold against', signalClass: 'neutral' };
    }

    const spike = bars[spikeIdx];
    const up = spike.close > bars[spikeIdx - 1].close;
    const after = bars.slice(spikeIdx + 1);
    if (after.length === 0) {
      // The spike IS the current bar — nothing has happened since it. Abstain rather than guess.
      return { score: 20, confidence: 0.2, reason: 'Spike is the current bar — no bars yet to judge the hold', signalClass: 'neutral' };
    }

    const held = after.some((b) => (up ? b.close > spike.high : b.close < spike.low));
    const closedBack = (up ? spike.high - bars[bars.length - 1].close : bars[bars.length - 1].close - spike.low) / a;

    if (held) {
      return {
        score: Math.round(55 + Math.min(1, closedBack) * 20),
        confidence: 0.65,
        reason: `Spike HELD — price stayed ${up ? 'above the spike high' : 'below the spike low'} for ${after.length} bar(s)`,
        signalClass: up ? 'bullish' : 'bearish',
      };
    }

    return {
      score: Math.round(50 + Math.min(1, closedBack) * 25),
      confidence: 0.6,
      reason: `Spike FAILED — price closed back inside the spike range by ${closedBack.toFixed(2)}× ATR`,
      // A failed up-spike is bearish; a failed down-spike is bullish. The INVERSION is the point.
      signalClass: up ? 'bearish' : 'bullish',
    };
  }
}

/**
 * Surge Exhaustion — is the move running out of fuel?
 *
 * Measures DECELERATION: the ground covered per bar late in the move against the ground covered
 * early. A move still covering full ground is not tiring, however long it has run.
 *
 * ⚠️ DIRECTION IS INVERTED FROM THE SURGE, because exhaustion argues the OPPOSITE of the move that
 * caused it. An up-move losing momentum is a **bearish** reading, not "less bullish". Scoring it as
 * a weaker version of the same direction would make it useless for any exit decision — the same
 * conflation `#995` records in the guardian's exhaustion detection.
 */
@Injectable()
export class SurgeExhaustionDirective implements IDirective {
  readonly id = 'surge-exhaustion';
  readonly name = 'Surge Exhaustion';
  readonly description = 'Whether a surge is decelerating — ground covered late versus early. Exhaustion of an up-move reads bearish, of a down-move bullish.';
  readonly priority = 45;
  readonly maxScore = 80;
  readonly minScore = 1;
  readonly minBars = MIN_BARS_BY_TF;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (!bars || bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Need ${MIN_BARS}+ bars for a deceleration read (have ${bars?.length ?? 0})`, signalClass: 'neutral' };
    }

    const a = atr(bars, 14);
    if (a <= 0) {
      return { score: 0, confidence: 0.1, reason: 'ATR is zero — cannot measure deceleration', signalClass: 'neutral' };
    }

    // The net move over the window, and its direction. No surge means nothing to exhaust.
    const window = bars.slice(-5);
    const netMove = window[window.length - 1].close - window[0].close;
    const lastBarMove = Math.abs(bars[bars.length - 1].close - bars[bars.length - 2].close);
    if (Math.abs(netMove) < a * 1.5) {
      return { score: 0, confidence: 0.2, reason: `No surge to exhaust — net move is ${(Math.abs(netMove) / a).toFixed(2)}× ATR`, signalClass: 'neutral' };
    }

    // Deceleration = how small the latest bar is against the average bar of the move.
    const avgBar = Math.abs(netMove) / window.length;
    const ratio = avgBar > 0 ? lastBarMove / avgBar : 1;

    if (ratio >= 1) {
      return {
        score: 30,
        confidence: 0.4,
        reason: `Move is still expanding (latest bar ${ratio.toFixed(2)}× the average of the move) — not exhausting`,
        signalClass: 'neutral',
      };
    }

    const decel = Math.min(1, 1 - ratio);
    const up = netMove > 0;
    return {
      score: Math.round(40 + decel * 35),
      confidence: Math.min(0.8, 0.35 + decel * 0.45),
      reason: `Surge ${up ? 'UP' : 'DOWN'} DECELERATING — latest bar is ${ratio.toFixed(2)}× the average of the move`,
      signalClass: up ? 'bearish' : 'bullish',
    };
  }
}
