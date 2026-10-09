import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { retiredCalendarClaim } from './retired-calendar-claim';

/**
 * MondayEffectDirective — RETIRED 2026-10-09 (#879). Kept so protocol references resolve.
 *
 * CLAIMED: "Mondays are statistically the worst day of the week for equities" — unmeasured.
 * RETURNED: `score: isMonday ? 8 : 2` with `directionBias: 'bearish'` on every day,
 *           i.e. a permanent 2-point floor on 4 days out of 5 (mode-3 breach).
 *
 * MEASURED 2026-10-09 by the friday-drift method (difference-in-differences —
 * P(close DOWN | Monday) - P(close DOWN | all other sessions), same symbol, so any
 * bar-source skew cancels): 45 symbols, 41-42 Monday sessions each against ~200 controls.
 *
 *     mean Monday-vs-other DOWN excess = +0.44pp   (t = 0.36 across symbols)
 *     symbols at >=3.2 sigma (Bonferroni) = 0 of 45
 *     the single >=2 sigma case (AUDJPY, -19.8pp) points the OPPOSITE way (Mondays UP)
 *
 * The effect does not appear in this data. It returns an explicit zero with
 * `unmeasured: true` — the claim is not merely unproven, it failed to appear when tested.
 */
@Injectable()
export class MondayEffectDirective implements IDirective {
  readonly id = 'monday-effect';
  readonly name = 'Monday Effect (retired)';
  readonly category = 'pattern' as const;
  readonly description =
    'RETIRED — the asserted Monday bearish bias did not reproduce (45 symbols, 0 at the honest threshold; mean +0.44pp, t=0.36). See #879.';
  readonly priority = 25;
  readonly maxScore = 8;
  readonly minScore = 0;
  readonly minBars = { '1d': 2 };
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;
  /** The bearish assertion is withdrawn: the claim did not survive measurement. */
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('Monday effect retired: measured 45 symbols x 41-42 Mondays, Monday-vs-other down '
        + 'excess +0.44pp (t=0.36), 0 of 45 at the honest 3.2-sigma threshold. No Monday '
        + 'effect found in the available history. See #879.');
  }
}
