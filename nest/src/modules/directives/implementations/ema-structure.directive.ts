/**
 * PLACEHOLDER — implement per SPRINT.md Task 4.
 *
 * Price Above EMA Structure
 * =========================
 * Scores symbols where price > EMA20 > EMA50, indicating a
 * healthy uptrend structure across multiple timeframes.
 *
 * Reference spec: exit-wordpress/03-MVP-DIRECTIVE-PACK.md
 */

import { Injectable, Logger } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class EmaStructureDirective implements IDirective {
  readonly id = 'ema-structure';
  readonly name = 'Price Above EMA Structure';
  readonly description = 'Scores symbols where price sits above EMA20 which sits above EMA50.';
  private readonly logger = new Logger(EmaStructureDirective.name);

  calculate(_input: DirectiveInput): DirectiveResult {
    this.logger.debug('EmaStructureDirective.calculate stub — PLACEHOLDER.');
    return { score: 0, confidence: 0, reason: 'PLACEHOLDER — not yet implemented.' };
  }
}
