import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * Monday Effect Directive
 * Mondays are statistically the worst day of the week for equities.
 */
@Injectable()
export class MondayEffectDirective implements IDirective {
  readonly id = 'monday-effect';
  readonly name = 'Monday Effect';
  readonly description = 'Monday bearish bias — statistically the worst day of the week for equities.';
  readonly priority = 25;
  readonly maxScore = 10;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 1=Mon

    const isMonday = dayOfWeek === 1;

    return {
      signalClass: isMonday ? 'bearish' : 'neutral',
      score: isMonday ? 8 : 2,
      confidence: isMonday ? 0.5 : 0.3,
      reason: isMonday
        ? 'Monday Effect — historically red Mondays'
        : 'Not Monday — no Monday Effect',
    };
  }
}
