/**
 * Multi-Protocol Ranking Service
 * ===============================
 * Cross-protocol scoring and ranking. Runs symbols through all
 * protocol presets and produces normalized comparisons.
 *
 * Key output: "Symbol NVDA scores 82 on momentum, 45 on mean
 *              reversion — best fit is momentum."
 *
 * Score normalization: each protocol has its own maxScore range.
 * Before cross-protocol comparison, scores are normalized to 0-100.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ProtocolRunnerService, SymbolScoreResult } from './protocol-runner.service';
import { PrismaService } from '../../database/prisma.service';
import { PROTOCOL_PRESETS, ProtocolPreset } from './protocol-presets';

// ── Types ──────────────────────────────────────────────────

export interface ProtocolScore {
  protocolId: string;
  protocolName: string;
  score: number; // normalized to 0-100
  rawScore: number; // original score
  maxPossible: number;
  signalClass: string;
  breakdown: SymbolScoreResult['breakdown'];
}

export interface CrossProtocolRanking {
  symbol: string;
  protocolScores: ProtocolScore[];
  bestProtocol: { protocolId: string; protocolName: string; score: number };
  averageScore: number;
  scoreSpread: number; // max - min across protocols
  affinity?: string; // which protocol "owns" this symbol
}

export interface ProtocolSymbolAffinity {
  symbol: string;
  protocolId: string;
  protocolName: string;
  avgNormalizedScore: number;
  runCount: number;
  lastUpdated: Date;
}

// ── Service ────────────────────────────────────────────────

@Injectable()
export class MultiProtocolRankingService {
  private readonly logger = new Logger(MultiProtocolRankingService.name);

  constructor(
    private readonly runner: ProtocolRunnerService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Rank symbols across ALL protocol presets.
   * Runs each protocol for every symbol, normalizes scores,
   * and produces cross-protocol comparisons.
   */
  async rankAcrossProtocols(symbols: string[]): Promise<CrossProtocolRanking[]> {
    const normalized = symbols.map((s) => s.toUpperCase());
    const resultsMap = new Map<string, Map<string, ProtocolScore>>();

    // Initialize map
    for (const symbol of normalized) {
      resultsMap.set(symbol, new Map());
    }

    // Run each protocol for all symbols
    for (const preset of PROTOCOL_PRESETS) {
      this.logger.log(`▶ Running protocol "${preset.name}" for ${normalized.length} symbols`);

      try {
        const runResult = await this.runner.executeRun({
          name: `Cross-Protocol: ${preset.name}`,
          protocolId: preset.id,
          symbols: normalized,
        });

        for (const result of runResult.results) {
          const normalizedScore =
            result.maxPossible > 0
              ? (result.score / result.maxPossible) * 100
              : 0;

          const protocolScore: ProtocolScore = {
            protocolId: preset.id,
            protocolName: preset.name,
            score: Math.round(normalizedScore * 10) / 10,
            rawScore: result.score,
            maxPossible: result.maxPossible,
            signalClass: result.signalClass,
            breakdown: result.breakdown,
          };

          const symbolMap = resultsMap.get(result.symbol);
          if (symbolMap) {
            symbolMap.set(preset.id, protocolScore);
          }
        }
      } catch (err: any) {
        this.logger.error(`✗ Protocol "${preset.name}" failed: ${err.message}`);
        // Add error entries for all symbols
        for (const symbol of normalized) {
          const symbolMap = resultsMap.get(symbol);
          if (symbolMap) {
            symbolMap.set(preset.id, {
              protocolId: preset.id,
              protocolName: preset.name,
              score: 0,
              rawScore: 0,
              maxPossible: 0,
              signalClass: 'neutral',
              breakdown: [],
            });
          }
        }
      }
    }

    // Build cross-protocol rankings
    const rankings: CrossProtocolRanking[] = [];

    for (const [symbol, protocolScores] of resultsMap) {
      const scores = Array.from(protocolScores.values());

      if (scores.length === 0) continue;

      const best = scores.reduce((best, curr) =>
        curr.score > best.score ? curr : best,
      );

      const avg = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
      const max = Math.max(...scores.map((s) => s.score));
      const min = Math.min(...scores.map((s) => s.score));

      rankings.push({
        symbol,
        protocolScores: scores,
        bestProtocol: {
          protocolId: best.protocolId,
          protocolName: best.protocolName,
          score: best.score,
        },
        averageScore: Math.round(avg * 10) / 10,
        scoreSpread: Math.round((max - min) * 10) / 10,
        affinity: best.protocolName,
      });
    }

    // Sort by best protocol score descending
    rankings.sort((a, b) => b.bestProtocol.score - a.bestProtocol.score);

    // Update affinity records in DB
    await this.updateAffinities(rankings);

    this.logger.log(
      `✓ Cross-protocol ranking complete: ${rankings.length} symbols across ${PROTOCOL_PRESETS.length} protocols`,
    );

    return rankings;
  }

  /**
   * Get historical protocol affinity for a symbol.
   * Queries DB for stored affinity data from previous runs.
   */
  async getAffinity(symbol: string): Promise<ProtocolSymbolAffinity | null> {
    if (!this.prisma.isAvailable) return null;

    const record = await this.prisma.symbolProtocolAffinity.findFirst({
      where: { symbol: symbol.toUpperCase() },
      orderBy: { avgNormalizedScore: 'desc' },
    });

    if (!record) return null;

    return {
      symbol: record.symbol,
      protocolId: record.protocolId,
      protocolName: PROTOCOL_PRESETS.find((p) => p.id === record.protocolId)?.name ?? record.protocolId,
      avgNormalizedScore: record.avgNormalizedScore,
      runCount: record.runCount,
      lastUpdated: record.lastUpdated,
    };
  }

  /**
   * Get affinities for all symbols (for dashboard).
   */
  async getAllAffinities(): Promise<ProtocolSymbolAffinity[]> {
    if (!this.prisma.isAvailable) return [];

    const records = await this.prisma.symbolProtocolAffinity.findMany({
      orderBy: { avgNormalizedScore: 'desc' },
      take: 100,
    });

    return records.map((r) => ({
      symbol: r.symbol,
      protocolId: r.protocolId,
      protocolName: PROTOCOL_PRESETS.find((p) => p.id === r.protocolId)?.name ?? r.protocolId,
      avgNormalizedScore: r.avgNormalizedScore,
      runCount: r.runCount,
      lastUpdated: r.lastUpdated,
    }));
  }

  // ── Private ──────────────────────────────────────────

  /**
   * Update SymbolProtocolAffinity records in DB.
   * For each symbol, stores which protocol scored it highest.
   */
  private async updateAffinities(rankings: CrossProtocolRanking[]): Promise<void> {
    if (!this.prisma.isAvailable) return;

    const now = new Date();

    for (const ranking of rankings) {
      try {
        await this.prisma.symbolProtocolAffinity.upsert({
          where: {
            symbol_protocolId: {
              symbol: ranking.symbol,
              protocolId: ranking.bestProtocol.protocolId,
            },
          },
          create: {
            symbol: ranking.symbol,
            protocolId: ranking.bestProtocol.protocolId,
            avgNormalizedScore: ranking.bestProtocol.score,
            runCount: 1,
            lastUpdated: now,
          },
          update: {
            avgNormalizedScore: ranking.bestProtocol.score,
            runCount: { increment: 1 },
            lastUpdated: now,
          },
        });
      } catch (err: any) {
        this.logger.warn(`Failed to update affinity for ${ranking.symbol}: ${err.message}`);
      }
    }
  }
}
