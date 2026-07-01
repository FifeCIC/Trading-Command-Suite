/**
 * Portfolio Lab Service
 * =====================
 * Deterministic position classification and restructuring scenario
 * computation. No AI required — runs instantly on every portfolio fetch.
 *
 * Feeds the Portfolio Lab page and provides structured context to
 * the DeepSeek AI for deeper analysis.
 */

import { Injectable, Logger } from '@nestjs/common';

// ── Types ──────────────────────────────────────────────────

export type PositionSignal = 'strong_buy' | 'buy' | 'hold' | 'weak' | 'no_data';
export type Recommendation = 'buy_more' | 'hold' | 'reduce' | 'sell' | 'average_down' | 'evaluate';

export interface PositionClassification {
  symbol: string;
  ticker: string;
  score: number;
  signal: PositionSignal;
  pnlPct: number;
  pnlDollars: number;
  value: number;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  recommendation: Recommendation;
  reasoning: string;
  /** Score band percentile for this protocol (if available) */
  rarityBand?: string;
}

export interface SuggestedAction {
  type: 'sell' | 'buy' | 'average_down' | 'hold';
  symbol: string;
  dollarAmount: number;
  reason: string;
  projectedImpact: string;
}

export interface RestructuringScenario {
  id: string;
  name: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  actions: SuggestedAction[];
  projectedReturn: { min: number; expected: number; max: number };
  projectedTimeframe: string;
  cashAfter: number;
  positionsAfter: number;
}

export interface PortfolioLabResult {
  summary: {
    totalValue: number;
    cash: number;
    totalPnl: number;
    pnlPct: number;
    positionCount: number;
    deadPositions: number;
    strongBuys: number;
    weakPositions: number;
  };
  classifications: PositionClassification[];
  scenarios: RestructuringScenario[];
  /** Context object ready to inject into a DeepSeek system prompt */
  aiContext: {
    portfolioJson: string;
    scoresJson: string;
    classificationsJson: string;
  };
}

// ── Scoring Thresholds ────────────────────────────────────

const STRONG_BUY_THRESHOLD = 800;
const BUY_THRESHOLD = 500;
const HOLD_THRESHOLD = 200;

// ── Service ────────────────────────────────────────────────

@Injectable()
export class PortfolioLabService {
  private readonly logger = new Logger(PortfolioLabService.name);

  /**
   * Full analysis: classify all positions, compute scenarios,
   * and prepare AI context in a single call.
   */
  analyze(args: {
    positions: Array<{
      symbol: string;
      ticker: string;
      quantity: number;
      avgCost: number;
      currentPrice: number;
      value: number;
      pnl: number;
      pnlPct: number;
    }>;
    scores: Array<{
      symbol: string;
      score: number;
      signal: string;
      strength: string;
      dataStatus: string;
    }>;
    cash: number;
  }): PortfolioLabResult {
    const { positions, scores, cash } = args;

    // Build score lookup
    const scoreMap = new Map(scores.map((s) => [s.symbol, s]));

    // Classify each position
    const classifications = positions.map((pos) => {
      const scoreEntry = scoreMap.get(pos.symbol);
      return this.classifyPosition(pos, scoreEntry);
    });

    // Sort: strong buys first, dead positions last
    classifications.sort((a, b) => {
      const order: Record<PositionSignal, number> = {
        strong_buy: 0, buy: 1, hold: 2, weak: 3, no_data: 4,
      };
      return (order[a.signal] ?? 5) - (order[b.signal] ?? 5);
    });

    // Summary stats
    const deadPositions = classifications.filter((c) => c.signal === 'no_data').length;
    const strongBuys = classifications.filter((c) => c.signal === 'strong_buy').length;
    const weakPositions = classifications.filter((c) => c.signal === 'weak' || c.recommendation === 'sell').length;
    const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
    const totalCost = positions.reduce((s, p) => s + p.avgCost * p.quantity, 0);
    const totalValue = positions.reduce((s, p) => s + p.value, 0);

    // Compute scenarios
    const scenarios = this.computeScenarios(classifications, cash);

    // Build AI context
    const aiContext = {
      portfolioJson: JSON.stringify(positions),
      scoresJson: JSON.stringify(scores),
      classificationsJson: JSON.stringify(classifications),
    };

    return {
      summary: {
        totalValue: totalValue + cash,
        cash,
        totalPnl: Math.round(totalPnl * 100) / 100,
        pnlPct: totalCost > 0 ? Math.round((totalPnl / totalCost) * 1000) / 10 : 0,
        positionCount: positions.length,
        deadPositions,
        strongBuys,
        weakPositions,
      },
      classifications,
      scenarios,
      aiContext,
    };
  }

