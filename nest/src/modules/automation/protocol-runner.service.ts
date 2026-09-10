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
import { SymbolDataCacheService } from './symbol-data-cache.service';
import { getPreset, ProtocolPreset } from './protocol-presets';
import type { MarketBar } from '../directives/interfaces/directive.interface';
import { ProtocolGatingService } from '../scoring/protocol-gating.service';
import { MarketDataService } from '../market-data/market-data.service';

// ── Types ──────────────────────────────────────────────────

/**
 * Cadence this runner loads base bars on. Kept as a named constant so the bars
 * and the `timeframe` hint handed to `scoreWithGating` can never disagree — a
 * mismatch would reintroduce the false "market closed" reading (2026-09-10).
 */
const BASE_TIMEFRAME = '1d';

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
    private readonly cache: SymbolDataCacheService,
    private readonly protocolGating: ProtocolGatingService,
    private readonly marketData: MarketDataService,
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
   * Analysis entry point for the canonical scorer (2026-09-08).
   * Do not add aggregation or signal thresholds here.
   */
  private async scoreSymbol(
    symbol: string,
    preset: ProtocolPreset,
  ): Promise<SymbolScoreResult> {
    const bars = await this.loadBars(symbol);
    // Higher-timeframe bundle (1d/1h/15m) MUST be supplied: without it every MTF
    // directive silently evaluates from the base bars only and reports a plausible
    // number that is not the strategy's reading (#735, MST-004).
    const sym = await this.prisma.symbol.findFirst({ where: { ticker: symbol.toUpperCase() } });
    const { dayBars, hourBars, min15Bars } = sym
      ? await this.protocolGating.loadHigherTfBundle(sym.id, preset.id)
      : { dayBars: [], hourBars: [], min15Bars: [] };
    // Pass the cadence the bars were actually loaded on, so a freshness check
    // inside a directive measures staleness against the real interval instead of
    // inferring it — the inference that made fresh data read as closed and
    // hard-gated every tick of some protocols (2026-09-10).
    const gated = await this.protocolGating.scoreWithGating(
      symbol.toUpperCase(),
      bars,
      preset.id,
      { dayBars, hourBars, min15Bars },
      'group-weighted',
      BASE_TIMEFRAME,
    );
    const signalClass: SymbolScoreResult['signalClass'] =
      gated.signal === 'BUY' || gated.signal === 'STRONG_BUY' ? 'bullish' :
      gated.signal === 'SELL' || gated.signal === 'STRONG_SELL' ? 'bearish' : 'neutral';

    return {
      symbol: symbol.toUpperCase(),
      score: gated.signalRaw,
      maxPossible: gated.signalMax,
      signalClass,
      breakdown: Object.values(gated.breakouts).flat().map(d => ({
        directiveId: d.directiveId,
        name: d.name,
        score: d.score,
        maxScore: d.maxScore,
        confidence: d.normalizedScore / 100,
        reason: d.reason,
        signalClass: d.signalClass,
      })),
      calibrationsApplied: 0,
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

        // ⚠️ #754 — was `prisma.marketBar.findMany({ ... take: 60 })` then `.reverse()`. The
        // ordering was already correct, but it is a COPY of the canonical loader: the
        // `timeframe` filter and the ordering had to be re-supplied by hand, and four sites
        // that did this got it wrong (#751, #754). Calls the one loader instead.
        const bars = await this.marketData.getBars(sym.id, BASE_TIMEFRAME, 60);

        return bars.map((b) => ({
          timestamp: b.timestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }));
      },
      10_000, // 10s TTL — market bars don't change within a run
    );
  }
}
