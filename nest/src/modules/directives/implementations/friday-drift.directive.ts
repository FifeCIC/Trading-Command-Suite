import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * FridayDriftDirective — RETIRED 2026-09-18. Kept only so existing protocol references resolve.
 *
 * WHY IT NO LONGER SCORES
 * =======================
 * This directive asserted, in this very header, with no source and no sample size:
 *
 *     "Fridays close higher ~58% of the time — positive drift into weekend."
 *
 * and then returned `score: isFriday ? 8 : 2` with `directionBias: 'bullish'`.
 *
 * MEASURED, 37 symbols, 42 last-sessions-of-week each and 157–165 control sessions from the
 * same symbols (difference-in-differences, so any bar-source skew cancels):
 *
 *     mean P(last session of week closes up) = 50.7%
 *     mean P(other sessions close up)        = 52.7%   <- the baseline is HIGHER
 *     symbols with a >= 2 sigma effect        = 1 of 37
 *
 * The claim is 7.3pp above the measurement AND points the wrong way relative to the
 * baseline. There is no Friday session drift in this data. See issue #879.
 *
 * It also breached two of the rules in `directive.interface.ts`:
 *   - mode 1 completeness theatre — an unmeasured historical claim marked `ready`
 *   - mode 3 constant floor       — it returned 2 on every non-Friday; "no signal means 0"
 *
 * WHAT REPLACED IT
 * ================
 * `weekend-gap-bias.directive.ts` (`weekend-gap-bias`). A DIFFERENT effect is real and
 * measurable — the weekend GAP, not the Friday session — and it is symbol-specific rather
 * than uniform: AUDJPY +37.5pp, EURCHF +29.0pp, GBPCAD +30.2pp, US500 +28.1pp at >= 3.2σ,
 * with VIX INVERTED (weekends gap UP, favouring a LONG).
 *
 * ⚠️ The replacement measures its edge from the bars it is given, against the same symbol's
 * weekday gaps. It does NOT hardcode the numbers above — those are 42 weekends of one regime.
 *
 * ⚠️ WHY THIS WAS NOT DELETED OUTRIGHT: protocol definitions may still reference the id, and
 * a missing directive and a retired one must not look the same to the loader. It returns an
 * explicit zero with `unmeasured: true`, which is genuinely the state of knowledge: the
 * claimed effect is not merely unproven, it failed to appear when tested.
 */
@Injectable()
export class FridayDriftDirective implements IDirective {
  readonly id = 'friday-drift';
  readonly name = 'Friday Drift (retired)';
  readonly description =
    'RETIRED — the asserted Friday bullish drift did not reproduce (measured 50.7% vs a 52.7% baseline). Superseded by weekend-gap-bias.';
  readonly priority = 25;
  readonly maxScore = 8;
  readonly minScore = 0;
  readonly minBars = { '1d': 5 };
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;
  readonly category = 'pattern' as const;
  /** The bullish assertion is withdrawn: the claim did not survive measurement. */
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return {
      score: 0,
      confidence: 0,
      signalClass: 'neutral',
      unmeasured: true,
      reason:
        'Friday drift retired: the asserted +58% Friday close bias measured 50.7% against a ' +
        '52.7% all-session baseline (37 symbols, 42 sessions each, difference-in-differences). ' +
        'No Friday session effect found. See weekend-gap-bias for the measured weekend effect.',
    };
  }
}

