/**
 * DirectivePreviewService — "what would this instrument look like to this directive?" without a run.
 *
 * ── WHY THIS EXISTS (owner direction, 2026-11-01) ────────────────────────────────────────────────
 * *"I want RSIDivergence class and chart with the RSI divergence displayed … I want it so that when a
 * setting is changed the chart refreshes."*
 *
 * The Lab could already answer "what did this protocol SCORE" — but only by running a full backtest,
 * storing it, and reading the score series back. That is the wrong loop for tuning: a `days` run takes
 * tens of seconds and leaves a stored artefact for every experiment, while the question being asked
 * ("what does `swingLookback: 3` see that `5` did not?") needs an answer in a second and does not
 * deserve a row in `backtestrun`.
 *
 * So this endpoint returns the PICTURE rather than the verdict: bars, the indicator series, every pivot
 * the detector found, every divergence pair (all four kinds), and the per-bar score the directive would
 * have produced. Nothing is stored.
 *
 * ── IT DOES NOT RE-IMPLEMENT THE DETECTION ───────────────────────────────────────────────────────
 * Swing search, pair detection and strength all come from `directives/utils/divergence.ts` — the same
 * functions the live directives call. A second copy here would drift, and only one copy would get the
 * next fix. What this service adds is EXPOSURE of options those functions already took (or now take
 * optionally) plus the alignment/plumbing to draw them.
 *
 * ── ⚠️ SCOPE IS STATED PER BODY, NOT ASSUMED ─────────────────────────────────────────────────────
 * The response carries `scope.honouredInScoring` vs `scope.previewOnly`. Several source-indicator knobs
 * (the pivot-gap window, hidden-divergence toggles) are NOT yet read by `rsi-divergence.directive.ts`,
 * so a chart drawn with them is a preview of what the detector COULD see — not of what the current
 * scorer will use. Printing that distinction is the difference between a tool and a misleading one.
 */
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { rsi } from '../directives/utils/indicators';
import { findSwingHighs, findSwingLows, type PivotGap, type StrengthModel } from '../directives/utils/divergence';
import { scanDivergences, scoreSeriesFor, type DivergenceKind, type ScanDivergence } from './divergence-scan';

/** Everything the source indicator (`RSIDivLE`) exposes that changes WHAT IS DETECTED. */
export interface RsiDivergenceParams {
  /** Pine `len`. */
  rsiPeriod: number;
  /** Pine `lbL` — bars left of a pivot that must not undercut it. */
  leftLookback: number;
  /** Pine `lbR` — bars right of a pivot that must not undercut it (also the confirmation delay). */
  rightLookback: number;
  /** Pine `rangeLower` — minimum bars between the two pivots of a pair. */
  minGapBars: number;
  /** Pine `rangeUpper` — maximum bars between the two pivots of a pair. */
  maxGapBars: number;
  /** Pine `plotBull` / `plotHiddenBull` / `plotBear` / `plotHiddenBear`. */
  showRegularBullish: boolean;
  showHiddenBullish: boolean;
  showRegularBearish: boolean;
  showHiddenBearish: boolean;
}

/**
 * Defaults follow the SOURCE indicator, not our directive, and the difference is deliberate:
 * Pine ships `len 9`, our directive ships `rsiPeriod 14`. Showing the source's defaults is what makes a
 * chart comparable to TradingView; the panel labels which values the scorer will actually use.
 */
const DEFAULTS: RsiDivergenceParams = {
  rsiPeriod: 14,
  leftLookback: 1,
  rightLookback: 3,
  minGapBars: 5,
  maxGapBars: 60,
  showRegularBullish: true,
  showHiddenBullish: true,
  showRegularBearish: true,
  showHiddenBearish: false,
};

const MIN_BARS_FOR_ANY_SWING = 10;

/** RSI is bounded 0-100, so its denominator is a constant — the same model `rsi-divergence.directive.ts` declares. */
const STRENGTH_MODEL: StrengthModel = {
  priceWeight: 3,
  indWeight: 2,
  indDenominator: () => 100,
};

export type PreviewDivergence = ScanDivergence;

