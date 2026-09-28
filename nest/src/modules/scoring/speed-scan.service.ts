/**
 * SpeedScanService — real-time batch scanner for speed trading symbols.
 *
 * Scores all configured symbols against their best protocol in parallel,
 * ranks by composite score, and returns the top picks.
 *
 * Used by the Speed Trading page's "Best Symbol" panel and Auto-Switch mode.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ProtocolGatingService } from './protocol-gating.service';
import { ProtocolDbService } from './protocol-db.service';
import { MarketDataService } from '../market-data/market-data.service';
import { PrismaService } from '../../database/prisma.service';
import { SeasonalAffinityService } from './seasonal-affinity.service';
import { MicroTrendDetector, TrendAnalysis } from './micro-trend-detector.service';
import type { PatternSignal } from './micro-trend-detector.service';

// ── Lightweight candlestick pattern detection ─────────────────────
// Detects doji, engulfing, hammer, and shooting star patterns from
// a candle series. Passed to MicroTrendDetector.analyze() so the
// Pattern column in Speed Scanner is populated with real data.

function detectCandlestickPatterns(bars: Array<{ open: number; high: number; low: number; close: number }>): PatternSignal[] {
  const patterns: PatternSignal[] = [];
  if (!bars || bars.length < 3) return patterns;

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    const body = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low;
    if (range === 0) continue;

    const bodyRatio = body / range;
    const prevBody = Math.abs(prev.close - prev.open);

    // Doji — body < 10% of range
    if (bodyRatio < 0.1) {
      patterns.push({ type: 'doji', signal: 'neutral', confidence: 0.6, index: i });
    }
    // Hammer — small body at top of candle, long lower wick
    else if (bodyRatio < 0.35 && (curr.close - curr.low) > range * 0.6 && curr.close > curr.open) {
      patterns.push({ type: 'hammer', signal: 'bullish', confidence: 0.7, index: i });
    }
    // Shooting star — small body at bottom, long upper wick
    else if (bodyRatio < 0.35 && (curr.high - curr.close) > range * 0.6 && curr.close < curr.open) {
      patterns.push({ type: 'shooting_star', signal: 'bearish', confidence: 0.7, index: i });
    }
    // Bullish engulfing
    else if (i >= 1 && curr.close > curr.open && prev.close < prev.open &&
             curr.open <= prev.close && curr.close >= prev.open && prevBody > 0) {
      patterns.push({ type: 'bullish_engulfing', signal: 'bullish', confidence: 0.8, index: i });
    }
    // Bearish engulfing
    else if (i >= 1 && curr.close < curr.open && prev.close > prev.open &&
             curr.open >= prev.close && curr.close <= prev.open && prevBody > 0) {
      patterns.push({ type: 'bearish_engulfing', signal: 'bearish', confidence: 0.8, index: i });
    }
  }
  return patterns;
}

export interface SymbolScore {
  symbol: string;
  protocol: string;
  composite: number;
  signal: string;
  gated: boolean;
  riskMultiplier: number;
  subScores: { technical: number; sentiment: number; risk: number };
  trend?: {
    adx: number;
    clarity: string;
    direction: string;
    persistence: number;
    sideways: boolean;
    sidewaysReasons: string[];
    noiseRatio: number;
    patternCount: number;
    patternTypes: string[];
    patternSignal: string;
    recommendation: string;
    recommendationReason: string;
  };
  riskGate?: {
    hardGateTriggered: boolean;
    hardGateReason: string | null;
    warnings: string[];
    riskScore: number;
    multiplierChain: any[];
  } | null;
}

export interface SkippedSymbol {
  symbol: string;
  reason: string;
}

export interface ScanResult {
  scan: SymbolScore[];
  skipped: SkippedSymbol[];
  ranked: string[];
  topPick: string | null;
  topPickTrend: string | null;
  nextBestSymbol: string | null;
  scannedAt: string;
  scanMs: number;
}

/** Map symbols to their best speed trading protocol — DB-first with hardcoded fallback. */
const SYMBOL_PROTOCOL_MAP: Record<string, string> = {
  // Kept as fallback for bootstrap / DB-unavailable scenarios.
  // The DB table symbol_protocol_assignment is the primary source.
  BTCUSD: 'btc-scalp-v1',  'BTC-USD': 'btc-scalp-v1',
  ETHUSD: 'btc-scalp-v1',  'ETH-USD': 'btc-scalp-v1',
  XAUUSD: 'xau-speed-v1',  XAGUSD: 'xau-speed-v1',
  USOIL: 'oil-speed-v1',   UKOIL: 'oil-speed-v1',
  SPX500: 'spy-speed-v1',  SPY: 'spy-speed-v1', US500: 'spy-speed-v1',
  TECH100: 'qqq-speed-v1', QQQ: 'qqq-speed-v1',
  VIX: 'vix-spike-v1',
  EURUSD: 'forex-session-v1', GBPUSD: 'forex-session-v1', USDJPY: 'forex-session-v1',
  AUDUSD: 'forex-session-v1', USDCHF: 'forex-session-v1', NZDUSD: 'forex-session-v1',
  USDCAD: 'usdcad-oil-v1', US30: 'dow-speed-v1', DJI30: 'dow-speed-v1',
  UK100: 'ftse-speed-v1', JPN225: 'nikkei-speed-v1', EUSTX50: 'euro-stoxx-v1',
};

