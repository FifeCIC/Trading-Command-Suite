import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * September Slump Directive
 * September is historically the worst month for equities since 1950.
 */
@Injectable()
export class SeptemberSlumpDirective implements IDirective {
  readonly id = 'september-slump';
  readonly name = 'September Slump';
  readonly description = 'September bearish bias — historically the worst month for equities since 1950.';
  readonly priority = 32;
  readonly maxScore = 20;
  readonly minBars = { '1d': 1 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const month = now.getMonth(); // 8=Sep

    const isSeptember = month === 8;

    return {
      signalClass: isSeptember ? 'bearish' : 'neutral',
      score: isSeptember ? 16 : 3,
      confidence: isSeptember ? 0.65 : 0.3,
      reason: isSeptember
        ? 'September Slump — historically worst month for equities since 1950'
        : 'Outside September window',
    };
  }
}
