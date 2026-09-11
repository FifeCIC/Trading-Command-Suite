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
import { ProtocolDbService } from '../scoring/protocol-db.service';
import { MarketDataService } from '../market-data/market-data.service';
import { selectBaseTimeframe } from '../../common/utils/timeframe';

// ── Types ──────────────────────────────────────────────────

/**
 * Fallback cadence when a protocol declares no `recommendedTimeframe`.
 *
 * ⚠️ HISTORY — this was the ONLY cadence (#783 follow-up, 2026-09-11). The runner
 * hardcoded `BASE_TIMEFRAME = '1d'` and loaded every protocol's base bars as daily,
 * whatever the protocol actually asked for. The consequences were severe and silent:
 *
 *   `xau-speed-1h` (a 1h protocol) was fed DAILY bars. Its median interval was a day,
 *   so `computeMarketStatus()` correctly reported "last real bar 1105m old" against
 *   the *daily* series — while the symbol's real 1h feed was 26 minutes old and had
 *   been imported two minutes earlier. The card therefore read STALE/PAUSED with a
 *   stale-data reason, and `xau-speed-m15`, `xau-speed-4h` and `xau-speed-1h` all
 *   reported the SAME ~1000m age because they were all reading one identical daily
 *   bar. Every intraday protocol looked permanently stale.
 *
 * The cadence now comes from the protocol's own `recommendedTimeframe` via
 * `selectBaseTimeframe()`, which is the SAME function the Arena, the signal envelope
 * and the automation loop already use. This runner was the lone outlier — do not
 * reintroduce a constant here (INV-CADENCE-COVERAGE).
 */
const FALLBACK_TIMEFRAME = '1d';

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
    private readonly protocolDb: ProtocolDbService,
  ) {}

  /**
   * The cadence a protocol's base bars must be loaded on.
   *
   * Resolution order: protocol's declared `recommendedTimeframe` → `FALLBACK_TIMEFRAME`.
   * `selectBaseTimeframe()` maps the free-text value (`'1h'`, `'5s–30s'`, `'1d (signal),
   * 1h/15m'`, …) onto a cadence that exists in `marketbar`. The SAME result is passed to
   * `scoreWithGating()` as its `timeframe` argument, so the bars and the freshness check
   * can never disagree — a mismatch is what produced the false "market closed" reading
   * on 2026-09-10.
   *
   * ⚠️ Bar COUNT comes from `getRequiredBars()`, not a literal. Directives declare their
   * own `minBars` per timeframe; a fixed 60 starves long-window directives (e.g. a
   * 200-bar daily regime filter would silently evaluate on 60 bars and still return a
   * plausible number — INV-BAR-WINDOW's failure mode).
   */
  private resolveCadence(protocolId: string): { timeframe: string; barCount: number } {
    const declared = this.protocolDb.getCached(protocolId)?.recommendedTimeframe;
    const timeframe = selectBaseTimeframe(declared) || FALLBACK_TIMEFRAME;
    const required = this.protocolDb.getRequiredBars(protocolId);
    const barCount = required[timeframe] ?? required['1d'] ?? 100;
    return { timeframe, barCount };
  }

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
    // Resolve the cadence ONCE per protocol and reuse it for both the bar load and the
    // freshness hint, so the two can never drift apart (#783 follow-up).
    const { timeframe, barCount } = this.resolveCadence(preset.id);
    const bars = await this.loadBars(symbol, timeframe, barCount);
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
    // hard-gated every tick of some protocols (2026-09-10). Now it is the PROTOCOL's
    // cadence, not a hardcoded '1d' (#783 follow-up).
    const gated = await this.protocolGating.scoreWithGating(
      symbol.toUpperCase(),
      bars,
      preset.id,
      { dayBars, hourBars, min15Bars },
      'group-weighted',
      timeframe,
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
   * Load market bars for a symbol at the protocol's own cadence.
   *
   * ⚠️ The cache key includes the TIMEFRAME. It previously did not, because the cadence
   * was a constant and so could not vary. Now that it is per-protocol, omitting it would
   * let a 1d request be served a 1h series from cache — the exact silent-mixed-cadence
   * failure that `INV-SINGLE-CADENCE` exists to prevent, reintroduced through the cache.
   */
  private async loadBars(
    symbol: string,
    timeframe: string,
    barCount: number,
  ): Promise<MarketBar[]> {
    return this.cache.getOrFetch<MarketBar[]>(
      'internal',
      symbol,
      `market-bars:${timeframe}:${barCount}`,
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
        const bars = await this.marketData.getBars(sym.id, timeframe, barCount);

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