  /**
   * Classify a single position based on its score and P&L.
   */
  private classifyPosition(
    pos: { symbol: string; ticker: string; quantity: number; avgCost: number; currentPrice: number; value: number; pnl: number; pnlPct: number },
    scoreEntry?: { score: number; signal: string; dataStatus: string },
  ): PositionClassification {
    const score = scoreEntry?.score ?? 0;
    const dataStatus = scoreEntry?.dataStatus ?? 'no_data';

    // Determine signal band
    let signal: PositionSignal;
    if (dataStatus === 'no_data' || score === 0) {
      signal = 'no_data';
    } else if (score >= STRONG_BUY_THRESHOLD) {
      signal = 'strong_buy';
    } else if (score >= BUY_THRESHOLD) {
      signal = 'buy';
    } else if (score >= HOLD_THRESHOLD) {
      signal = 'hold';
    } else {
      signal = 'weak';
    }

    // Determine recommendation — the core decision logic
    let recommendation: Recommendation;
    let reasoning: string;

    if (signal === 'no_data') {
      // No market data = can't evaluate. Generally recommend selling
      // unless the loss is very large.
      if (pos.pnlPct < -20) {
        recommendation = 'evaluate';
        reasoning = `No scoring data available, but ${Math.abs(pos.pnlPct).toFixed(0)}% loss is large — manual review recommended before selling`;
      } else {
        recommendation = 'sell';
        reasoning = 'No market data available for scoring — dead capital that could be reallocated to strong signals';
      }
    } else if (signal === 'strong_buy' && pos.pnlPct < -10) {
      // Strong future outlook BUT currently in a loss — prime averaging-down candidate
      recommendation = 'average_down';
      reasoning = `Strong signal (score ${score}) despite ${Math.abs(pos.pnlPct).toFixed(0)}% loss — opportunity to lower cost basis before recovery`;
    } else if (signal === 'strong_buy') {
      recommendation = 'buy_more';
      reasoning = `Strongest signal in portfolio (score ${score}) — high conviction, consider increasing allocation`;
    } else if (signal === 'buy') {
      recommendation = 'hold';
      reasoning = `Solid signal (score ${score}) — maintain position, add on dips if cash available`;
    } else if (signal === 'hold') {
      recommendation = 'hold';
      reasoning = `Moderate signal (score ${score}) — hold current position, no action needed`;
    } else if (signal === 'weak' && pos.pnl < 0 && Math.abs(pos.pnlPct) < 5) {
      // Weak signal, small loss — easy exit
      recommendation = 'sell';
      reasoning = `Weak signal (score ${score}) with small ${Math.abs(pos.pnlPct).toFixed(1)}% loss — low-cost exit to free capital`;
    } else if (signal === 'weak' && pos.pnlPct < -10) {
      // Weak signal, large loss — don't crystallize
      recommendation = 'evaluate';
      reasoning = `Weak signal (score ${score}) but ${Math.abs(pos.pnlPct).toFixed(0)}% loss — selling now crystallizes a large loss; consider waiting for a bounce or averaging if outlook improves`;
    } else {
      recommendation = 'reduce';
      reasoning = `Weak signal (score ${score}) — consider reducing position and reallocating to stronger opportunities`;
    }

    return {
      symbol: pos.symbol,
      ticker: pos.ticker,
      score,
      signal,
      pnlPct: Math.round(pos.pnlPct * 10) / 10,
      pnlDollars: Math.round(pos.pnl * 100) / 100,
      value: Math.round(pos.value * 100) / 100,
      quantity: pos.quantity,
      avgCost: pos.avgCost,
      currentPrice: pos.currentPrice,
      recommendation,
      reasoning,
    };
  }

