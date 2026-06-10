/**
 * PLACEHOLDER — implement per SPRINT.md Task 4.
 *
 * RSI Oversold Reversion
 * ======================
 * Scores stocks where RSI(14) is below 30 and curling upward,
 * suggesting an oversold bounce is likely.
 *
 * Reference spec: exit-wordpress/03-MVP-DIRECTIVE-PACK.md
 * WordPress test evidence: SEES-FIRST-MINUTE-TEST-RESULT-2026-06-05.md
 */

import { Injectable, Logger } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class RsiOversoldDirective implements IDirective {
  readonly id = 'rsi-oversold';
  readonly name = 'RSI Oversold Reversion';
  readonly description = 'Scores oversold symbols where RSI is below threshold and starting to curl up.';
  private readonly logger = new Logger(RsiOversoldDirective.name);

  // ---- PLACEHOLDER implementation ----
  // Implement calculate() per the directive spec.
  // RSI threshold and lookback should be configurable via constructor params or config service.

  calculate(_input: DirectiveInput): DirectiveResult {
    this.logger.debug('RsiOversoldDirective.calculate stub — PLACEHOLDER.');
    return { score: 0, confidence: 0, reason: 'PLACEHOLDER — not yet implemented.' };
  }
}