/**
 * Resolve the protocol slug for a symbol — DB-first with hardcoded fallback.
 *
 * IMPORTANT: Uses `include` (not `select`) to join the Protocol table.
 * `select: { protocolId: true }` returns the UUID foreign key, not the
 * human-readable slug. This caused #459 — Speed Scanner showed UUIDs like
 * "42f2ec59-..." instead of "usdcad-oil-v1". Always use `include` with
 * relations when you need fields from the related table, not just the FK.
 *
 * Also returns `active` status so the frontend can filter inactive protocols.
 */
async function resolveProtocolForSymbol(symbol: string, prisma: any): Promise<{ slug: string; active: boolean } | null> {
  // Try DB first — join to Protocol table to get the slug (NOT the UUID) + active status
  try {
    if (prisma.isAvailable) {
      const assignment = await prisma.symbolProtocolAssignment.findFirst({
        where: { symbol },
        orderBy: { priority: 'asc' },
        include: { protocol: { select: { slug: true, active: true } } },
      });
      if (assignment?.protocol?.slug) return { slug: assignment.protocol.slug, active: assignment.protocol.active };
    }
  } catch { /* DB may not have table yet */ }

  // Fall back to hardcoded map — all hardcoded protocols are active by default
  if (SYMBOL_PROTOCOL_MAP[symbol]) return { slug: SYMBOL_PROTOCOL_MAP[symbol], active: true };

  // Pattern-match leverage products
  if (/^3[A-Z]{2,3}$/.test(symbol) || /^[A-Z]{2,3}3$/.test(symbol) ||
      ['TECS','SQQQ','SPXS','SOXS','FNGD','YANG','SRTY'].includes(symbol)) {
    return { slug: 'leverage-v2', active: true };
  }
  return null; // no protocol assigned — unscoped 'default' scoring removed (2026-08-22)
}

/** Default Tier A/B speed trading symbols */
const DEFAULT_SPEED_SYMBOLS = [
  'XAUUSD', 'BTCUSD', 'BTC-USD', 'EURUSD', 'GBPUSD', 'USDJPY',
  'USOIL', 'ETHUSD', 'SPX500', 'TECH100', 'VIX',
  'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF',
  'SPY', 'QQQ', 'TSLA', 'DOGEUSD', 'DJI30', 'UK100', 'JPN225', 'EUSTX50',
];

@Injectable()
export class SpeedScanService {
  private readonly logger = new Logger(SpeedScanService.name);

  constructor(
    private readonly protocolGating: ProtocolGatingService,
    private readonly protocolDb: ProtocolDbService,
    private readonly marketData: MarketDataService,
    private readonly prisma: PrismaService,
    private readonly seasonalAffinity: SeasonalAffinityService,
    private readonly trendDetector: MicroTrendDetector,
  ) {}

