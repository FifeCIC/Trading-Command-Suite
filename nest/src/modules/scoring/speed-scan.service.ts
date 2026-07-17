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
import { MarketDataService } from '../market-data/market-data.service';
import { PrismaService } from '../../database/prisma.service';
import { SeasonalAffinityService } from './seasonal-affinity.service';
import { MicroTrendDetector, TrendAnalysis } from './micro-trend-detector.service';

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
  USDCAD: 'cad-sniper-v1', US30: 'dow-speed-v1', DJI30: 'dow-speed-v1',
  UK100: 'ftse-speed-v1', JPN225: 'nikkei-speed-v1', EUSTX50: 'euro-stoxx-v1',
};

/**
 * Resolve protocol for a symbol — DB-first with hardcoded fallback.
 * Queries symbol_protocol_assignment table; falls back to static map for bootstrap.
 */
async function resolveProtocolForSymbol(symbol: string, prisma: any): Promise<string> {
  // Try DB first
  try {
    if (prisma.isAvailable) {
      const assignment = await prisma.symbolProtocolAssignment.findFirst({
        where: { symbol },
        orderBy: { priority: 'asc' },
        select: { protocolId: true },
      });
      if (assignment) return assignment.protocolId;
    }
  } catch { /* DB may not have table yet */ }

  // Fall back to hardcoded map
  if (SYMBOL_PROTOCOL_MAP[symbol]) return SYMBOL_PROTOCOL_MAP[symbol];

  // Pattern-match leverage products
  if (/^3[A-Z]{2,3}$/.test(symbol) || /^[A-Z]{2,3}3$/.test(symbol) ||
      ['TECS','SQQQ','SPXS','SOXS','FNGD','YANG','SRTY'].includes(symbol)) {
    return 'leverage-v2';
  }
  return 'default';
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
    bars = 20,
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
        const symId = symbolMap.get(symbol);
        if (!symId) {
          return { symbol, skipped: true, reason: 'No market data configured' };
        }

        // Try requested timeframe first, fall back to 1d if insufficient bars
        let marketBars = await this.marketData.getBars(symId, timeframe, bars);
        if ((!marketBars || marketBars.length < 5) && timeframe !== '1d') {
          marketBars = await this.marketData.getBars(symId, '1d', bars);
        }
        if (!marketBars || marketBars.length < 5) {
          return { symbol, skipped: true, reason: `Insufficient bars (${timeframe}/1d)` };
        }

        // Load higher timeframe bars for multi-timeframe directives
        const [dayBars, hourBars, min15Bars] = await Promise.all([
          this.marketData.getBars(symId, '1d', 30).catch(() => null),
          this.marketData.getBars(symId, '1h', 30).catch(() => null),
          this.marketData.getBars(symId, '15m', 30).catch(() => null),
        ]);

        const protocol = await resolveProtocolForSymbol(symbol, this.prisma);
        const score = await this.protocolGating.scoreWithGating(
          symbol,
          marketBars as any,
          protocol,
          { dayBars: dayBars ?? undefined, hourBars: hourBars ?? undefined, min15Bars: min15Bars ?? undefined },
        );

        // Apply seasonal affinity from protocol-calendar
        const seasonalMultiplier = this.seasonalAffinity.getMultiplier(protocol);
        const seasonAdjustedComposite = score.composite * seasonalMultiplier;

        // ── Trend analysis on the market bars ──
        const trendBars = marketBars.map((b: any) => ({
          open: b.open, high: b.high, low: b.low, close: b.close,
        }));
        const trendResult = this.trendDetector.analyze(trendBars);

        return {
          symbol,
          protocol,
          composite: Number(seasonAdjustedComposite.toFixed(1)),
          signal: score.signal,
          gated: score.gatingActive && score.composite < 50,
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
