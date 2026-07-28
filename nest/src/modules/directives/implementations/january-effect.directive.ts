import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * January Effect Directive
 * January small-cap outperformance — historically strongest month for small-caps.
 */
@Injectable()
export class JanuaryEffectDirective implements IDirective {
  readonly id = 'january-effect';
  readonly name = 'January Effect';
  readonly description = 'January small-cap outperformance bias. Historically the strongest month for small-cap indices.';
  readonly priority = 30;
  readonly maxScore = 15;
  readonly minBars = { '1d': 1 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const month = now.getMonth(); // 0=Jan

    const isJanuary = month === 0;

    return {
      signalClass: isJanuary ? 'bullish' : 'neutral',
      score: isJanuary ? 12 : 3,
      confidence: isJanuary ? 0.55 : 0.3,
      reason: isJanuary
        ? 'January Effect — historical small-cap outperformance'
        : 'Outside January Effect window',
    };
  }
}