  /**
   * Batch-scan all symbols against their best protocol.
   * Returns ranked results sorted by composite score DESC.
   */
  async scan(
    symbols: string[] = DEFAULT_SPEED_SYMBOLS,
    timeframe = '5s',
    /**
     * Base bar count. OMIT IT — `undefined` means "size it from the protocol's own declared
     * requirements". The old default was a literal `20`, which starved every directive that
     * needed more; see the note in the loop below (#1013).
     */
    bars?: number,
  ): Promise<ScanResult> {
    const start = Date.now();
    const results: SymbolScore[] = [];

    // Resolve all symbol IDs in one query
    const upperSymbols = symbols.map(s => s.toUpperCase());
    const dbSymbols = await this.prisma.symbol.findMany({
      where: { ticker: { in: upperSymbols } },
    });
    const symbolMap = new Map(dbSymbols.map(s => [s.ticker, s.id]));

    // Score each symbol
    const scoringPromises = upperSymbols.map(async (symbol) => {
      try {
        const symId: string = symbolMap.get(symbol) as string;
        if (!symId) {
          return { symbol, skipped: true, reason: 'No market data configured' };
        }

        // ⚠️ #1013 — THE PROTOCOL IS RESOLVED BEFORE THE BARS, because the bar COUNT depends on
        // it. This path used to fetch with a literal `bars = 20` (the old default parameter) and
        // a literal `30` for every higher timeframe, whatever the directives declared.
        //
        // MEASURED 2026-09-28: `btc-speed-v1` starved 4 of its 13 directives on 246 of 247 ticks
        // (99.6%) for 24h+, each returning 0 with `Insufficient data: need 72 bars, have 20`,
        // while 3,504 fresh 5m bars sat unused in `marketbar`. `bollinger-band-squeeze` needed 72.
        // Nothing threw — the 0 folded silently into an additive composite, which is why this
        // was found by a guard reading the directive's own recorded reason and not by an error.
        //
        // Bar COUNT comes from `getRequiredBars()`, never a literal — the same rule
        // `ProtocolRunnerService.resolveCadence()` already documents.
        const resolved = await resolveProtocolForSymbol(symbol, this.prisma);
        if (!resolved) {
          return { symbol, skipped: true, reason: 'No protocol assigned — unscoped default scoring removed' };
        }
        const { slug: protocol, active: protocolActive } = resolved;
        const barCount = bars ?? this.protocolDb.getBaseBarCount(protocol, timeframe);

        // Try requested timeframe first, fall back to 1d if insufficient bars.
        // ⚠️ Track which cadence actually won, so the freshness hint below matches the bars
        // really loaded. Passing the REQUESTED timeframe after a 1d fallback would report a
        // 1d series as a short-cadence one and mis-size the staleness window (#783 follow-up).
        let loadedTimeframe = timeframe;
        let marketBars = await this.marketData.getBars(symId, timeframe, barCount);
        if ((!marketBars || marketBars.length < 5) && timeframe !== '1d') {
          marketBars = await this.marketData.getBars(symId, '1d', barCount);
          loadedTimeframe = '1d';
        }
        if (!marketBars || marketBars.length < 5) {
          return { symbol, skipped: true, reason: `Insufficient bars (${timeframe}/1d)` };
        }

        // ⚠️ Higher timeframes sized by the protocol's own declarations too — this was a
        // literal `30` each, which starves any multi-timeframe directive declaring more.
        // `loadHigherTfBundle()` is the canonical loader for exactly this (MST-004).
        const { dayBars, hourBars, min15Bars } = await this.protocolGating.loadHigherTfBundle(
          symId,
          protocol,
        );
        const score = await this.protocolGating.scoreWithGating(
          symbol,
          marketBars as any,
          protocol,
          { dayBars: dayBars ?? undefined, hourBars: hourBars ?? undefined, min15Bars: min15Bars ?? undefined },
          'group-weighted',
          loadedTimeframe,
        );

        // ── Priority-log if protocol has no watchlist assigned ──
        if (this.prisma.isAvailable) {
          try {
            const linked = await (this.prisma as any).scoringStrategy.findFirst({
              where: { protocolId: protocol, watchlistId: { not: null }, enabled: true },
            });
            if (!linked) {
              this.logger.warn(`Protocol "${protocol}" has no watchlist-linked scoring strategy — ${symbol} scored without position awareness`);
            }
          } catch { /* table may not exist */ }
        }

        // Apply seasonal affinity from protocol-calendar
        const seasonalMultiplier = this.seasonalAffinity.getMultiplier(protocol);
        const seasonAdjustedComposite = score.composite * seasonalMultiplier;

        // ── Trend analysis on the market bars ──
        const trendBars = marketBars.map((b: any) => ({
          open: b.open, high: b.high, low: b.low, close: b.close,
        }));
        // Detect candlestick patterns before trend analysis
        const detectedPatterns = detectCandlestickPatterns(trendBars);
        const trendResult = this.trendDetector.analyze(trendBars, detectedPatterns);

        return {
          symbol,
          protocol,
          protocolActive,
          composite: Number(seasonAdjustedComposite.toFixed(1)),
          signal: score.signal,
          gated: score.gatingActive && score.signalPct < 50,
          riskMultiplier: score.riskMultiplier,
          subScores: {
            technical: score.subScores?.technical ?? 50,
            sentiment: score.subScores?.sentiment ?? 50,
            risk: score.subScores?.risk ?? 50,
          },
          trend: {
            adx: trendResult.adx,
            clarity: trendResult.trendClarity,
            direction: trendResult.trendDirection,
            persistence: trendResult.persistence.consecutive,
            sideways: trendResult.sideways.active,
            sidewaysReasons: trendResult.sideways.reasons,
            noiseRatio: Math.round(trendResult.noiseRatio * 100),
            patternCount: trendResult.patternCount,
            patternTypes: trendResult.patternTypes,
            patternSignal: trendResult.patternSignal,
            recommendation: trendResult.recommendation.action,
            recommendationReason: trendResult.recommendation.reason,
          },
          riskGate: score.riskGate ? {
            hardGateTriggered: score.riskGate.hardGateTriggered,
            hardGateReason: score.riskGate.hardGateReason,
            warnings: score.riskGate.warnings,
            riskScore: score.riskGate.riskScore,
            multiplierChain: score.riskGate.multiplierChain,
          } : null,
          skipped: false,
        };
      } catch (err) {
        this.logger.warn(`SpeedScan: ${symbol} failed — ${(err as Error).message}`);
        return { symbol, skipped: true, reason: (err as Error).message };
      }
    });

    const allResults = await Promise.all(scoringPromises);

    const scored: SymbolScore[] = [];
    const skipped: SkippedSymbol[] = [];

    for (const r of allResults) {
      if ('skipped' in r && r.skipped) {
        skipped.push({ symbol: r.symbol, reason: (r as any).reason || 'Unknown' });
      } else {
        scored.push(r as SymbolScore);
      }
    }

    // Sort by composite DESC
    scored.sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0));

    const ranked = scored.map(r => r.symbol);
    const topPick = scored.length > 0 ? scored[0].symbol : null;
    const topPickTrend = scored.length > 0 ? `${scored[0].trend?.clarity ?? '?'} ${scored[0].trend?.direction ?? ''}` : null;
    const nextBestSymbol = scored.length > 1 ? scored[1].symbol : null;
    const scanMs = Date.now() - start;

    this.logger.log(
      `SpeedScan: ${scored.length} scored, ${skipped.length} skipped in ${scanMs}ms — ` +
      `top: ${topPick} (${scored[0]?.composite?.toFixed(1) ?? 'N/A'}, ${topPickTrend})` +
      (nextBestSymbol ? ` | next: ${nextBestSymbol}` : ''),
    );

    return {
      scan: scored,
      skipped,
      ranked,
      topPick,
      topPickTrend,
      nextBestSymbol,
      scannedAt: new Date().toISOString(),
      scanMs,
    };
  }
}