  /**
   * Generate restructuring scenarios based on position classifications.
   */
  private computeScenarios(
    classifications: PositionClassification[],
    cash: number,
  ): RestructuringScenario[] {
    const scenarios: RestructuringScenario[] = [];

    // ── Scenario 1: Aggressive Growth ──
    const deadPositions = classifications.filter((c) => c.signal === 'no_data' && c.recommendation !== 'evaluate');
    const weakSellable = classifications.filter((c) => c.recommendation === 'sell' && Math.abs(c.pnlPct) <= 5);
    const sellTargetsAggressive = [...deadPositions, ...weakSellable];
    const freedAggressive = sellTargetsAggressive.reduce((s, c) => s + c.value, 0);
    const strongBuys = classifications.filter((c) => c.signal === 'strong_buy').slice(0, 3);

    if (sellTargetsAggressive.length > 0 && strongBuys.length > 0) {
      const totalWeight = strongBuys.reduce((s, c) => s + c.score, 0);
      scenarios.push({
        id: 'aggressive',
        name: 'Aggressive Growth',
        description: `Sell ${sellTargetsAggressive.length} dead/weak positions (~$${freedAggressive.toFixed(0)}) and concentrate into the top ${strongBuys.length} strongest signals.`,
        riskLevel: 'medium',
        actions: [
          ...sellTargetsAggressive.map((c) => ({
            type: 'sell' as const,
            symbol: c.symbol,
            dollarAmount: Math.round(c.value * 100) / 100,
            reason: c.reasoning,
            projectedImpact: `Frees $${c.value.toFixed(2)} for reallocation`,
          })),
          ...strongBuys.map((c) => {
            const alloc = totalWeight > 0 ? (c.score / totalWeight) * freedAggressive : freedAggressive / strongBuys.length;
            return {
              type: 'buy' as const,
              symbol: c.symbol,
              dollarAmount: Math.round(alloc * 100) / 100,
              reason: `Strongest signal (score ${c.score}) — highest conviction allocation`,
              projectedImpact: `Adds ~${Math.round(alloc / c.currentPrice * 100) / 100} shares at current price`,
            };
          }),
        ],
        projectedReturn: { min: -5, expected: 8, max: 20 },
        projectedTimeframe: '2–4 weeks',
        cashAfter: cash,
        positionsAfter: classifications.length - sellTargetsAggressive.length,
      });
    }

    // ── Scenario 2: Balanced Recovery ──
    const sellTargetsBalanced = deadPositions.filter((c) => c.recommendation !== 'evaluate');
    const freedBalanced = sellTargetsBalanced.reduce((s, c) => s + c.value, 0);
    const avgDownCandidates = classifications.filter((c) => c.recommendation === 'average_down');
    const buyTargetsBalanced = classifications.filter((c) => c.signal === 'strong_buy' || c.signal === 'buy').slice(0, 2);

    if (sellTargetsBalanced.length > 0) {
      const actions: SuggestedAction[] = [
        ...sellTargetsBalanced.map((c) => ({
          type: 'sell' as const,
          symbol: c.symbol,
          dollarAmount: Math.round(c.value * 100) / 100,
          reason: c.reasoning,
          projectedImpact: `Frees $${c.value.toFixed(2)}`,
        })),
      ];

      // Split freed capital between averaging down and new buys
      const halfCapital = freedBalanced / 2;

      for (const c of avgDownCandidates.slice(0, 2)) {
        actions.push({
          type: 'average_down' as const,
          symbol: c.symbol,
          dollarAmount: Math.round((halfCapital / Math.max(avgDownCandidates.length, 1)) * 100) / 100,
          reason: `Strong signal despite ${Math.abs(c.pnlPct).toFixed(0)}% loss — lower cost basis for recovery`,
          projectedImpact: `Reduces avg cost, improves break-even point`,
        });
      }

      for (const c of buyTargetsBalanced) {
        actions.push({
          type: 'buy' as const,
          symbol: c.symbol,
          dollarAmount: Math.round((halfCapital / Math.max(buyTargetsBalanced.length, 1)) * 100) / 100,
          reason: `Solid signal (score ${c.score}) — build position`,
          projectedImpact: `New allocation to top-ranked symbol`,
        });
      }

      scenarios.push({
        id: 'balanced',
        name: 'Balanced Recovery',
        description: `Sell ${sellTargetsBalanced.length} dead positions only. Split freed capital: half to average down on strong signals in loss, half to new buys.`,
        riskLevel: 'low',
        actions,
        projectedReturn: { min: -3, expected: 5, max: 15 },
        projectedTimeframe: '3–6 weeks',
        cashAfter: cash,
        positionsAfter: classifications.length - sellTargetsBalanced.length,
      });
    }

    // ── Scenario 3: Conservative Defense ──
    const sellTargetsConservative = classifications.filter(
      (c) => c.signal === 'weak' && c.pnlPct < -10,
    );

    scenarios.push({
      id: 'conservative',
      name: 'Conservative Defense',
      description: 'Sell only deeply underwater weak signals. Hold everything else. Preserve cash. No new buys.',
      riskLevel: 'low',
      actions: sellTargetsConservative.length > 0
        ? sellTargetsConservative.map((c) => ({
            type: 'sell' as const,
            symbol: c.symbol,
            dollarAmount: Math.round(c.value * 100) / 100,
            reason: `Weak signal with ${Math.abs(c.pnlPct).toFixed(0)}% loss — stop the bleeding`,
            projectedImpact: `Preserves remaining capital`,
          }))
        : [{
            type: 'hold' as const,
            symbol: 'ALL',
            dollarAmount: 0,
            reason: 'No positions meet conservative sell criteria — portfolio is healthy',
            projectedImpact: 'No changes needed',
          }],
      projectedReturn: { min: -2, expected: 2, max: 8 },
      projectedTimeframe: '1–3 months',
      cashAfter: cash + sellTargetsConservative.reduce((s, c) => s + c.value, 0),
      positionsAfter: classifications.length - (sellTargetsConservative.length || 0),
    });

    return scenarios;
  }
}
