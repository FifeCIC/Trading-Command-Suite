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

export interface SymbolScore {
  symbol: string;
  protocol: string;
  composite: number;
  signal: string;
  gated: boolean;
  riskMultiplier: number;
  subScores: { technical: number; sentiment: number; risk: number };
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
  scannedAt: string;
  scanMs: number;
}

/** Map symbols to their best speed trading protocol */
const SYMBOL_PROTOCOL_MAP: Record<string, string> = {
  // Crypto (both XTrend and DB naming)
  BTCUSD: 'btc-scalp-v1',
  'BTC-USD': 'btc-scalp-v1',
  ETHUSD: 'btc-scalp-v1',
  'ETH-USD': 'btc-scalp-v1',
  SOLUSD: 'btc-scalp-v1',
  // Gold & Metals
  XAUUSD: 'xau-speed-v1',
  XAGUSD: 'xau-speed-v1',
  // Oil & Energy
  USOIL: 'oil-speed-v1',
  UKOIL: 'oil-speed-v1',
  NATGAS: 'oil-speed-v1',
  // SPY / SPX
  SPX500: 'spy-speed-v1',
  SPY: 'spy-speed-v1',
  US500: 'spy-speed-v1',
  // QQQ / Nasdaq
  TECH100: 'qqq-speed-v1',
  US100: 'qqq-speed-v1',
  QQQ: 'qqq-speed-v1',
  // VIX
  VIX: 'vix-spike-v1',
  // Forex Majors
  EURUSD: 'forex-session-v1',
  GBPUSD: 'forex-session-v1',
  USDJPY: 'forex-session-v1',
  AUDUSD: 'forex-session-v1',
  USDCHF: 'forex-session-v1',
  NZDUSD: 'forex-session-v1',
  // CAD Sniper — all 5 CAD crosses
  USDCAD: 'cad-sniper-v1',
  EURCAD: 'cad-sniper-v1',
  GBPCAD: 'cad-sniper-v1',
  AUDCAD: 'cad-sniper-v1',
  NZDCAD: 'cad-sniper-v1',
  // Indices
  DJI30: 'dow-speed-v1',
  US30: 'dow-speed-v1',
  UK100: 'ftse-speed-v1',
  JPN225: 'nikkei-speed-v1',
  EUSTX50: 'euro-stoxx-v1',
  CHINA50: 'china-speed-v1',
  // Stocks
  TSLA: 'tsla-speed-v1',
  NVDA: 'momentum-stock-v1',
  MSTR: 'momentum-stock-v1',
  PLTR: 'momentum-stock-v1',
  AVGO: 'momentum-stock-v1',
  COIN: 'momentum-stock-v1',
  MARA: 'momentum-stock-v1',
  RIOT: 'momentum-stock-v1',
  HOOD: 'momentum-stock-v1',
  RKLB: 'momentum-stock-v1',
  ASTS: 'momentum-stock-v1',
  SOFI: 'momentum-stock-v1',
  // Pandemic / Health Crisis
  PFE: 'pandemic-v1',
  MRNA: 'pandemic-v1',
  BNTX: 'pandemic-v1',
  MRK: 'pandemic-v1',
  HOLX: 'pandemic-v1',
  DHR: 'pandemic-v1',
  CVS: 'pandemic-v1',
  UNH: 'pandemic-v1',
  ECL: 'pandemic-v1',
  BAH: 'pandemic-v1',
  EBS: 'pandemic-v1',
  TDOC: 'pandemic-v1',
  CODX: 'pandemic-v1',
  SNGX: 'pandemic-v1',
  // Meme / Crypto
  DOGEUSD: 'doge-speed-v1',
};

/**
 * Resolve protocol for a symbol.
 * Checks static map first, then pattern-matches leverage products (3xxx prefix or known short ETFs).
 */
function getProtocolForSymbol(symbol: string): string {
  if (SYMBOL_PROTOCOL_MAP[symbol]) return SYMBOL_PROTOCOL_MAP[symbol];
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

        const protocol = getProtocolForSymbol(symbol);
        const score = await this.protocolGating.scoreWithGating(
          symbol,
          marketBars as any,
          protocol,
          { dayBars: dayBars ?? undefined, hourBars: hourBars ?? undefined, min15Bars: min15Bars ?? undefined },
        );

        // Apply seasonal affinity from protocol-calendar
        const seasonalMultiplier = this.seasonalAffinity.getMultiplier(protocol);
        const seasonAdjustedComposite = score.composite * seasonalMultiplier;

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
    const scanMs = Date.now() - start;

    this.logger.log(`SpeedScan: ${scored.length} scored, ${skipped.length} skipped in ${scanMs}ms — top: ${topPick} (${scored[0]?.composite?.toFixed(1) ?? 'N/A'})`);

    return {
      scan: scored,
      skipped,
      ranked,
      topPick,
      scannedAt: new Date().toISOString(),
      scanMs,
    };
  }
}
