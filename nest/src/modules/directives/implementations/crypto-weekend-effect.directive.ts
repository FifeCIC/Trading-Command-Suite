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
  readonly description =
    'Accounts for 24/7 crypto weekend dynamics: lower volume, wider spreads, manipulation risk on Saturdays/Sundays. Monday mornings offer recovery opportunities.';
  readonly priority = 30;
  readonly maxScore = 50;
  readonly minBars = { '1d': 2 };
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const now = input.bars?.length ? new Date(input.bars[input.bars.length - 1].timestamp) : new Date();
    const day = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const hour = now.getUTCHours();

    let score: number;
    let reason: string;
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';

    if (day === 0) {
      // Sunday
      score = 15;
      reason = `Sunday (${hour}:00 UTC) — lowest volume day. Weekend drift risk. Exercise caution.`;
    } else if (day === 6) {
      // Saturday
      score = 20;
      reason = `Saturday (${hour}:00 UTC) — reduced liquidity. Institutional desks offline. Tighter position sizing recommended.`;
    } else if (day === 5 && hour >= 20) {
      // Friday after 20:00 UTC — weekend approaching
      score = 25;
      reason = `Friday ${hour}:00 UTC — pre-weekend. Consider reducing exposure before low-liquidity period.`;
    } else if (day === 1 && hour < 8) {
      // Monday early morning — weekend recovery
      score = 40;
      reason = `Monday ${hour}:00 UTC — weekend recovery window. Gap fills and re-pricing after low-volume period. Opportunity.`;
      signalClass = 'bullish';
    } else {
      // Weekday, normal conditions
      score = 10;
      reason = `Weekday (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]} ${hour}:00 UTC) — normal crypto market conditions.`;
    }

    return {
      score: Math.min(this.maxScore, score),
      confidence: 0.6,
      reason,
      signalClass,
    };
  }
}
