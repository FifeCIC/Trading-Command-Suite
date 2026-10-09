import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * OctoberReliefDirective — RETIRED 2026-10-09 (#879). Kept so protocol references resolve.
 *
 * CLAIMED: "Mid-to-late October reversal rally after the September selloff" — unmeasured.
 * RETURNED: `score: isWindow ? 12 : 3` with `directionBias: 'bullish'` — fixed 12 in the
 *           window and a permanent 3-point floor outside it (mode-3 breach).
 *
 * WHY IT CANNOT BE TESTED HERE (measured 2026-10-09): the daily history ENDS 2026-10-08 —
 * the window it claims (Oct 15+) has ZERO occurrences in the sample. Unmeasured; zero.
 * See #879.
 */
@Injectable()
export class OctoberReliefDirective implements IDirective {
  readonly id = 'october-relief';
  readonly name = 'October Relief (retired)';
  readonly description =
    'RETIRED — the asserted Oct 15+ reversal window is unmeasured: zero occurrences in the available history. See #879.';
  readonly category = 'pattern' as const;
  readonly priority = 30;
  readonly maxScore = 12;
  readonly minScore = 0;
  readonly minBars = { '1d': 1 };
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;
  /** The bullish assertion is withdrawn pending measurement. */
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return {
      score: 0,
      confidence: 0,
      signalClass: 'neutral',
      unmeasured: true,
      reason:
        'October relief retired: unmeasured — the claimed window has zero occurrences in the '
        + 'available history (bars end 2026-10-08). No basis to assert; see #879.',
    };
  }
}
