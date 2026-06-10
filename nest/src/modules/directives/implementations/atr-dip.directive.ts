/**
 * PLACEHOLDER — implement per SPRINT.md Task 4.
 *
 * ATR Normalized Dip
 * ==================
 * Scores pullback quality using ATR-normalized distance from recent high.
 * Smaller dips relative to ATR suggest healthy consolidation rather than reversal.
 *
 * Reference spec: exit-wordpress/03-MVP-DIRECTIVE-PACK.md
 */

import { Injectable, Logger } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class AtrDipDirective implements IDirective {
  readonly id = 'atr-dip';
  readonly name = 'ATR Normalized Dip';
  readonly description = 'Scores pullback quality using ATR-normalized distance from recent high.';
  private readonly logger = new Logger(AtrDipDirective.name);

  calculate(_input: DirectiveInput): DirectiveResult {
    this.logger.debug('AtrDipDirective.calculate stub — PLACEHOLDER.');
    return { score: 0, confidence: 0, reason: 'PLACEHOLDER — not yet implemented.' };
  }
}
