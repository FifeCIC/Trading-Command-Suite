import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { retiredCalendarClaim } from './retired-calendar-claim';

/**
 * JanuaryEffectDirective — RETIRED 2026-10-09 (#879). Kept so protocol references resolve.
 *
 * CLAIMED: "January small-cap outperformance — historically strongest month" — unmeasured.
 * RETURNED: `score: isJanuary ? 12 : 3` with `directionBias: 'bullish'` — fixed 12 in
 *           Januaries and a permanent 3-point floor all year (mode-3 breach).
 *
 * WHY IT CANNOT BE TESTED HERE (measured 2026-10-09): the daily history spans
 * 2025-12-25 -> 2026-10-08 — ONE January (n=1), and a small-cap claim additionally needs
 * a size benchmark the bars do not carry. Unmeasured; zero. See #879.
 */
@Injectable()
export class JanuaryEffectDirective implements IDirective {
  readonly id = 'january-effect';
  readonly name = 'January Effect (retired)';
  readonly description =
    'RETIRED — the asserted January bullish bias is unmeasured: one January (n=1) in the history, and no size benchmark for a small-cap claim. See #879.';
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
    return retiredCalendarClaim('January effect retired: unmeasured — one January in the available history and no '
        + 'size benchmark for the small-cap claim. No basis to assert; see #879.');
  }
}
