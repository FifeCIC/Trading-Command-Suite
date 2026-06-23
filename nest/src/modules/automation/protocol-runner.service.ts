/**
 * ProtocolRunner Service
 * ======================
 * Executes multi-protocol scoring runs. Each run maps a list of symbols
 * to a protocol preset and runs directives → calibration → scoring for
 * each symbol sequentially.
 *
 * CRITICAL: This service MUST NOT make raw provider API calls directly.
 * All provider data requests go through SymbolDataCacheService (Q503).
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DirectivesService } from '../directives/directives.service';
import { CalibrationService } from '../calibration/calibration.service';
import { SymbolDataCacheService } from './symbol-data-cache.service';
import { getPreset, ProtocolPreset } from './protocol-presets';
import type { DirectiveInput, DirectiveResult, MarketBar } from '../directives/interfaces/directive.interface';

// ── Types ──────────────────────────────────────────────────

export interface ProtocolRunConfig {
  name: string;
  protocolId: string;
  symbols: string[];
}

export interface SymbolScoreResult {
  symbol: string;
  score: number;
  maxPossible: number;
  signalClass: 'bullish' | 'bearish' | 'neutral';
  breakdown: {
    directiveId: string;
    name: string;
    score: number;
    maxScore: number;
    confidence: number;
    reason: string;
    signalClass: string;
  }[];
  calibrationsApplied: number;
}

export interface RunResult {
  runId: number;
  protocolId: string;
  protocolName: string;
  symbols: string[];
  results: SymbolScoreResult[];
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
}

// ── Service ────────────────────────────────────────────────

@Injectable()
export class ProtocolRunnerService {
  private readonly logger = new Logger(ProtocolRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly directivesService: DirectivesService,
    private readonly calibrationService: CalibrationService,
    private readonly cache: SymbolDataCacheService,
  ) {}

  /**
   * Execute a full scoring run for a protocol config.
   */
  async executeRun(config: ProtocolRunConfig): Promise<RunResult> {
    const startedAt = new Date();
    const preset = getPreset(config.protocolId);

    if (!preset) {
      throw new Error(`Unknown protocol: ${config.protocolId}`);
    }

    this.logger.log(
      `▶ Starting run "${config.name}" protocol=${config.protocolId} symbols=[${config.symbols.join(',')}]`,
    );

    const results: SymbolScoreResult[] = [];

    for (const symbol of config.symbols) {
      try {
        const result = await this.scoreSymbol(symbol, preset);
        results.push(result);
        this.logger.debug(
          `  ✓ ${symbol}: score=${result.score.toFixed(1)} signal=${result.signalClass}`,
        );
      } catch (err: any) {
        this.logger.error(`  ✗ ${symbol}: ${err.message}`);
        results.push({
          symbol: symbol.toUpperCase(),
          score: 0,
          maxPossible: 0,
          signalClass: 'neutral',
          breakdown: [],
          calibrationsApplied: 0,
        });
      }
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Persist to DB if available
    let runId = 0;
    if (this.prisma.isAvailable) {
      try {
        const record = await this.prisma.protocolRun.create({
          data: {
            name: config.name,
            protocolId: config.protocolId,
            symbols: config.symbols,
            status: 'complete',
            results: results as any,
            runCount: 1,
            lastRunAt: completedAt,
          },
        });
        runId = record.id;
        this.logger.log(`  💾 Saved as ProtocolRun #${runId}`);
      } catch (err: any) {
        this.logger.error(`  Failed to persist results: ${err.message}`);
      }
    }

    this.logger.log(
      `✓ Run complete: ${results.length} symbols in ${durationMs}ms`,
    );

    return {
      runId,
      protocolId: config.protocolId,
      protocolName: preset.name,
      symbols: config.symbols,
      results,
      startedAt,
      completedAt,
      durationMs,
    };
  }

  // ── Private ──────────────────────────────────────────

  /**
   * Score a single symbol against a protocol preset.
   * Only directives in the preset are run; others are skipped.
   */
  private async scoreSymbol(
    symbol: string,
    preset: ProtocolPreset,
  ): Promise<SymbolScoreResult> {
    // Load market bars (via cache layer)
    const bars = await this.loadBars(symbol);

    const input: DirectiveInput = {
      symbol: symbol.toUpperCase(),
      bars,
    };

    // Run ALL directives — then filter to preset's directives
    const allResults = await this.directivesService.runAll(input);

    // Apply calibrations
    const { adjustedScores } =
      this.calibrationService.applyCalibrations(symbol, allResults);

    // Build breakdown for preset directives only
    const breakdown: SymbolScoreResult['breakdown'] = [];
    let totalScore = 0;
    let totalMax = 0;
    let bullishWeight = 0;
    let bearishWeight = 0;

    for (const directiveId of preset.directives) {
      const result = allResults.get(directiveId);
      if (!result) continue;

      const directive = this.directivesService.get(directiveId);
      const maxScore = directive?.maxScore ?? 100;
      const name = directive?.name ?? directiveId;
      const calibratedScore = adjustedScores.get(directiveId) ?? result.score;
      const signalClass = result.signalClass ?? 'neutral';

      if (signalClass === 'bullish') bullishWeight += maxScore;
      else if (signalClass === 'bearish') bearishWeight += maxScore;

      totalScore += calibratedScore;
      totalMax += maxScore;

      breakdown.push({
        directiveId,
        name,
        score: calibratedScore,
        maxScore,
        confidence: result.confidence,
        reason: result.reason,
        signalClass,
      });
    }

    // Determine overall signal class
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (bullishWeight > bearishWeight * 1.5) signalClass = 'bullish';
    else if (bearishWeight > bullishWeight * 1.5) signalClass = 'bearish';

    return {
      symbol: symbol.toUpperCase(),
      score: totalScore,
      maxPossible: totalMax,
      signalClass,
      breakdown,
      calibrationsApplied: adjustedScores.size,
    };
  }

  /**
   * Load market bars for a symbol. Uses the cache layer to avoid
   * duplicate DB queries across concurrent protocol runs.
   */
  private async loadBars(symbol: string): Promise<MarketBar[]> {
    return this.cache.getOrFetch<MarketBar[]>(
      'internal',
      symbol,
      'market-bars',
      async () => {
        if (!this.prisma.isAvailable) return [];

        // Find the symbol ID
        const sym = await this.prisma.symbol.findFirst({
          where: { ticker: symbol.toUpperCase() },
          select: { id: true },
        });

        if (!sym) return [];

        const bars = await this.prisma.marketBar.findMany({
          where: { symbolId: sym.id, timeframe: '1d' },
          orderBy: { timestamp: 'desc' },
          take: 60,
        });

        return bars
          .map((b) => ({
            timestamp: b.timestamp,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
          }))
          .reverse(); // oldest → newest
      },
      10_000, // 10s TTL — market bars don't change within a run
    );
  }
}
