/**
 * Trading Execution Gates
 * =======================
 * Boundary layer between scoring and actual trade decisions.
 * Based on TradePress trading-tabs.php: scoring strategies calculate weighted
 * scores, SEES ranks symbols, trading strategies own execution gates.
 */

import { Injectable, Logger } from '@nestjs/common';

// ---- Interfaces ----

export interface ThresholdConfig {
  minScore: number;           // e.g., 60
  minConfidence: number;      // e.g., 0.6
  minNormalizedScore: number; // e.g., 0.6 (60% of max)
  longThreshold: number;
  shortThreshold: number;
}

export interface ScopeConfig {
  symbolWhitelist: string[];
  symbolBlacklist: string[];
  marketTypes: string[];      // ['stocks', 'crypto', 'forex']
  minPrice: number;           // 5
  minAvgVolume: number;       // 1_000_000
  tradingHours: { start: string; end: string; timezone: string } | null;
}

export interface PositionCheckConfig {
  maxPositions: number;
  cooldownHours: number;
  minHoldingBars: number;
  allowAveraging: boolean;
  closeOppositeSignal: boolean;
}

export interface GateConfig {
  thresholds: ThresholdConfig;
  scope: ScopeConfig;
  positions: PositionCheckConfig;
  enabled: boolean;
}

export interface GateResult {
  passed: boolean;
  blockedBy: string[];
  warnings: string[];
  gates: { threshold: boolean; scope: boolean; position: boolean };
}

export interface Position {
  symbol: string;
  openedAt: string;
  direction: 'long' | 'short';
  barsHeld: number;
}

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  minScore: 60,
  minConfidence: 0.6,
  minNormalizedScore: 0.6,
  longThreshold: 60,
  shortThreshold: 70,
};

const DEFAULT_SCOPE: ScopeConfig = {
  symbolWhitelist: [],
  symbolBlacklist: [],
  marketTypes: ['stocks'],
  minPrice: 5,
  minAvgVolume: 1_000_000,
  tradingHours: { start: '09:30', end: '16:00', timezone: 'America/New_York' },
};

const DEFAULT_POSITIONS: PositionCheckConfig = {
  maxPositions: 5,
  cooldownHours: 48,
  minHoldingBars: 3,
  allowAveraging: true,
  closeOppositeSignal: true,
};

@Injectable()
export class TradingGatesService {
  private readonly logger = new Logger(TradingGatesService.name);
  private config: GateConfig = {
    thresholds: { ...DEFAULT_THRESHOLDS },
    scope: { ...DEFAULT_SCOPE },
    positions: { ...DEFAULT_POSITIONS },
    enabled: true,
  };

  /** Gate 1: Hard Thresholds */
  checkThresholds(
    score: number,
    confidence: number,
    signal: 'long' | 'short',
  ): { passed: boolean; reason: string } {
    const t = this.config.thresholds;
    const minScore = signal === 'short' ? t.shortThreshold : t.longThreshold;

    if (score < t.minScore) {
      return { passed: false, reason: `Score ${score} < minimum ${t.minScore}` };
    }
    if (confidence < t.minConfidence) {
      return { passed: false, reason: `Confidence ${(confidence * 100).toFixed(0)}% < minimum ${(t.minConfidence * 100).toFixed(0)}%` };
    }
    if (score < minScore) {
      return { passed: false, reason: `${signal === 'short' ? 'Short' : 'Long'} score ${score} < ${signal} threshold ${minScore}` };
    }
    return { passed: true, reason: 'OK' };
  }

  /** Gate 2: Scope Enforcement */
  checkScope(
    symbol: string,
    price: number,
    avgVolume: number,
    marketType: string,
  ): { passed: boolean; reason: string } {
    const s = this.config.scope;

    if (s.symbolBlacklist.includes(symbol.toUpperCase())) {
      return { passed: false, reason: `${symbol} is blacklisted` };
    }
    if (s.symbolWhitelist.length > 0 && !s.symbolWhitelist.includes(symbol.toUpperCase())) {
      return { passed: false, reason: `${symbol} not in whitelist` };
    }
    if (!s.marketTypes.includes(marketType)) {
      return { passed: false, reason: `Market type '${marketType}' not in allowed: ${s.marketTypes.join(', ')}` };
    }
    if (price < s.minPrice) {
      return { passed: false, reason: `Price $${price} < minimum $${s.minPrice}` };
    }
    if (avgVolume < s.minAvgVolume) {
      return { passed: false, reason: `Avg volume ${avgVolume.toLocaleString()} < minimum ${s.minAvgVolume.toLocaleString()}` };
    }
    if (s.tradingHours) {
      const now = new Date();
      const hour = now.getUTCHours() + (s.tradingHours.timezone === 'America/New_York' ? -4 : 0);
      const startHour = parseInt(s.tradingHours.start);
      const endHour = parseInt(s.tradingHours.end);
      if (hour < startHour || hour >= endHour) {
        return { passed: false, reason: `Outside trading hours (${s.tradingHours.start}-${s.tradingHours.end} ${s.tradingHours.timezone})` };
      }
    }
    return { passed: true, reason: 'OK' };
  }

  /** Gate 3: Position Checks */
  checkPositions(
    symbol: string,
    openPositions: Position[],
    signal: 'long' | 'short',
  ): { passed: boolean; reason: string; closeExisting?: string } {
    const p = this.config.positions;

    // Already at max positions
    if (openPositions.length >= p.maxPositions) {
      return { passed: false, reason: `Max positions (${p.maxPositions}) reached — ${openPositions.length} open` };
    }

    // Check existing position for this symbol
    const existing = openPositions.find(pos => pos.symbol === symbol.toUpperCase());
    if (existing) {
      // Opposite signal — close existing
      if (existing.direction !== signal && p.closeOppositeSignal) {
        return { passed: false, reason: `Opposite signal for ${symbol}`, closeExisting: symbol };
      }

      // Too early to exit
      if (existing.barsHeld < p.minHoldingBars) {
        return { passed: false, reason: `Position held ${existing.barsHeld} bars < minimum ${p.minHoldingBars}` };
      }

      // Already holding — check averaging
      if (p.allowAveraging) {
        return { passed: true, reason: `Already holding ${symbol} — averaging allowed` };
      }
      return { passed: false, reason: `Already holding ${symbol} — averaging disabled` };
    }

    // Cooldown check (simplified — in production check recent trade history)
    return { passed: true, reason: 'OK' };
  }

  /** Run all gates */
  evaluate(
    symbol: string,
    score: number,
    confidence: number,
    price: number,
    avgVolume: number,
    marketType: string,
    signal: 'long' | 'short',
    openPositions: Position[],
  ): GateResult {
    if (!this.config.enabled) {
      return { passed: true, blockedBy: [], warnings: ['Gates disabled'], gates: { threshold: true, scope: true, position: true } };
    }

    const threshold = this.checkThresholds(score, confidence, signal);
    const scope = this.checkScope(symbol.toUpperCase(), price, avgVolume, marketType);
    const position = this.checkPositions(symbol.toUpperCase(), openPositions, signal);

    const blockedBy: string[] = [];
    if (!threshold.passed) blockedBy.push(`Threshold: ${threshold.reason}`);
    if (!scope.passed) blockedBy.push(`Scope: ${scope.reason}`);
    if (!position.passed) blockedBy.push(`Position: ${position.reason}`);

    return {
      passed: blockedBy.length === 0,
      blockedBy,
      warnings: [],
      gates: { threshold: threshold.passed, scope: scope.passed, position: position.passed },
    };
  }

  updateConfig(config: Partial<GateConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): GateConfig {
    return { ...this.config };
  }
}
