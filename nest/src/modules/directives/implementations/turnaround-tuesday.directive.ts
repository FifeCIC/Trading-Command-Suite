import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * Turnaround Tuesday Directive
 * Tuesday tends to reverse Monday's direction.
 * This is a context-dependent directive — it signals the OPPOSITE of Monday.
 */
@Injectable()
export class TurnaroundTuesdayDirective implements IDirective {
  readonly id = 'turnaround-tuesday';
  readonly name = 'Turnaround Tuesday';
  readonly description = 'Tuesday reversal bias — tends to reverse Monday direction. Bullish after red Monday, bearish after green Monday.';
  readonly priority = 28;
  readonly maxScore = 15;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 2=Tue

    if (dayOfWeek !== 2) {
      return {
        signalClass: 'neutral',
        score: 2,
        confidence: 0.3,
        reason: 'Not Tuesday — Turnaround Tuesday not active',
      };
    }

    // Check Monday's direction from recent bars
    const bars = input.bars || [];
    if (bars.length < 2) {
      return {
        signalClass: 'neutral',
        score: 5,
        confidence: 0.3,
        reason: 'Turnaround Tuesday — insufficient data to determine Monday direction',
      };
    }

    // Look for Monday's close relative to Friday's close
    const recentBar = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];
    const mondayDirection = recentBar.close > prevBar.close ? 'up' : 'down';

    const isReversal = mondayDirection === 'down'; // Bullish reversal after red Monday

    return {
      signalClass: isReversal ? 'bullish' : 'bearish',
      score: isReversal ? 12 : 5,
      confidence: 0.5,
      reason: isReversal
        ? 'Turnaround Tuesday — reversing Monday weakness (historical pattern)'
        : `Turnaround Tuesday — Monday was ${mondayDirection}, less reversal probability`,
    };
  }
}
