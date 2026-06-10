/**
 * PLACEHOLDER — implement per SPRINT.md Task 4.
 *
 * Volume Confirmation
 * ===================
 * Scores symbols where recent volume exceeds the moving average,
 * confirming that price moves have market participation behind them.
 *
 * Reference spec: exit-wordpress/03-MVP-DIRECTIVE-PACK.md
 */

import { Injectable, Logger } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class VolumeConfirmationDirective implements IDirective {
  readonly id = 'volume-confirmation';
  readonly name = 'Volume Confirmation';
  readonly description = 'Scores symbols where recent volume exceeds the average.';
  private readonly logger = new Logger(VolumeConfirmationDirective.name);

  calculate(_input: DirectiveInput): DirectiveResult {
    this.logger.debug('VolumeConfirmationDirective.calculate stub — PLACEHOLDER.');
    return { score: 0, confidence: 0, reason: 'PLACEHOLDER — not yet implemented.' };
  }
}
