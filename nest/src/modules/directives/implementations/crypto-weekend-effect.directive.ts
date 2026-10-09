/**
 * Crypto Weekend Effect
 * =====================
 * Crypto markets trade 24/7, but weekends have distinct characteristics:
 * - Lower volume (institutions offline)
 * - Wider spreads (market makers pull liquidity)
 * - Whale manipulation risk (less volume to absorb large orders)
 * - Monday recovery patterns (gap fills from weekend moves)
 *
 * maxScore: 50 — modest weight, this is a risk-awareness directive.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

@Injectable()
export class CryptoWeekendEffectDirective implements IDirective {
  readonly id = 'crypto-weekend-effect';
  readonly name = 'Crypto Weekend Effect';
  readonly category = 'pattern' as const;
  readonly description =
    'Accounts for 24/7 crypto weekend dynamics: lower volume, wider spreads, manipulation risk on Saturdays/Sundays. Monday mornings offer recovery opportunities.';
  readonly priority = 30;
  readonly maxScore = 50;
  readonly minScore = 1;
  readonly minBars = { '1d': 2 };
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const now = input.bars?.length ? new Date(input.bars[input.bars.length - 1].timestamp) : new Date();
    const day = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const hour = now.getUTCHours();

    // ── #879 (2026-10-09): MEASURED CLAIMS ONLY ──
    // The weekend-liquidity claim is measured from this repo's own daily bars: Saturday volume
    // runs ~48-63% of the weekday mean (BTC 9,506 vs ~19,000; ETH 165k vs ~330k; SOL 1.75M vs
    // ~2.6M — 29 sessions per weekday, 2025-12-25 -> 2026-10-08). Weekend risk-awareness scores
    // below encode THAT measured condition, and stay direction-neutral.
    //
    // REMOVED in the same change:
    //  - the WEEKDAY constant 10 ("normal conditions") — a non-event day must score 0;
    //  - the Monday-before-08:00 BULLISH 40 ("weekend recovery, gap fills") — an untested
    //    directional claim (1d bars cannot see intraday windows; no measurement exists).
    if (day === 0 || day === 6 || (day === 5 && hour >= 20)) {
      const score = day === 6 ? 20 : day === 0 ? 15 : 25;
      const label = day === 6
        ? 'Saturday — reduced liquidity (measured: weekend volume ~half the weekday average)'
        : day === 0
          ? 'Sunday — lowest volume day (measured: weekend volume ~half the weekday average)'
          : `Friday ${hour}:00 UTC — pre-weekend low-liquidity period (measured: weekend volume ~half the weekday average)`;
      return {
        score: Math.min(this.maxScore, score),
        confidence: 0.6,
        reason: label,
        signalClass: 'neutral',
      };
    }

    return {
      score: 0,
      confidence: 0,
      signalClass: 'neutral',
      unmeasured: true,
      reason: `Weekday (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]} ${hour}:00 UTC) — no weekend condition; contributes nothing (#879: the old weekday constant and the untested Monday-early bullish branch were removed).`,
    };
  }
}
