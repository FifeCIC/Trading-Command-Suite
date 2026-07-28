import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * Friday Drift Directive
 * Fridays close higher ~58% of the time — positive drift into weekend.
 */
@Injectable()
export class FridayDriftDirective implements IDirective {
  readonly id = 'friday-drift';
  readonly name = 'Friday Drift';
  readonly description = 'Friday bullish bias — closes higher ~58% of the time historically.';
  readonly priority = 25;
  readonly maxScore = 10;
  readonly minBars = { '1d': 5 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 5=Fri

    const isFriday = dayOfWeek === 5;

    return {
      signalClass: isFriday ? 'bullish' : 'neutral',
      score: isFriday ? 8 : 2,
      confidence: isFriday ? 0.5 : 0.3,
      reason: isFriday
        ? 'Friday Drift — historically closes higher 58% of the time'
        : 'Not Friday — no Friday Drift',
    };
  }
}
