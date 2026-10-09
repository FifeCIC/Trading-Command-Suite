import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { retiredCalendarClaim } from './retired-calendar-claim';

/**
 * SantaClausRallyDirective — RETIRED 2026-10-09 (#879). Kept so protocol references resolve.
 *
 * CLAIMED: "Dec 24 – Jan 2 bullish window, historically ~1.3% over 7 trading days" — unmeasured.
 * RETURNED: `score: isWindow ? 15 : 5` with `directionBias: 'bullish'` — fixed 15 in the
 *           window and a permanent 5-point floor all year (mode-3 breach).
 *
 * WHY IT CANNOT BE TESTED HERE (measured 2026-10-09): the daily history starts 2025-12-25 —
 * ONE partial window (Dec 25 2025 – Jan 2 2026, ~4 sessions). A window claim needs many
 * year-cycles to clear an honest threshold. Unmeasured; zero. See #879.
 */
@Injectable()
export class SantaClausRallyDirective implements IDirective {
  readonly id = 'santa-claus-rally';
  readonly name = 'Santa Claus Rally (retired)';
  readonly description =
    'RETIRED — the asserted Dec 24–Jan 2 bullish window is unmeasured: one partial occurrence (~4 sessions) in the available history. See #879.';
  readonly category = 'pattern' as const;
  readonly priority = 30;
  readonly maxScore = 20;
  readonly minScore = 0;
  readonly minBars = { '1d': 1 };
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;
  /** The bullish assertion is withdrawn pending multi-year measurement. */
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return retiredCalendarClaim('Santa Claus rally retired: unmeasured — one partial window (~4 sessions) in the '
        + 'available history against a claim that needs many year-cycles. No basis; see #879.');
  }
}
