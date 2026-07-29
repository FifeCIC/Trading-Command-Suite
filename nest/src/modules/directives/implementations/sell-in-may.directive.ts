import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * Sell in May Directive
 * May–October seasonal weakness — "Sell in May and go away."
 */
@Injectable()
export class SellInMayDirective implements IDirective {
  readonly id = 'sell-in-may';
  readonly name = 'Sell in May';
  readonly description = 'May–October seasonal equity weakness. Historically the worst 6-month stretch for equities.';
  readonly priority = 30;
  readonly maxScore = 15;
  readonly minBars = { '1d': 1 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const month = now.getMonth(); // 4=May, 9=Oct

    const isWindow = month >= 4 && month <= 9;

    return {
      signalClass: isWindow ? 'bearish' : 'neutral',
      score: isWindow ? 12 : 3,
      confidence: isWindow ? 0.55 : 0.3,
      reason: isWindow
        ? 'Sell in May window (May–Oct) — historical seasonal weakness'
        : 'Outside Sell in May window',
    };
  }
}
