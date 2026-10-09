import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * OpexGammaDirective — RETIRED 2026-10-09 (#879). Kept so protocol references resolve.
 *
 * CLAIMED: "Monthly options expiration (3rd Friday) — gamma pinning suppresses directional
 * movement" — unmeasured, and it also carries a second problem: the bars are stamped
 * session-START with a Sun–Thu week (#880), so `getUTCDay() === 5` (Friday) matches NOTHING
 * in the daily data. The claim could not fire from a daily bar even if it were true.
 * RETURNED: `score: isThirdFriday ? 5 : 2` — plus a permanent 2-point floor (mode-3 breach).
 *
 * WHY IT CANNOT BE TESTED HERE (measured 2026-10-09): ~10 third-Friday events exist in the
 * history (2025-12-25 -> 2026-10-08) — far below what an honest threshold (>=3.2 sigma)
 * needs, especially with the label caveat above. Unmeasured; zero. See #879.
 */
@Injectable()
export class OpexGammaDirective implements IDirective {
  readonly id = 'opex-gamma';
  readonly name = 'OpEx Gamma Pinning (retired)';
  readonly description =
    'RETIRED — the asserted OpEx gamma-pinning effect is unmeasured (~10 events vs a threshold that needs years), and Friday-stamped bars do not exist in the daily data (#880). See #879.';
  readonly category = 'pattern' as const;
  readonly priority = 25;
  readonly maxScore = 8;
  readonly minScore = 0;
  readonly minBars = { '1d': 20 };
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
        'OpEx gamma retired: unmeasured — ~10 third-Friday events in the available history, '
        + 'and daily bars carry no Friday stamp (#880). No basis to assert; see #879.',
    };
  }
}
