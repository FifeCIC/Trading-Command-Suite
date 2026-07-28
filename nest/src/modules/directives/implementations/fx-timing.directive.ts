/**
 * FX Timing Directive — Placeholder
 * =================================
 * Scores whether the current FX rate is favourable for converting
 * foreign-currency profits back to GBP.
 *
 * Status: PLACEHOLDER — requires FX data infrastructure (Q289).
 * Until FX data is available, this directive returns neutral with low confidence.
 *
 * Logic (when data is available):
 *   IF position is profitable in native currency
 *   AND FX rate is within 5% of predicted favourable swing (next 1-5 days)
 *   AND FX forecast confidence > 60%
 *   THEN emit score suggesting wait
 *
 *   IF FX rate is at local extreme favourable to GBP
 *   THEN emit strong score recommending take-profit
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

@Injectable()
export class FxTimingDirective implements IDirective {
  readonly id = 'fx-timing';
  readonly name = 'FX Timing';
  readonly description =
    'Evaluates whether the current FX rate is favourable for converting foreign-currency profits to GBP. Requires FX data feed (Q289).';
  readonly priority = 65;
  readonly maxScore = 80;
  readonly minBars = { '1d': 1 };
  readonly version = '0.1.0'; // pre-release — needs FX data

  calculate(_input: DirectiveInput): DirectiveResult {
    // PLACEHOLDER — real implementation requires FX rate data from /api/fx/rate/:pair
    return {
      score: 0,
      confidence: 0.05,
      reason:
        'FX Timing directive requires real-time FX data (see Q289 — FX Data Infrastructure). ' +
        'Currently returning neutral — no FX rates available.',
      signalClass: 'neutral',
    };
  }
}
