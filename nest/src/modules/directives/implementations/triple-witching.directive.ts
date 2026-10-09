import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * TripleWitchingDirective — RETIRED 2026-10-09 (#879). Kept so protocol references resolve.
 *
 * CLAIMED: "Quarterly triple-witching (3rd Friday of Mar/Jun/Sep/Dec) raises volatility" —
 * unmeasured, and it shares the Friday-stamp problem: daily bars are stamped session-START
 * with a Sun–Thu week (#880), so `getUTCDay() === 5` matches NOTHING in the daily data.
 * RETURNED: `score: isTripleWitching ? 3 : 1` — plus a permanent 1-point floor (mode-3 breach).
 *
 * WHY IT CANNOT BE TESTED HERE (measured 2026-10-09): THREE quarterly events exist in the
 * history (Mar/Jun/Sep 2026) — hopelessly underpowered. Unmeasured; zero. See #879.
 */
@Injectable()
export class TripleWitchingDirective implements IDirective {
  readonly id = 'triple-witching';
  readonly name = 'Triple Witching (retired)';
  readonly description =
    'RETIRED — the asserted triple-witching volatility effect is unmeasured (3 events in the history, no Friday-stamped daily bars). See #879.';
  readonly category = 'pattern' as const;
  readonly priority = 25;
  readonly maxScore = 5;
  readonly minScore = 0;
  readonly minBars = { '1d': 1 };
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return {
      score: 0,
      confidence: 0,
      signalClass: 'neutral',
      unmeasured: true,
      reason:
        'Triple witching retired: unmeasured — three quarterly events in the available history '
        + 'and no Friday-stamped daily bars (#880). No basis to assert; see #879.',
    };
  }
}
