import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MarketDataService } from '../market-data/market-data.service';
import { readTrend, TREND_MIN_BARS, type TrendBarLike, type TrendRead } from './trend-read.math';

/**
 * trend-read.service.ts — assembles a trend READING for one symbol and cadence (#1190, experiment).
 *
 * ============================================================================================
 * THIS IS AN OBSERVATION SURFACE, NOT A SIGNAL SOURCE
 * ============================================================================================
 *
 * Owner, 2026-11-03: *"explain to me how other bots and AI trading agents or algorithms determine
 * trend, just like a trader might draw a predicted trend on a chart — is this app doing that and is
 * it even possible?"* … and then: *"yes use the research you just explained to me and do this as an
 * experimental feature."*
 *
 * So this endpoint exists to make the app's own scoring LEGIBLE. A directive returns `score/max`,
 * and a reader has no way to see what that number was looking at. A fitted line, its R², and an
 * invalidation level are things a human can check against a chart — which is the whole point of an
 * experiment.
 *
 * ⚠️ Nothing in the scoring, gating, sizing or execution path may call this. That is not a style
 * preference: a reading that changed what a protocol SCORED would be a maths change, which under the
 * owner's own rule needs a COPIED configuration and a monitored A/B. Treating it as an observation
 * keeps it free to be wrong while we learn what it is worth.
 *
 * ⚠️ `MarketDataService.getBars()` is used deliberately rather than a hand-rolled query: it is the
 * only loader that takes the LAST N bars (`orderBy asc, take N` returns the OLDEST N, which is the
 * INV-BAR-WINDOW defect this repo has fixed more than once).
 */
@Injectable()
export class TrendReadService {
  private readonly logger = new Logger(TrendReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketData: MarketDataService,
  ) {}

  /**
   * Read the trend for `symbol` on `timeframe`.
   *
   * Throws `NotFoundException` when the symbol or the bars are missing — deliberately, because an
   * empty reading rendered as a neutral one is the "absence of information wearing the face of
   * information" failure this repo keeps paying for. The message names what is missing.
   */
  async read(
    symbol: string,
    timeframe: string,
    opts: { bars?: number; horizonBars?: number; pivotLookback?: number } = {},
  ): Promise<{
    symbol: string;
    timeframe: string;
    read: TrendRead;
    /** The bars the reading was taken over, so the chart can draw the same window. */
    series: Array<{ t: string; c: number; h: number; l: number }>;
    /** The fitted line sampled at every bar — the thing a trader would have drawn. */
    fitted: Array<{ t: string; v: number }>;
    /** Regression channel edges at every bar, so the band can be drawn rather than described. */
    band: Array<{ t: string; upper: number; lower: number }>;
    note: string;
  }> {
    const wanted = Math.max(TREND_MIN_BARS, Math.min(2000, Math.floor(opts.bars ?? 200)));
    const ticker = String(symbol ?? '').toUpperCase().trim();
    if (!ticker) throw new NotFoundException('A symbol is required — e.g. `/api/trend/read?symbol=XAUUSD&timeframe=1h`.');

    const sym = await this.prisma.symbol.findUnique({ where: { ticker }, select: { id: true, ticker: true } });
    if (!sym) {
      throw new NotFoundException(
        `Symbol "${ticker}" is not registered. Add it first — a trend reading cannot be taken over a symbol the app does not hold bars for.`,
      );
    }

    const bars = await this.marketData.getBars(sym.id, timeframe, wanted);
    if (!Array.isArray(bars) || bars.length < TREND_MIN_BARS) {
      throw new NotFoundException(
        `Not enough ${timeframe} bars for ${ticker}: found ${bars?.length ?? 0}, need ${TREND_MIN_BARS}. ` +
          'This is a DATA state, not a market reading — run a bar refresh for this symbol/timeframe.',
      );
    }

    const read = readTrend(bars as TrendBarLike[], {
      horizonBars: opts.horizonBars,
      pivotLookback: opts.pivotLookback,
    });
    if (!read) {
      // The maths refused for its own reason (non-finite prices, degenerate fit). Say so rather
      // than returning a neutral reading.
      throw new NotFoundException(
        `The ${timeframe} series for ${ticker} could not be fitted — it contains a non-finite price or no variance. Check the bars.`,
      );
    }

    // Rebuild the per-bar line and band from the fit's coefficients. Cheap, and it keeps the
    // response self-describing: the chart draws exactly what the numbers above describe.
    const { slope, startValue } = read.regression;
    const bandWidth = Math.abs(read.channel.upper - read.channel.middle);
    const fitted: Array<{ t: string; v: number }> = [];
    const series: Array<{ t: string; c: number; h: number; l: number }> = [];
    const band: Array<{ t: string; upper: number; lower: number }> = [];

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const t = b.timestamp instanceof Date ? b.timestamp.toISOString() : String(b.timestamp);
      series.push({ t, c: b.close, h: b.high, l: b.low });
      if (i >= read.regression.startIndex && i <= read.regression.endIndex) {
        const v = startValue + slope * (i - read.regression.startIndex);
        fitted.push({ t, v: Math.round(v * 100000) / 100000 });
        band.push({
          t,
          upper: Math.round((v + bandWidth) * 100000) / 100000,
          lower: Math.round((v - bandWidth) * 100000) / 100000,
        });
      }
    }

    return {
      symbol: ticker,
      timeframe,
      read,
      series,
      fitted,
      band,
      note:
        'An OBSERVATION, not a signal. Nothing in scoring, gating, sizing or execution reads this. ' +
        'A fitted line describes where price HAS been; the projection extends that line and is not a forecast.',
    };
  }

  /** Which symbols have enough bars to be readable on a cadence — so the UI can offer real choices. */
  async readableSymbols(timeframe: string, minimum = TREND_MIN_BARS): Promise<string[]> {
    try {
      const rows: Array<{ ticker: string; n: number }> = await this.prisma.$queryRawUnsafe(
        `SELECT s.ticker AS ticker, COUNT(b.id) AS n
           FROM symbol s
           JOIN marketbar b ON b.symbolId = s.id AND b.timeframe = ?
          GROUP BY s.ticker
         HAVING n >= ?
          ORDER BY s.ticker`,
        timeframe,
        minimum,
      );
      return (rows ?? []).map((r) => String(r.ticker)).filter(Boolean);
    } catch (err) {
      this.logger.warn(`readableSymbols failed for ${timeframe}: ${(err as Error).message}`);
      return [];
    }
  }
}
