/**
 * PLACEHOLDER — implement per SPRINT.md Task 5.
 *
 * Strategies Service
 * ==================
 * Combines directive scores into weighted strategy aggregate scores.
 * - Strategy model includes directive weights (must sum to 100%).
 * - calculateScore() aggregates weighted directive scores.
 * - Response includes breakdown per directive.
 *
 * Contract: input is a map of directiveId → DirectiveResult from the directives service.
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
  guidance: string; // e.g. "short-term buy signal"
  timestamp: string;
}

@Injectable()
export class StrategiesService {
  private readonly logger = new Logger(StrategiesService.name);

  constructor(private readonly modeService: ModeService) {}

  /**
   * Aggregate directive results into a strategy score.
   * PLACEHOLDER — returns a stub result.
   */
  calculateScore(
    _symbolId: string,
    _symbolTicker: string,
    _directiveResults: Map<string, DirectiveResult>,
    _weights: StrategyDirectiveWeight[],
    _timeframe: string,
  ): StrategyScore {
    const modeInfo = this.modeService.getModeInfo();
    this.logger.debug('StrategiesService.calculateScore stub — PLACEHOLDER.');

    return {
      strategyId: 'placeholder',
      strategyName: 'PLACEHOLDER Strategy',
      symbolId: _symbolId,
      totalScore: 0,
      confidence: 0,
      breakdown: [],
      timeframe: _timeframe,
      guidance: `Mode: ${modeInfo.mode}. Strategy scoring not yet implemented (PLACEHOLDER).`,
      timestamp: new Date().toISOString(),
    };
  }
}
