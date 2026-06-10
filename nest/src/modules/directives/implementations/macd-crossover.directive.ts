/**
 * PLACEHOLDER — implement per SPRINT.md Task 4.
 *
 * MACD Bullish Crossover
 * ======================
 * Scores symbols where the MACD line crosses above the signal line,
 * indicating upward momentum.
 *
 * Reference spec: exit-wordpress/03-MVP-DIRECTIVE-PACK.md
 */

import { Injectable, Logger } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class MacdCrossoverDirective implements IDirective {
  readonly id = 'macd-crossover';
  readonly name = 'MACD Bullish Crossover';
  readonly description = 'Scores symbols where MACD line crosses above the signal line.';
  private readonly logger = new Logger(MacdCrossoverDirective.name);

  calculate(_input: DirectiveInput): DirectiveResult {
    this.logger.debug('MacdCrossoverDirective.calculate stub — PLACEHOLDER.');
    return { score: 0, confidence: 0, reason: 'PLACEHOLDER — not yet implemented.' };
  }
}
