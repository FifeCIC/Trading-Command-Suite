import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { retiredCalendarClaim } from './retired-calendar-claim';

/**
 * TurnaroundTuesdayDirective — RETIRED 2026-10-09 (#879). Kept so protocol references resolve.
 *
 * CLAIMED: "Tuesday tends to reverse Monday's direction — bullish after a red Monday, bearish
 * after a green one" — unmeasured (score 12 on the reversal branch).
 *
 * MEASURED 2026-10-09 by the family's method — P(Tuesday UP | Monday closed DOWN) minus the
 * unconditional Tuesday UP rate, same symbol as its own control (difference-in-differences):
 *
 *     45 symbols; mean lift +0.35pp (t = 0.30 across symbols)
 *     0 of 45 at >= 2 sigma;  0 of 45 at >= 3.2 sigma (Bonferroni)
 *
 * The reversal does not appear in this data. Returns an explicit zero with `unmeasured: true`.
 * (Note: the non-Tuesday path ALREADY returned 0 — this directive never carried a floor.)
 */
@Injectable()
export class TurnaroundTuesdayDirective implements IDirective {
  readonly id = 'turnaround-tuesday';
  readonly name = 'Turnaround Tuesday (retired)';
  readonly description =
    'RETIRED — the asserted Tuesday reversal did not reproduce (45 symbols, mean lift +0.35pp, 0 at the honest threshold). See #879.';
  readonly category = 'pattern' as const;
  readonly priority = 28;
  readonly maxScore = 15;
  readonly minScore = 0;
  readonly minBars = { '1d': 2 };
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;
  /** The reversal assertion is withdrawn: the claim did not survive measurement. */
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('Turnaround Tuesday retired: measured 45 symbols, P(Tue up | red Mon) lift +0.35pp '
        + '(t=0.30), 0 of 45 at the honest threshold. No reversal found. See #879.');
  }
}
