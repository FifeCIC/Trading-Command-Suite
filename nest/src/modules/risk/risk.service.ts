/**
 * Risk Management Service
 * =======================
 * Stop loss, take profit, position sizing, and portfolio-level risk controls.
 * Based on patterns from TradePress TRADERCORE_Trading_Bot.
 */

import { Injectable, Logger } from '@nestjs/common';

// ---- Interfaces ----

export type StopLossType = 'fixed-pct' | 'atr-multiple' | 'swing-low' | 'time-based';
export type TakeProfitType = 'fixed-pct' | 'risk-reward' | 'multi-target' | 'trailing-atr';
export type PositionSizeType = 'fixed' | 'risk-based' | 'kelly';

export interface RiskProfile {
  stopLoss: { type: StopLossType; value: number };
  takeProfit: { type: TakeProfitType; value: number; targets?: { pct: number; closePct: number }[] };
  positionSizing: { type: PositionSizeType; value: number };
}

export interface PortfolioRisk {
  maxPortfolioRisk: number;     // 0.15 = 15%
  maxPerTradeRisk: number;      // 0.02 = 2%
  maxPerSymbol: number;         // 0.25 = 25%
  maxPositions: number;         // 5
  maxDrawdown: number;          // 0.25 = 25% from peak
  trailingStopAtProfit: number; // Start trailing once in this much profit (0.03 = 3%)
}

export interface PositionSizeResult {
  shares: number;
  capitalRequired: number;
  maxLoss: number;
  sizingMethod: 'fixed' | 'risk-based' | 'kelly';
}

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  // ---- Stop Loss Calculators ----

  calculateStopLoss(
    entryPrice: number,
    type: StopLossType,
    value: number,
    atr?: number,
    swingLow?: number,
  ): number {
    switch (type) {
      case 'fixed-pct':
        return entryPrice * (1 - value);
      case 'atr-multiple':
        return atr ? entryPrice - (atr * value) : entryPrice * 0.95;
      case 'swing-low':
        return swingLow ?? entryPrice * 0.95;
      case 'time-based':
        return entryPrice * 0.95; // fallback
      default:
        return entryPrice * 0.95;
    }
  }

  // ---- Take Profit Calculators ----

  calculateTakeProfit(
    entryPrice: number,
    stopLossPrice: number,
    type: TakeProfitType,
    value: number,
  ): number | { targets: { price: number; closePct: number }[] } {
    const slDistance = (entryPrice - stopLossPrice) / entryPrice;

    switch (type) {
      case 'fixed-pct':
        return entryPrice * (1 + value);
      case 'risk-reward':
        return entryPrice * (1 + slDistance * value); // value = R:R ratio
      case 'multi-target':
        // Default: 50% at 1:1 R:R, 50% at 2:1 R:R
        return {
          targets: [
            { price: entryPrice * (1 + slDistance), closePct: 0.5 },
            { price: entryPrice * (1 + slDistance * 2), closePct: 0.5 },
          ],
        };
      case 'trailing-atr':
        return entryPrice * (1 + slDistance * 2);
      default:
        return entryPrice * 1.10;
    }
  }

  // ---- Position Size Calculators ----

  calculatePositionSize(
    type: PositionSizeType,
    value: number,
    portfolioValue: number,
    entryPrice: number,
    stopLossPrice: number,
    riskProfile: PortfolioRisk,
    winRate?: number,  // for Kelly
    avgWinLossRatio?: number,  // for Kelly
  ): PositionSizeResult {
    const capitalAtRisk = portfolioValue * riskProfile.maxPerTradeRisk;

    switch (type) {
      case 'fixed':
        return {
          shares: Math.floor(value),
          capitalRequired: value * entryPrice,
          maxLoss: Math.abs(entryPrice - stopLossPrice) * value,
          sizingMethod: 'fixed',
        };

      case 'risk-based': {
        const riskPerShare = Math.abs(entryPrice - stopLossPrice);
        const shares = riskPerShare > 0 ? Math.floor(capitalAtRisk / riskPerShare) : 1;
        this.checkMaxAllocation(shares, entryPrice, portfolioValue, riskProfile);
        return {
          shares,
          capitalRequired: shares * entryPrice,
          maxLoss: riskPerShare * shares,
          sizingMethod: 'risk-based',
        };
      }

      case 'kelly': {
        const wr = winRate ?? 0.55;
        const wlr = avgWinLossRatio ?? 1.5;
        const kellyFraction = (wr * wlr - (1 - wr)) / wlr;
        const safeFraction = Math.max(0, Math.min(kellyFraction * 0.5, riskProfile.maxPerSymbol)); // half-Kelly
        const capital = portfolioValue * safeFraction;
        const shares = Math.floor(capital / entryPrice);
        return {
          shares,
          capitalRequired: shares * entryPrice,
          maxLoss: Math.abs(entryPrice - stopLossPrice) * shares,
          sizingMethod: 'kelly',
        };
      }

      default:
        return { shares: 1, capitalRequired: entryPrice, maxLoss: 0, sizingMethod: 'fixed' };
    }
  }

  private checkMaxAllocation(
    shares: number,
    entryPrice: number,
    portfolioValue: number,
    risk: PortfolioRisk,
  ): void {
    const allocation = (shares * entryPrice) / portfolioValue;
    if (allocation > risk.maxPerSymbol) {
      this.logger.warn(`Allocation ${(allocation * 100).toFixed(1)}% exceeds max per symbol ${(risk.maxPerSymbol * 100)}%`);
    }
  }

  // ---- Portfolio-Level Risk ----

  checkDrawdown(peakValue: number, currentValue: number, risk: PortfolioRisk): { inDrawdown: boolean; drawdownPercent: number } {
    const drawdown = peakValue > 0 ? (peakValue - currentValue) / peakValue : 0;
    return {
      inDrawdown: drawdown >= risk.maxDrawdown,
      drawdownPercent: drawdown,
    };
  }

  canOpenPosition(currentPositions: number, portfolioValue: number, newCapital: number, risk: PortfolioRisk): { allowed: boolean; reason: string } {
    if (currentPositions >= risk.maxPositions) {
      return { allowed: false, reason: `Max positions (${risk.maxPositions}) reached` };
    }
    const allocation = portfolioValue > 0 ? newCapital / portfolioValue : 0;
    if (allocation > risk.maxPerSymbol) {
      return { allowed: false, reason: `Allocation ${(allocation * 100).toFixed(1)}% exceeds max per symbol ${(risk.maxPerSymbol * 100)}%` };
    }
    return { allowed: true, reason: 'OK' };
  }

  // ---- Trailing Stop ----

  updateTrailingStop(
    currentStop: number,
    currentPrice: number,
    entryPrice: number,
    trailDistance: number,  // in ATR or percentage
    trailActivated: boolean,
    activationProfit: number,
  ): { newStop: number; activated: boolean } {
    const profit = (currentPrice - entryPrice) / entryPrice;
    if (!trailActivated && profit < activationProfit) {
      return { newStop: currentStop, activated: false };
    }
    const trailed = currentPrice * (1 - trailDistance);
    return { newStop: Math.max(currentStop, trailed), activated: true };
  }
}
