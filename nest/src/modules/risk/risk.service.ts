/**
 * Risk Management Service
 * =======================
 * Stop loss, take profit, position sizing, and portfolio-level risk controls.
 * Based on patterns from TradePress TRADERCORE_Trading_Bot.
 */

import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from '../notifications/notifications.service';

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

  constructor(private readonly notificationService: NotificationService) {}

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
        // Sizing PREVIEW only — it has no symbol context to measure existing exposure with, so
        // the warning here never sees the open-position term. The authoritative per-SYMBOL gate is
        // canOpenPosition() in assessGlobalRiskLimits(), which receives it (#899).
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
    existingSymbolCapital = 0,
  ): void {
    // #899 — this warning measures the SYMBOL now (existing exposure + this order), the same
    // computation `canOpenPosition` blocks on. Before the fix both readers measured only the
    // incoming order, so "25% per symbol" was really "25% per order" — three bots could put 60%
    // into one instrument while each order passed. The two readers still differ in OUTCOME
    // (warn vs block), but they can no longer differ in ARITHMETIC.
    const allocation =
      portfolioValue > 0 ? (existingSymbolCapital + shares * entryPrice) / portfolioValue : 0;
    if (allocation > risk.maxPerSymbol) {
      this.logger.warn(
        `Allocation ${(allocation * 100).toFixed(1)}% exceeds max per symbol ${(risk.maxPerSymbol * 100)}%` +
          (existingSymbolCapital > 0
            ? ` (${existingSymbolCapital.toFixed(2)} already open on this symbol + ${(shares * entryPrice).toFixed(2)} this order) (#899)`
            : ''),
      );
    }
  }

  // ---- Portfolio-Level Risk ----

  checkDrawdown(peakValue: number, currentValue: number, risk: PortfolioRisk): { inDrawdown: boolean; drawdownPercent: number } {
    const drawdown = peakValue > 0 ? (peakValue - currentValue) / peakValue : 0;
    const inDrawdown = drawdown >= risk.maxDrawdown;

    // Notify if drawdown exceeds warning (12%) or critical (maxDrawdown) levels
    if (drawdown >= 0.12 || inDrawdown) {
      const level = inDrawdown ? 'critical' : 'warning';
      this.notificationService.notifyDrawdown('Portfolio', drawdown * 100, level).catch(err => {
        this.logger.warn(`Drawdown notification failed: ${err.message}`);
      });
    }

    return { inDrawdown, drawdownPercent: drawdown };
  }

  /**
   * canOpenPosition() — the per-SYMBOL allocation gate (#865, corrected for #899).
   *
   * ⚠️ #899 (2026-09-19): `newCapital` alone measures ONE ORDER, not the SYMBOL. The owner's
   * design is one protocol driving several bots on the same symbol (docs/trading-bot-model.md §4)
   * with the explicit constraint "…for the same symbol, but not increasing risk". Measured at
   * `risk.maxPerSymbol = 0.25`: Bot A opens BTC at 20% ✓, Bot B at 20% ✓, Bot C at 20% ✓ — 60%
   * on one instrument, nothing blocked it. Each check individually correct; the SUM unguarded.
   *
   * The gate now answers "will the portfolio be more than maxPerSymbol in this symbol AFTER this
   * order?" by taking `existingSymbolCapital` — the caller measures already-open positions on the
   * same symbol through the same margin estimator as the incoming order
   * (assessGlobalRiskLimits, trading-strategy.service.ts), so both sides of the sum are
   * comparable. `maxPositions` counts positions, not exposure, and could never cover this.
   */
  canOpenPosition(
    currentPositions: number,
    portfolioValue: number,
    newCapital: number,
    risk: PortfolioRisk,
    existingSymbolCapital = 0,
  ): { allowed: boolean; reason: string } {
    if (currentPositions >= risk.maxPositions) {
      return { allowed: false, reason: `Max positions (${risk.maxPositions}) reached` };
    }
    const totalSymbolCapital = existingSymbolCapital + newCapital;
    const allocation = portfolioValue > 0 ? totalSymbolCapital / portfolioValue : 0;
    if (allocation > risk.maxPerSymbol) {
      // ⚠️ The reason carries BOTH NUMBERS, not just the ratio (2026-09-17, #865).
      //
      // A block reading `Allocation 62.7% exceeds max per symbol 25%` was the largest single entry
      // blocker — 78 in one day — and it took an hour to explain, because nothing in the record said
      // what the estimate WAS or what it was measured against. The reader had to go and instrument
      // the caller to discover that `estimatedCapital` was 11x too high.
      //
      // "`estimated capital 1160.09 of 1340.00`" answers that on sight: the second question
      // ("why is 0.1 of a lot £1,160?") is the defect, and it is now askable from the log alone.
      //
      // #899 adds the existing-exposure term when there is one — otherwise a block at "30%" of a
      // 10% order would be inexplicable from the reason alone.
      return {
        allowed: false,
        reason:
          `Allocation ${(allocation * 100).toFixed(1)}% exceeds max per symbol ` +
          `${(risk.maxPerSymbol * 100)}% — estimated capital ${newCapital.toFixed(2)} of ` +
          `${portfolioValue.toFixed(2)}` +
          (existingSymbolCapital > 0
            ? `, with ${existingSymbolCapital.toFixed(2)} already open on this symbol (#899)`
            : ''),
      };
    }
    return { allowed: true, reason: 'OK' };
  }

  // ── Trailing stop ────────────────────────────────────────────────────────────────────────
  //
  // ⚠️ `updateTrailingStop()` lived here and was DELETED 2026-09-21 (#913). It had ZERO callers —
  // not even its own spec — yet `trailingStopAtProfit` was documented as its input, so the risk
  // register described a trailing stop that no code armed.
  //
  // Post-entry stop management has ONE canonical implementation: `StopGuardianService` (#721),
  // which trails on directive consensus (ATR / SuperTrend / chandelier / wick-filter) against the
  // open positions every pass and records every move in `stop_adjustment` (129 rows at the time of
  // this change). Wiring `trailingStopAtProfit` — if it is ever to be real — belongs THERE, as the
  // guardian's activation threshold. A second trailing implementation is the most expensive kind of
  // technical debt: both copies drift and only one gets the next fix.
}
