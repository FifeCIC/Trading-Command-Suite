/**
 * RarityService
 * =============
 * Computes percentile-based rarity for SEES composite scores.
 *
 * Tracks historical scores per protocol, classifies current scores into
 * rarity bands, and provides position sizing hints.
 *
 * Rarity Bands:
 *   ≥ 99th percentile → Black Swan  (never seen before — verify data)
 *   ≥ 95th percentile → Cyclical    (multi-year alignment)
 *   ≥ 85th percentile → Exceptional (rare convergence)
 *   ≥ 70th percentile → Strong      (above-average)
 *   < 70th percentile → Standard    (common opportunity)
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export type RarityBand = 'standard' | 'strong' | 'exceptional' | 'cyclical' | 'black-swan';

export interface RarityResult {
  percentile: number;
  band: RarityBand;
  label: string;
  color: string;
  emoji: string;
  description: string;
  sizeMultiplier: number;
  sampleSize: number;
}

export interface RarityBandConfig {
  label: string;
  color: string;
  emoji: string;
  description: string;
  sizeMultiplier: number;
}

export const RARITY_BANDS: Record<RarityBand, RarityBandConfig> = {
  'standard': {
    label: 'Standard',
    color: '#22c55e',
    emoji: '🟢',
    description: 'Common opportunity — trade with base size',
    sizeMultiplier: 1.0,
  },
  'strong': {
    label: 'Strong',
    color: '#3b82f6',
    emoji: '🔵',
    description: 'Above-average convergence — scale up 1.5×',
    sizeMultiplier: 1.5,
  },
  'exceptional': {
    label: 'Exceptional',
    color: '#8b5cf6',
    emoji: '🟣',
    description: 'Rare alignment of directives — scale up 2×',
    sizeMultiplier: 2.0,
  },
  'cyclical': {
    label: 'Cyclical',
    color: '#f59e0b',
    emoji: '🟡',
    description: 'Multi-year event (halving, macro shift) — maximum conviction',
    sizeMultiplier: 2.5,
  },
  'black-swan': {
    label: 'Black Swan',
    color: '#ef4444',
    emoji: '🔴',
    description: 'Never seen before — protocol in uncharted territory. Verify data.',
    sizeMultiplier: 0,
  },
};

const LOOKBACK_DAYS = 365;

@Injectable()
export class RarityService {
  private readonly logger = new Logger(RarityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute rarity percentile for a composite score against historical data.
   */
  async computeRarity(
    protocolId: string,
    compositeScore: number,
  ): Promise<RarityResult> {
    const history = await this.prisma.scoreSnapshot.findMany({
      where: {
        protocolId,
        snappedAt: { gte: new Date(Date.now() - LOOKBACK_DAYS * 86_400_000) },
      },
      select: { composite: true },
      orderBy: { composite: 'asc' },
    });

    const scores = history.map((h) => h.composite);
    const sampleSize = scores.length;

    // Not enough data (< 30 snapshots) — return neutral/median
    if (sampleSize < 30) {
      return this.bandResult('standard', 50, sampleSize);
    }

    // Binary-search find where current score falls
    let countBelow = 0;
    for (const s of scores) {
      if (s < compositeScore) countBelow++;
    }

    const percentile = Math.round((countBelow / sampleSize) * 100);
    const band = this.classifyBand(percentile);

    return this.bandResult(band, percentile, sampleSize);
  }

  /**
   * Classify a percentile into a rarity band.
   */
  classifyBand(percentile: number): RarityBand {
    if (percentile >= 99) return 'black-swan';
    if (percentile >= 95) return 'cyclical';
    if (percentile >= 85) return 'exceptional';
    if (percentile >= 70) return 'strong';
    return 'standard';
  }

  /**
   * Store a score snapshot for future rarity computation.
   */
  async captureSnapshot(
    protocolId: string,
    symbol: string,
    composite: number,
    signal: string,
  ): Promise<void> {
    try {
      await this.prisma.scoreSnapshot.create({
        data: {
          protocolId,
          symbol,
          composite,
          tradingSignal: signal,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Failed to capture score snapshot: ${err.message}`);
    }
  }

  /**
   * Get distribution stats for a protocol (for UI transparency).
   */
  async getDistributionStats(protocolId: string): Promise<{
    sampleSize: number;
    median: number;
    p70: number;
    p85: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
  } | null> {
    const history = await this.prisma.scoreSnapshot.findMany({
      where: {
        protocolId,
        snappedAt: { gte: new Date(Date.now() - LOOKBACK_DAYS * 86_400_000) },
      },
      select: { composite: true },
      orderBy: { composite: 'asc' },
    });

    const scores = history.map((h) => h.composite);
    if (scores.length < 30) return null;

    const n = scores.length;
    return {
      sampleSize: n,
      median: scores[Math.floor(n * 0.5)],
      p70: scores[Math.floor(n * 0.70)],
      p85: scores[Math.floor(n * 0.85)],
      p95: scores[Math.floor(n * 0.95)],
      p99: scores[Math.floor(n * 0.99)],
      min: scores[0],
      max: scores[n - 1],
    };
  }

  // ── Private ──────────────────────────────────────────

  private bandResult(band: RarityBand, percentile: number, sampleSize: number): RarityResult {
    const config = RARITY_BANDS[band];
    return {
      percentile,
      band,
      label: config.label,
      color: config.color,
      emoji: config.emoji,
      description: config.description,
      sizeMultiplier: config.sizeMultiplier,
      sampleSize,
    };
  }
}
