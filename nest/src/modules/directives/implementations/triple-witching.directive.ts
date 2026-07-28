import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * Triple Witching Directive
 * Quarterly expiration (Mar/Jun/Sep/Dec 3rd Friday) — elevated volume and volatility.
 */
@Injectable()
export class TripleWitchingDirective implements IDirective {
  readonly id = 'triple-witching';
  readonly name = 'Triple Witching';
  readonly description = 'Quarterly options/futures expiration (Mar/Jun/Sep/Dec 3rd Friday) — elevated volume and volatility warning.';
  readonly priority = 25;
  readonly maxScore = 5;
  readonly minBars = { '1d': 1 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const month = now.getUTCMonth(); // 2=Mar, 5=Jun, 8=Sep, 11=Dec
    const dayOfWeek = now.getUTCDay(); // 5=Fri
    const day = now.getUTCDate();

    // Quarterly months: Mar (2), Jun (5), Sep (8), Dec (11)
    const isQuarterlyMonth = [2, 5, 8, 11].includes(month);
    const isThirdFriday = dayOfWeek === 5 && day >= 15 && day <= 21;
    const isTripleWitching = isQuarterlyMonth && isThirdFriday;

    return {
      signalClass: 'neutral',
      score: isTripleWitching ? 3 : 1,
      confidence: isTripleWitching ? 0.6 : 0.3,
      reason: isTripleWitching
        ? 'Triple Witching — elevated volume and volatility, neutral bias'
        : 'Not Triple Witching',
    };
  }
}
