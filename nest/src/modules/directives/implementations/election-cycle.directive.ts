import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * Election Cycle Directive
 * Year 3 of the US presidential cycle is historically the strongest for equities.
 * Cycle: Year 1 (inauguration), Year 2 (midterms), Year 3 (pre-election), Year 4 (election).
 */
@Injectable()
export class ElectionCycleDirective implements IDirective {
  readonly id = 'election-cycle';
  readonly name = 'Presidential Election Cycle';
  readonly description = 'Year 3 of US presidential cycle historically strongest for equities. Year 2 (midterms) weakest.';
  readonly priority = 28;
  readonly maxScore = 8;
  readonly minScore = 1;
  readonly minBars = { '1d': 1 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly category = 'pattern' as const;
  readonly directionBias = 'neutral' as const;

  // US presidential cycle: 2025=Year1, 2026=Year2, 2027=Year3, 2028=Year4
  private static readonly CYCLE_START_YEAR = 2025;
  private static readonly CYCLE_LENGTH = 4;

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const year = now.getUTCFullYear();
    const cycleYear = ((year - ElectionCycleDirective.CYCLE_START_YEAR) % ElectionCycleDirective.CYCLE_LENGTH) + 1;

    switch (cycleYear) {
      case 3: // Pre-election year — historically strongest
        return {
          signalClass: 'bullish',
          score: 8,
          confidence: 0.6,
          reason: `Year ${cycleYear} of presidential cycle — historically strongest year for equities`,
        };
      case 2: // Midterm year — historically weakest
        return {
          signalClass: 'bearish',
          score: 6,
          confidence: 0.55,
          reason: `Year ${cycleYear} of presidential cycle — midterm year, historically weakest`,
        };
      case 1: // Post-election year
        return {
          signalClass: 'neutral',
          score: 4,
          confidence: 0.4,
          reason: `Year ${cycleYear} of presidential cycle — post-election, mixed historical performance`,
        };
      case 4: // Election year
        return {
          signalClass: 'neutral',
          score: 5,
          confidence: 0.45,
          reason: `Year ${cycleYear} of presidential cycle — election year, elevated uncertainty`,
        };
      default:
        return { signalClass: 'neutral', score: 3, confidence: 0.3, reason: 'Election cycle — unknown year' };
    }
  }
}
