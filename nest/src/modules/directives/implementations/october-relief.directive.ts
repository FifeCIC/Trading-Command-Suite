import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * October Relief Directive
 * Mid-to-late October reversal from September selloff.
 */
@Injectable()
export class OctoberReliefDirective implements IDirective {
  readonly id = 'october-relief';
  readonly name = 'October Relief';
  readonly description = 'Mid-to-late October reversal rally — historically strong bounce from September selloff.';
  readonly category = 'pattern' as const;
  readonly priority = 30;
  readonly maxScore = 12;
  readonly minScore = 1;
  readonly minBars = { '1d': 1 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'bullish' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const now = input.asOf ?? new Date();
    const month = now.getMonth(); // 9=Oct
    const day = now.getDate();

    const isWindow = month === 9 && day >= 15;

    return {
      signalClass: isWindow ? 'bullish' : 'neutral',
      score: isWindow ? 12 : 3,
      confidence: isWindow ? 0.55 : 0.3,
      reason: isWindow
        ? 'October Relief — mid-month reversal rally after September selloff'
        : 'Outside October Relief window',
    };
  }
}
