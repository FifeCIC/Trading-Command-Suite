import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * SeptemberSlumpDirective — RETIRED 2026-10-09 (#879). Kept so protocol references resolve.
 *
 * CLAIMED: "September is historically the worst month for equities since 1950" — unmeasured.
 * RETURNED: `score: isSeptember ? 16 : 3` with `directionBias: 'bearish'` — a fixed 16 on
 *           Septembers and a permanent 3-point floor the other 11 months (mode-3 breach).
 *
 * WHY IT CANNOT BE TESTED HERE (measured 2026-10-09): the daily-bar history spans
 * 2025-12-25 -> 2026-10-08 — ONE September (n=1). A monthly seasonality claim needs
 * decades of samples to clear an honest threshold (>=3.2 sigma with a control), so it is
 * NEITHER confirmed nor refuted here: it is unmeasured, and the honest state is zero.
 * See #879 for the method and the friday-drift/monday-effect refutations it produced.
 */
@Injectable()
export class SeptemberSlumpDirective implements IDirective {
  readonly id = 'september-slump';
  readonly name = 'September Slump (retired)';
  readonly description =
    'RETIRED — the asserted September bearish bias is unmeasured: the available history contains one September (n=1) against a claim that needs decades. See #879.';
  readonly category = 'pattern' as const;
  readonly priority = 32;
  readonly maxScore = 20;
  readonly minScore = 0;
  readonly minBars = { '1d': 1 };
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;
  /** The bearish assertion is withdrawn pending measurement. */
  readonly directionBias = 'neutral' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    void _input;
    return {
      score: 0,
      confidence: 0,
      signalClass: 'neutral',
      unmeasured: true,
      reason:
        'September slump retired: unmeasured — the daily history holds one September '
        + '(n=1) against a claim that needs decades of samples. No basis to assert; see #879.',
    };
  }
}
