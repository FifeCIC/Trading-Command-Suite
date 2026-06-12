import { Injectable, Logger } from '@nestjs/common';

export interface AveragingPolicy {
  enabled: boolean;
  maxPositions: number;
  maxAllocationPerSymbol: number;
  maxTotalAllocated: number;
  averagingConditions: {
    priceDropFromEntry: number;
    convictionMinimum: number;
    supportLevelProximity: number;
    maxAveragingRounds: number;
    cooldownHours: number;
  };
}

export interface Position {
  symbol: string;
  shares: number;
  averageEntry: number;
  currentPrice: number;
  allocation: number; // 0–1 fraction of portfolio
  averagingRounds: number;
  lastAveragedAt: string | null;
}

export interface AveragingResult {
  averagingOpportunity: boolean;
  bonusScore: number;
  reason: string;
}

const DEFAULT_POLICY: AveragingPolicy = {
  enabled: true,
  maxPositions: 5,
  maxAllocationPerSymbol: 0.25,
  maxTotalAllocated: 0.80,
  averagingConditions: {
    priceDropFromEntry: 0.05,
    convictionMinimum: 0.6,
    supportLevelProximity: 0.02,
    maxAveragingRounds: 3,
    cooldownHours: 48,
  },
};

@Injectable()
export class AveragingScorer {
  private readonly logger = new Logger(AveragingScorer.name);
  private policy: AveragingPolicy = { ...DEFAULT_POLICY };

  setPolicy(policy: Partial<AveragingPolicy>) {
    this.policy = { ...DEFAULT_POLICY, ...policy, averagingConditions: { ...DEFAULT_POLICY.averagingConditions, ...(policy.averagingConditions || {}) } };
  }

  getPolicy(): AveragingPolicy {
    return { ...this.policy };
  }

  evaluate(
    position: Position,
    conviction: number,
    supportLevel: number | null,
    totalPortfolioAllocated: number,
  ): AveragingResult {
    if (!this.policy.enabled) {
      return { averagingOpportunity: false, bonusScore: 0, reason: 'Averaging policy is disabled' };
    }

    const c = this.policy.averagingConditions;

    // Check price drop
    const priceDrop = (position.averageEntry - position.currentPrice) / position.averageEntry;
    if (priceDrop < c.priceDropFromEntry) {
      return { averagingOpportunity: false, bonusScore: 0, reason: `Price drop ${(priceDrop * 100).toFixed(1)}% below ${(c.priceDropFromEntry * 100)}% threshold` };
    }

    // Check conviction
    if (conviction < c.convictionMinimum) {
      return { averagingOpportunity: false, bonusScore: 0, reason: `Conviction ${(conviction * 100).toFixed(0)}% below ${(c.convictionMinimum * 100)}% minimum` };
    }

    // Check support proximity
    if (supportLevel !== null) {
      const proximity = Math.abs(position.currentPrice - supportLevel) / supportLevel;
      if (proximity > c.supportLevelProximity) {
        return { averagingOpportunity: false, bonusScore: 0, reason: `Price not near support level (${(proximity * 100).toFixed(1)}% away, threshold ${(c.supportLevelProximity * 100)}%)` };
      }
    }

    // Check averaging rounds
    if (position.averagingRounds >= c.maxAveragingRounds) {
      return { averagingOpportunity: false, bonusScore: 0, reason: `Max averaging rounds (${c.maxAveragingRounds}) reached` };
    }

    // Check cooldown
    if (position.lastAveragedAt) {
      const hoursSince = (Date.now() - new Date(position.lastAveragedAt).getTime()) / (1000 * 60 * 60);
      if (hoursSince < c.cooldownHours) {
        return { averagingOpportunity: false, bonusScore: 0, reason: `Cooldown active (${hoursSince.toFixed(0)}h since last, need ${c.cooldownHours}h)` };
      }
    }

    // Check allocation
    const newAllocation = position.allocation + 0.05; // assume 5% add
    if (newAllocation > this.policy.maxAllocationPerSymbol) {
      return { averagingOpportunity: false, bonusScore: 0, reason: `Would exceed ${(this.policy.maxAllocationPerSymbol * 100)}% allocation per symbol` };
    }
    if (totalPortfolioAllocated + 0.05 > this.policy.maxTotalAllocated) {
      return { averagingOpportunity: false, bonusScore: 0, reason: `Would exceed ${(this.policy.maxTotalAllocated * 100)}% total allocation` };
    }

    this.logger.log(`Averaging opportunity for ${position.symbol}: drop=${(priceDrop*100).toFixed(1)}%, conviction=${(conviction*100).toFixed(0)}%`);
    return {
      averagingOpportunity: true,
      bonusScore: 15,
      reason: `Price ${(priceDrop * 100).toFixed(1)}% below entry at $${position.averageEntry.toFixed(2)}, conviction ${(conviction * 100).toFixed(0)}%, within support range. Averaging round ${position.averagingRounds + 1}/${c.maxAveragingRounds}.`,
    };
  }
}
