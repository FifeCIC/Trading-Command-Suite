import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { retiredCalendarClaim } from './retired-calendar-claim';

/**
 * SellInMayDirective — RETIRED 2026-10-09 (#879). Kept so protocol references resolve.
 *
 * CLAIMED: "May–October seasonal equity weakness, the worst 6-month stretch" — unmeasured.
 * RETURNED: `score: isWindow ? 12 : 3` with `directionBias: 'bearish'` — fixed 12 for
 *           half of every year and a permanent 3-point floor for the other half (mode-3 breach).
 *
 * WHY IT CANNOT BE TESTED HERE (measured 2026-10-09): a seasonal window that covers half the
 * year needs MANY YEARS — the window-vs-control contrast only becomes independent data once
 * you have N separate year-cycles. The daily-bar history spans 2025-12-25 -> 2026-10-08:
 * fewer than one complete cycle, and the "off" season barely exists in it. Unmeasured; zero.
 * See #879.
 */
@Injectable()
export class SellInMayDirective implements IDirective {
  readonly id = 'sell-in-may';
  readonly name = 'Sell in May (retired)';
  readonly description =
    'RETIRED — the asserted May–October seasonal weakness is unmeasured: fewer than one year-cycle exists in the history. See #879.';
  readonly category = 'pattern' as const;
  readonly priority = 30;
  readonly maxScore = 12;
  readonly minScore = 0;
  readonly minBars = { '1d': 1 };
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;
  /** The bearish assertion is withdrawn pending multi-year measurement. */
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('Sell-in-May retired: unmeasured — the window spans half of every year and the history '
        + 'holds fewer than one complete cycle. No basis to assert; see #879.');
  }
}
