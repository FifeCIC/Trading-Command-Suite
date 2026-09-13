/**
 * Strategies Service
 * ==================
 * Combines directive scores into weighted strategy aggregate scores.
 * - Canonical weights come from the LIVE directive registry (`GET /api/directives`).
 *   The old docs/CANONICAL-DIRECTIVE-REFERENCE.md (5 MVP directives) was RETIRED
 *   2026-09-13 - it described an MVP the app outgrew (155 directive ids in code).
 * - totalScore = Σ(directive.score × weight / 100), capped 0-100
 * - confidence = weighted average of directive confidences
 */

import { Injectable, Logger } from '@nestjs/common';
import { ModeService } from '../../config/mode.service';
import { DirectiveResult } from '../directives/interfaces/directive.interface';

export interface StrategyDirectiveWeight {
  directiveId: string;
  weight: number; // 0–100, all weights must sum to 100
}

export interface ScoreBreakdownItem {
  directiveId: string;
  name: string;
  rawScore: number;
  weight: number;
  contribution: number; // rawScore * weight / 100
}

export interface StrategyScore {
  strategyId: string;
  strategyName: string;
  symbolId: string;
  totalScore: number; // 0–100, weighted aggregate
  confidence: number; // 0–1, weighted average
  breakdown: ScoreBreakdownItem[];
  timeframe: string;
  guidance: string;
  timestamp: string;
}

/** Canonical directive names for breakdown display */
const DIRECTIVE_NAMES: Record<string, string> = {
  'rsi-oversold': 'RSI Oversold Reversion',
  'macd-crossover': 'MACD Bullish Crossover',
  'ema-structure': 'Price Above EMA Structure',
  'atr-dip': 'ATR Normalized Dip',
  'volume-confirmation': 'Volume Confirmation',
};

@Injectable()
export class StrategiesService {
  private readonly logger = new Logger(StrategiesService.name);

  constructor(private readonly modeService: ModeService) {}

  calculateScore(
    symbolId: string,
    symbolTicker: string,
    directiveResults: Map<string, DirectiveResult>,
    weights: StrategyDirectiveWeight[],
    timeframe: string,
  ): StrategyScore {
    const breakdown: ScoreBreakdownItem[] = [];
    let totalScore = 0;
    let totalConfidence = 0;
    let weightSum = 0;

    for (const { directiveId, weight } of weights) {
      const result = directiveResults.get(directiveId);
      if (!result) {
        this.logger.warn(`Directive '${directiveId}' missing from results for ${symbolTicker} — skipping.`);
        continue;
      }

      const contribution = (result.score * weight) / 100;
      totalScore += contribution;
      totalConfidence += result.confidence * weight;
      weightSum += weight;

      breakdown.push({
        directiveId,
        name: DIRECTIVE_NAMES[directiveId] ?? directiveId,
        rawScore: result.score,
        weight,
        contribution: Number(contribution.toFixed(1)),
      });
    }

    const finalScore = Math.min(100, Math.max(0, Number(totalScore.toFixed(1))));
    const avgConfidence = weightSum > 0 ? Number((totalConfidence / weightSum).toFixed(2)) : 0;

    const guidance = this.buildGuidance(finalScore, timeframe, symbolTicker);

    return {
      strategyId: 'conviction-dip-accumulation',
      strategyName: 'Conviction Dip Accumulation',
      symbolId,
      totalScore: finalScore,
      confidence: avgConfidence,
      breakdown,
      timeframe,
      guidance,
      timestamp: new Date().toISOString(),
    };
  }

  private buildGuidance(score: number, timeframe: string, ticker: string): string {
    if (score >= 60) {
      return `Entry signal for ${ticker} on ${timeframe} timeframe. Score ${score}/100 exceeds entry threshold.`;
    }
    if (score >= 40) {
      return `Watchlist candidate: ${ticker} on ${timeframe}. Score ${score}/100 — monitor for improvement.`;
    }
    if (score >= 25) {
      return `Defensive hold: ${ticker} on ${timeframe}. Score ${score}/100 — no new entries.`;
    }
    return `Active concern: ${ticker} on ${timeframe}. Score ${score}/100 — review position.`;
  }
}
