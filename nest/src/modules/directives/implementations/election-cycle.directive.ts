import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { retiredCalendarClaim } from './retired-calendar-claim';

/**
 * ElectionCycleDirective — RETIRED 2026-10-09 (#879). Kept so protocol references resolve.
 *
 * CLAIMED: "Year 3 of the US presidential cycle is historically strongest; year 2 weakest"
 * — unmeasured, and the strongest-claim in the family: it carries FOUR different fixed
 * scores (8/6/4/5) and two directions (bullish/bearish) off the calendar year alone.
 * RETURNED: a fixed score on EVERY day of every year (mode-3 breach by construction — there
 * is no "non-event day" for it at all).
 *
 * WHY IT CANNOT BE TESTED HERE (measured 2026-10-09): a 4-year cycle against a daily history
 * spanning 2025-12-25 -> 2026-10-08. There is not one completed cycle in the sample — zero
 * observations of the year-3 claim the directive is built around. Unmeasured; zero. See #879.
 */
@Injectable()
export class ElectionCycleDirective implements IDirective {
  readonly id = 'election-cycle';
  readonly name = 'Presidential Election Cycle (retired)';
  readonly description =
    'RETIRED — the asserted presidential-cycle year effects are unmeasured: not one completed 4-year cycle exists in the history. See #879.';
  readonly priority = 28;
  readonly maxScore = 8;
  readonly minScore = 0;
  readonly minBars = { '1d': 1 };
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;
  readonly category = 'pattern' as const;
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('Election cycle retired: unmeasured — not one completed 4-year cycle exists in the '
        + 'available history, so none of the year-phase claims has a sample. No basis; see #879.');
  }
}