@Injectable()
export class DirectivePreviewService {
  private readonly logger = new Logger(DirectivePreviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Which parameters the SCORER reads. Anything in the request that is not here is preview-only, and the
   * response says so per key rather than leaving the reader to guess.
   *
   * ⚠️ Keeping this list beside the service (rather than deriving it from the directive's `params`) is a
   * deliberate, temporary asymmetry: deriving it would require importing the directive class, and a
   * preview that cannot be drawn when the directive is mid-edit is worse than one that names what it
   * knows. `GET /api/directives/rsi-divergence/params` remains the authority on what is settable.
   */
  private readonly HONOURED_IN_SCORING = new Set(['rsiPeriod', 'rightLookback']);

  async preview(request: {
    symbol: string;
    timeframe: string;
    days?: number;
    periodId?: string;
    directiveId: string;
    params?: Partial<RsiDivergenceParams>;
  }): Promise<Record<string, unknown>> {
    const directiveId = (request.directiveId ?? '').trim();
    if (directiveId !== 'rsi-divergence') {
      // ⚠️ REFUSES rather than returning an empty chart. A blank chart for an unimplemented directive
      // reads as "this instrument shows no divergence", which is a false negative with no error.
      throw new BadRequestException(
        `No preview implementation for directive "${directiveId || '(missing)'}". `
        + 'This route currently previews `rsi-divergence` only — an unsupported directive must ERROR, '
        + 'never render an empty chart that reads as "nothing detected".',
      );
    }

    const symbol = (request.symbol ?? '').toUpperCase().trim();
    if (!symbol) throw new BadRequestException('symbol is required');

    const params = this.resolveParams(request.params);
    const bars = await this.loadBars(symbol, request.timeframe, request.days, request.periodId);
    if (bars.length < MIN_BARS_FOR_ANY_SWING) {
      throw new BadRequestException(
        `Only ${bars.length} bar(s) available for ${symbol} ${request.timeframe} — at least `
        + `${MIN_BARS_FOR_ANY_SWING} are needed before a pivot can be confirmed.`,
      );
    }

    const closes = bars.map((b) => b.close);
    const lows = bars.map((b) => b.low);
    const highs = bars.map((b) => b.high);

    const rsiSeries = rsi(closes, params.rsiPeriod);
    /**
     * ⚠️ RSI starts at index `rsiPeriod`, so the two series are offset. Every consumer below reads the
     * indicator through this, because a mis-alignment here would put a divergence marker a few bars to
     * the left of the pivot that produced it — plausible output, no error. Same rule the directive uses.
     */
    const rsiOffset = closes.length - rsiSeries.length;
    const getRsi = (barIndex: number): number => {
      const i = barIndex - rsiOffset;
      if (i < 0 || i >= rsiSeries.length) return 50;
      return rsiSeries[i];
    };

    const pivotOpts = { leftLookback: params.leftLookback, rightLookback: params.rightLookback };
    const gap: PivotGap = { min: params.minGapBars, max: params.maxGapBars };

    const swingLows = findSwingLows(lows, params.rightLookback, getRsi, pivotOpts);
    const swingHighs = findSwingHighs(highs, params.rightLookback, getRsi, pivotOpts);

    /**
     * ── EVERY PAIR, NOT JUST THE LAST TWO ────────────────────────────────────────────────────────
     * The directive asks `checkBullishDivergence(swingLows)`, which the canonical helper answers for the
     * FINAL two pivots only — correct for "what would I score on this bar", useless for a chart, where the
     * question is "where did this fire before?". So the same predicates are applied pairwise across the
     * pivot list. The rule is unchanged; only how many pairs it is asked about.
     */
    /**
     * ── EVERY PAIR, NOT JUST THE LAST TWO ────────────────────────────────────────────────────────
     * The scan (pair selection, the warm-up guard, the gap window and the chronological sort) lives in
     * `divergence-scan.ts` so it can be unit-tested without a database — the warm-up bug that produced a
     * divergence out of a placeholder `50` was measured there and is canaried there.
     */
    const divergences = scanDivergences({
      swingLows,
      swingHighs,
      rsiOffset,
      gap,
      select: {
        regularBullish: params.showRegularBullish,
        hiddenBullish: params.showHiddenBullish,
        regularBearish: params.showRegularBearish,
        hiddenBearish: params.showHiddenBearish,
      },
      strengthModel: STRENGTH_MODEL,
      scoreFor: (kind, strength) => this.scoreFor(kind, strength),
      round,
    });

    const scoreSeries = scoreSeriesFor(bars, divergences);

    const byKind = divergences.reduce<Record<string, number>>((acc, d) => {
      acc[d.kind] = (acc[d.kind] ?? 0) + 1;
      return acc;
    }, {});

    return {
      symbol,
      timeframe: request.timeframe,
      directive: { id: 'rsi-divergence', name: 'RSI Divergence Scanner', maxScore: 110 },
      window: { from: bars[0].time, to: bars[bars.length - 1].time, bars: bars.length },
      params,
      /**
       * ⚠️ THE HONESTY FIELD. A reader must be able to tell a knob the SCORER uses from one only this
       * chart uses, because the second kind changes what you SEE without changing what you RUN.
       */
      scope: {
        honouredInScoring: [...this.HONOURED_IN_SCORING],
        previewOnly: Object.keys(params).filter((k) => !this.HONOURED_IN_SCORING.has(k)),
        note:
          'Preview-only parameters change this chart. They are not read by rsi-divergence.directive.ts '
          + 'yet, so a backtest will NOT use them — see the panel for which values will run.',
      },
      bars,
      rsi: bars.map((_, i) => (i < rsiOffset ? null : round(rsiSeries[i - rsiOffset], 2))),
      swings: {
        lows: swingLows.map((s) => ({ index: s.index, price: round(s.price), rsi: round(s.indicatorValue) })),
        highs: swingHighs.map((s) => ({ index: s.index, price: round(s.price), rsi: round(s.indicatorValue) })),
      },
      divergences,
      scoreSeries,
      summary: {
        divergences: divergences.length,
        byKind,
        scoredBars: scoreSeries.filter((s) => s.score > 0).length,
      },
    };
  }

  /** The directive's own score formulas, so the chart and the scorer cannot disagree on the scale. */
  private scoreFor(kind: DivergenceKind, strength: number): number {
    if (kind === 'regular-bullish' || kind === 'hidden-bullish') {
      return Math.round(Math.min(60 + strength * 40, 110));
    }
    return Math.round(Math.max(15 - strength * 12, 0));
  }

  private resolveParams(supplied?: Partial<RsiDivergenceParams>): RsiDivergenceParams {
    const merged = { ...DEFAULTS, ...(supplied ?? {}) };
    const clampInt = (v: unknown, fallback: number, min: number, max: number): number => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.round(n)));
    };
    return {
      rsiPeriod: clampInt(merged.rsiPeriod, DEFAULTS.rsiPeriod, 2, 60),
      leftLookback: clampInt(merged.leftLookback, DEFAULTS.leftLookback, 1, 20),
      rightLookback: clampInt(merged.rightLookback, DEFAULTS.rightLookback, 1, 20),
      minGapBars: clampInt(merged.minGapBars, DEFAULTS.minGapBars, 1, 200),
      // ⚠️ A gap whose max is BELOW its min rejects every pair, which renders an empty chart that reads
      // as "this instrument has no divergence". Refuse the inversion instead of drawing nothing.
      maxGapBars: clampInt(merged.maxGapBars, DEFAULTS.maxGapBars, 2, 500),
      showRegularBullish: Boolean(merged.showRegularBullish),
      showHiddenBullish: Boolean(merged.showHiddenBullish),
      showRegularBearish: Boolean(merged.showRegularBearish),
      showHiddenBearish: Boolean(merged.showHiddenBearish),
    };
  }

  private async loadBars(
    symbol: string,
    timeframe: string,
    days?: number,
    periodId?: string,
  ): Promise<Array<{ time: string; open: number; high: number; low: number; close: number }>> {
    let from: Date | undefined;
    let to: Date | undefined;

    if (periodId) {
      const period = await (this.prisma as any).backtestPeriod.findUnique({ where: { id: periodId } });
      if (!period) throw new NotFoundException(`no stored period "${periodId}"`);
      from = period.from;
      to = period.to;
    }

    const where: Record<string, unknown> = { symbol: { ticker: symbol }, timeframe };
    if (from && to) where.timestamp = { gte: from, lte: to };

    let rows = await this.prisma.marketBar.findMany({
      where,
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, open: true, high: true, low: true, close: true },
    } as any);

    /**
     * ⚠️ A `days` WINDOW IS A DATE RANGE ANCHORED ON THE NEWEST BAR, never the OLDEST N rows (#1132).
     * The old Lab bug was `orderBy asc` + `take`, which measured the beginning of the history while the
     * caller believed they were looking at the latest window. Anchor first, then filter.
     */
    if (!periodId && Number.isFinite(days) && (days as number) > 0) {
      if (rows.length === 0) return [];
      const newest = rows[rows.length - 1].timestamp.getTime();
      const start = newest - (days as number) * 24 * 60 * 60 * 1000;
      rows = rows.filter((r) => r.timestamp.getTime() >= start);
    }

    /**
     * A chart wants a readable number of points. 1,500 bars is enough to see structure and cheap enough
     * that a slider drag can refresh it; the TAIL is kept because the recent end is what is being tuned.
     */
    const MAX_POINTS = 1500;
    if (rows.length > MAX_POINTS) rows = rows.slice(rows.length - MAX_POINTS);

    return rows.map((r) => ({
      time: r.timestamp.toISOString(),
      open: round(r.open),
      high: round(r.high),
      low: round(r.low),
      close: round(r.close),
    }));
  }
}

/** Price/score rounding that never invents precision. A missing value stays missing. */
function round(value: unknown, dp = 5): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** dp;
  return Math.round(n * factor) / factor;
}
