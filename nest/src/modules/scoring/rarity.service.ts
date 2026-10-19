/**
 * RarityService
 * =============
 * Computes percentile-based rarity for SEES composite scores.
 *
 * Tracks historical scores per protocol, classifies current scores into
 * rarity bands, and provides position sizing hints.
 *
 * Rarity Bands (values live in ./rarity-bands — ONE definition, shared with protocol-gating):
 *   ≥ 99th percentile → Black Swan  (never seen before — BASE size only, do not scale up)
 *   ≥ 95th percentile → Cyclical    (multi-year alignment)
 *   ≥ 85th percentile → Exceptional (rare convergence)
 *   ≥ 70th percentile → Strong      (above-average)
 *   < 70th percentile → Standard    (common opportunity)
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  RARITY_BANDS,
  RARITY_MIN_SAMPLES,
  classifyRarityBand,
  rarityPercentile,
  type RarityBand,
  type RarityBandConfig,
} from './rarity-bands';

export type { RarityBand, RarityBandConfig };

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

// RarityBandConfig is re-exported from ./rarity-bands (declared once, there).

// RARITY_BANDS moved to ./rarity-bands — one definition shared with protocol-gating.service.

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

    // Not enough data — return neutral/median. ONE threshold for both rarity paths.
    if (sampleSize < RARITY_MIN_SAMPLES) {
      return this.bandResult('standard', 50, sampleSize);
    }

    // ⚠️ Was a linear scan counting strictly-below only, with a comment claiming it was a
    // binary search. `rarityPercentile` keeps the exclusive rank but makes a score at/above the
    // window maximum read as the 100th percentile — see the note on that function.
    const percentile = rarityPercentile(scores, compositeScore);
    const band = classifyRarityBand(percentile);

    return this.bandResult(band, percentile, sampleSize);
  }

  /**
   * Classify a percentile into a rarity band.
   */
  /** Kept as a method for existing callers; the mapping lives in ./rarity-bands. */
  classifyBand(percentile: number): RarityBand {
    return classifyRarityBand(percentile);
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
    if (scores.length < RARITY_MIN_SAMPLES) return null;

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
