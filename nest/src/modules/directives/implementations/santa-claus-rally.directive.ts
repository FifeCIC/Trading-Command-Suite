import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * Santa Claus Rally Directive
 * Dec 24 – Jan 2 bullish bias (historically ~1.3% gain over 7 trading days).
 */
@Injectable()
export class SantaClausRallyDirective implements IDirective {
  readonly id = 'santa-claus-rally';
  readonly name = 'Santa Claus Rally';
  readonly description = 'Dec 24–Jan 2 bullish window. Historically ~1.3% gain over the final 5 trading days of December and first 2 of January.';
  readonly priority = 30;
  readonly maxScore = 20;
  readonly minBars = { '1d': 1 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const month = now.getMonth(); // 0=Jan, 11=Dec
    const day = now.getDate();

    const isWindow = (month === 11 && day >= 24) || (month === 0 && day <= 2);

    return {
      signalClass: isWindow ? 'bullish' : 'neutral',
      score: isWindow ? 15 : 5,
      confidence: isWindow ? 0.6 : 0.3,
      reason: isWindow
        ? 'Santa Claus Rally window (Dec 24–Jan 2) — historical bullish bias'
        : 'Outside Santa Claus Rally window',
    };
  }
}
