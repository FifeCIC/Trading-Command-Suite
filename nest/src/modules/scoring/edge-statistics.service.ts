/**
 * EdgeStatisticsService — is there measurable EDGE, and is it distinguishable from noise?
 * ========================================================================================
 *
 * WHY THIS EXISTS (2026-09-12)
 * ----------------------------
 * The owner asked the only question that matters: *"is there a flaw in scoring, or does
 * mixing directives together simply not work?"* and set a condition — **no more building
 * unless a change can be shown to affect profitable trading.**
 *
 * That condition cannot be met with the tooling that existed before this file. The
 * pre-existing `OutcomeTrackerService.getAccuracy()` returns a **bare point estimate**
 * (`accuracy: 0.479`). At the sample sizes this project actually has, a point estimate is
 * not evidence: 52.4% bearish vs 40.3% bullish looked like a large asymmetry, but the
 * sample was 18 symbols / 18 directives / **4 days**, and a pooled average actively
 * MISLED — it hid the fact that the two directions behave in opposite ways.
 *
 * So this service answers three questions a point estimate cannot:
 *   1. **How uncertain is this number?**          -> Wilson score interval
 *   2. **Is it different from a coin flip?**      -> one-sided binomial test vs p=0.5
 *   3. **Do the two directions agree?**           -> long/short separated, ALWAYS
 *
 * ⚠️ THE ONE RULE THAT MATTERS: NEVER POOL LONG AND SHORT.
 * Measured 2026-09-12, pooling produced "higher conviction is LESS accurate" (50.2% at
 * score<20 falling to 38.2% at 60-80). Split by direction, bearish was monotonic and
 * bullish was inverted — the pooled number was a blend of a real signal and a regime
 * artefact, and pointed at the wrong conclusion. Any future edit that reintroduces a
 * pooled accuracy headline without the direction split is a regression.
 *
 * ⚠️ WHAT THIS DOES NOT MEASURE — DO NOT PRESENT IT AS PROFIT
 * ---------------------------------------------------------
 * `directionCorrect` is whether price moved the way the signal pointed. It contains
 * **no spread, no slippage, no commission, no position sizing, no stop distance, and no
 * holding period**. A 55% directional hit rate can be a losing strategy and a 45% rate can
 * be a winning one. `pnlEvidence` is reported alongside so the gap stays visible rather
 * than being quietly forgotten.
 *
 * ── Statistics used, and why ─────────────────────────────────────────────
 * **Wilson score interval**, not the normal approximation. The normal interval
 * (`p ± 1.96·sqrt(p(1-p)/n)`) breaks down for small n and near 0/1 and can emit bounds
 * outside [0,1]; Wilson is well-behaved there. With dozens, not thousands, of samples per
 * directive, that difference is the whole point.
 *
 * Significance is a **two-sided exact binomial test** against p=0.5 — the null being "this
 * directive has no directional skill". No normal approximation, because n is small.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { APP_VERSION } from '../../version';

/** Where an interval sits relative to a coin flip. */
export type EvidenceVerdict =
  | 'insufficient'      // too few samples to say anything — the honest default
  | 'no-edge'           // interval straddles 50% — consistent with luck
  | 'possible-edge'     // interval clears 50% but n is still modest
  | 'edge';             // interval clears 50% with a large sample

export interface EdgeEstimate {
  /** Number of matured, direction-resolved samples behind this estimate. */
  n: number;
  /** Point estimate of hit rate, 0-1. */
  hitRate: number;
  /** Wilson score interval, 95%, clamped to [0,1]. */
  ci95: { low: number; high: number };
  /** Two-sided binomial p-value vs p=0.5 (no directional skill). */
  pValue: number;
  /** How far the interval sits above 50% (negative = interval reaches below it). */
  edgeAboveCoinFlip: number;
  verdict: EvidenceVerdict;
}

export interface DirectionalBreakdown {
  bullish: EdgeEstimate | null;
  bearish: EdgeEstimate | null;
  /** ⚠️ Present for completeness ONLY. Never quote this as the headline. */
  pooled: EdgeEstimate;
}

export interface DirectiveEdge extends DirectionalBreakdown {
  directiveId: string;
  /** Mean raw score, so the reader can see whether score and accuracy agree. */
  avgScore: number;
}

export interface EdgeReport {
  generatedAt: string;
  appVersion: string;
  /** Filters actually applied, echoed back so a result is never quoted out of context. */
  window: { days: number; symbol: string | null; timeframe: string | null };
  /**
   * ⚠️ Read this before quoting any number below.
   * Sample breadth is the binding constraint on every conclusion in this report.
   */
  sample: {
    maturedRows: number;
    withDirection: number;
    distinctSymbols: number;
    distinctDirectives: number;
    distinctDays: number;
  };
  overall: DirectionalBreakdown;
  byDirective: DirectiveEdge[];
  /** Score-band monotonicity, split by direction — the "does conviction work?" test. */
  scoreBands: Array<{
    band: string;
    bullish: EdgeEstimate | null;
    bearish: EdgeEstimate | null;
  }>;
  /**
   * ⚠️ Directional accuracy is NOT profitability. This block reports what PnL evidence
   * actually exists so the two are never confused.
   */
  pnlEvidence: {
    closedTrades: number;
    withPnl: number;
    note: string;
  };
  /** Human-readable warnings about what this report cannot support. */
  caveats: string[];
}

// ── Minimum samples before a verdict is even offered ─────────────────────
// 30 is a deliberate floor: below it the Wilson interval is so wide the verdict would
// always be 'insufficient', and reporting a point estimate at n=4 invites over-reading.
const MIN_SAMPLES_FOR_VERDICT = 30;
// Above this, a cleared interval is treated as a real edge rather than a hint.
const STRONG_SAMPLE = 300;

const SCORE_BANDS: Array<{ name: string; lo: number; hi: number }> = [
  { name: '<20', lo: -Infinity, hi: 20 },
  { name: '20-40', lo: 20, hi: 40 },
  { name: '40-60', lo: 40, hi: 60 },
  { name: '60-80', lo: 60, hi: 80 },
  { name: '80-100', lo: 80, hi: 100 },
  { name: '>=100', lo: 100, hi: Infinity },
];

@Injectable()
export class EdgeStatisticsService {
  private readonly logger = new Logger(EdgeStatisticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getEdgeReport(params: {
    days?: number;
    symbol?: string;
    timeframe?: string;
  } = {}): Promise<EdgeReport> {
    const days = params.days ?? 30;
    const window = { days, symbol: params.symbol ?? null, timeframe: params.timeframe ?? null };

    if (!this.prisma.isAvailable) {
      return this.emptyReport(window, 'Database unavailable');
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where: any = { predictedAt: { gte: since } };
    if (params.symbol) where.symbol = params.symbol;
    if (params.timeframe) where.timeframe = params.timeframe;

    // Pull only what the statistics need. `matured` counts rows the sweep has processed;
    // `directionCorrect IS NOT NULL` is the subset with a resolved verdict.
    const rows = await this.prisma.directiveOutcome.findMany({
      where,
      select: {
        directiveId: true,
        symbol: true,
        predictedAt: true,
        score: true,
        signalClass: true,
        directionCorrect: true,
        outcomeComputedAt: true,
      },
    });

    const matured = rows.filter((r) => r.outcomeComputedAt !== null);
    const resolved = matured.filter(
      (r) => r.directionCorrect !== null && (r.signalClass === 'bullish' || r.signalClass === 'bearish'),
    );

    // ── Sample breadth. This is the constraint on every verdict below. ──
    const days_ = new Set(matured.map((r) => r.predictedAt.toISOString().slice(0, 10)));
    const sample = {
      maturedRows: matured.length,
      withDirection: resolved.length,
      distinctSymbols: new Set(matured.map((r) => r.symbol)).size,
      distinctDirectives: new Set(matured.map((r) => r.directiveId)).size,
      distinctDays: days_.size,
    };

    // ── Overall, ALWAYS split by direction ──
    const overall: DirectionalBreakdown = {
      bullish: this.estimate(resolved.filter((r) => r.signalClass === 'bullish')),
      bearish: this.estimate(resolved.filter((r) => r.signalClass === 'bearish')),
      pooled: this.estimate(resolved),
    };

    // ── Per directive, split by direction ──
    const byDirectiveMap = new Map<string, typeof resolved>();
    for (const r of resolved) {
      const list = byDirectiveMap.get(r.directiveId) ?? [];
      list.push(r);
      byDirectiveMap.set(r.directiveId, list);
    }
    const byDirective: DirectiveEdge[] = [...byDirectiveMap.entries()]
      .map(([directiveId, list]) => ({
        directiveId,
        avgScore: round(list.reduce((s, r) => s + r.score, 0) / list.length, 2),
        bullish: this.estimate(list.filter((r) => r.signalClass === 'bullish')),
        bearish: this.estimate(list.filter((r) => r.signalClass === 'bearish')),
        pooled: this.estimate(list),
      }))
      // Order by evidence strength, not by point estimate: a 3-sample 100% must not outrank
      // a 900-sample 54%, which is exactly the error a bare sort on hitRate would make.
      .sort((a, b) => this.strength(b) - this.strength(a));

    // ── Does conviction actually track correctness? Split by direction. ──
    const scoreBands = SCORE_BANDS.map((band) => {
      const inBand = resolved.filter((r) => r.score >= band.lo && r.score < band.hi);
      return {
        band: band.name,
        bullish: this.estimate(inBand.filter((r) => r.signalClass === 'bullish')),
        bearish: this.estimate(inBand.filter((r) => r.signalClass === 'bearish')),
      };
    });

    const pnl = await this.pnlEvidence();

    return {
      generatedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      window,
      sample,
      overall,
      byDirective,
      scoreBands,
      pnlEvidence: pnl,
      caveats: this.caveats(sample),
    };
  }

  /**
   * Wilson 95% interval + exact binomial test vs p=0.5.
   *
   * Returns null when there are no samples at all, so a caller can distinguish
   * "no data" from "no edge" — conflating those two is how an empty result gets
   * reported as a finding.
   */
  private estimate(rows: Array<{ directionCorrect: boolean | null }>): EdgeEstimate | null {
    const n = rows.length;
    if (n === 0) return null;
    const k = rows.filter((r) => r.directionCorrect === true).length;
    const p = k / n;
    const { low, high } = wilsonInterval(k, n);
    const pValue = exactBinomialTwoSided(k, n, 0.5);

    return {
      n,
      hitRate: round(p, 4),
      ci95: { low: round(low, 4), high: round(high, 4) },
      pValue: round(pValue, 4),
      edgeAboveCoinFlip: round(low - 0.5, 4),
      verdict: verdictFor(n, low, pValue),
    };
  }

  /** Ranking key: how much evidence, weighted by how far the interval clears 50%. */
  private strength(e: DirectionalBreakdown): number {
    const best = [e.bullish, e.bearish].filter((x): x is EdgeEstimate => x !== null);
    if (best.length === 0) return 0;
    return Math.max(...best.map((x) => x.edgeAboveCoinFlip * Math.sqrt(x.n)));
  }

  private async pnlEvidence(): Promise<EdgeReport['pnlEvidence']> {
    try {
      const closed = await this.prisma.trade.count({ where: { closedAt: { not: null } } });
      // ⚠️ `pnlInvalid: 0` IS REQUIRED — a closed trade can carry `pnl = 0` as a PLACEHOLDER rather
      // than a result (#931, #1003). Measured 2026-09-26: 123 of 264 closed trades are flagged, so
      // `pnl: { not: null }` ALONE reported **254** where only **131** have a computable P&L.
      //
      // This is a second `withPnl` and its sibling `pnl-statistics.service.ts` already filters — the
      // QA entry for that one asserts "`withPnl` counts ONLY valid rows (measured 32, not 114)".
      // Two queries, one predicate, only one of them carrying it is exactly how a number goes wrong
      // in one view and stays right in the other.
      //
      // `closedTrades` is deliberately left UNFILTERED so the gap between "closed" and "has a
      // usable result" stays visible rather than being silently narrowed.
      const withPnl = await this.prisma.trade.count({
        where: { closedAt: { not: null }, pnl: { not: null }, pnlInvalid: 0 },
      });
      return {
        closedTrades: closed,
        withPnl,
        note:
          'Directional hit rate is NOT profitability. It excludes spread, slippage, commission, ' +
          'position sizing, stop distance and holding period. A 55% hit rate can lose money.',
      };
    } catch {
      return {
        closedTrades: 0,
        withPnl: 0,
        note: 'Trade/PnL query unavailable — profitability is NOT measured by this report.',
      };
    }
  }

  /**
   * Explicit statements of what the current sample cannot support. Generated rather than
   * hardcoded so they stay true as data accumulates.
   */
  private caveats(sample: EdgeReport['sample']): string[] {
    const out: string[] = [];
    if (sample.distinctDays < 30) {
      out.push(
        `⚠️ SAMPLE IS ${sample.distinctDays} CALENDAR DAY${sample.distinctDays === 1 ? '' : 'S'}. ` +
          'A window this short captures one market regime; directional results will be biased by ' +
          'whether that regime trended up or down. Do not treat any verdict here as a property of the system.',
      );
    }
    if (sample.distinctDirectives < 20) {
      out.push(
        `⚠️ Only ${sample.distinctDirectives} distinct directive(s) have matured outcomes. ` +
          'Per-directive verdicts at this breadth cannot separate a good directive from a lucky one.',
      );
    }
    out.push(
      'Pooled accuracy mixes long and short. They behave differently (measured 2026-09-12: ' +
        'bearish monotonic with conviction, bullish inverted). Always quote the direction split.',
    );
    out.push(
      'Directional accuracy excludes costs. Use `pnlEvidence` — not this report — to judge profitability.',
    );
    return out;
  }

  private emptyReport(window: EdgeReport['window'], reason: string): EdgeReport {
    return {
      generatedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      window,
      sample: { maturedRows: 0, withDirection: 0, distinctSymbols: 0, distinctDirectives: 0, distinctDays: 0 },
      overall: { bullish: null, bearish: null, pooled: { n: 0, hitRate: 0, ci95: { low: 0, high: 0 }, pValue: 1, edgeAboveCoinFlip: 0, verdict: 'insufficient' } },
      byDirective: [],
      scoreBands: SCORE_BANDS.map((b) => ({ band: b.name, bullish: null, bearish: null })),
      pnlEvidence: { closedTrades: 0, withPnl: 0, note: 'No data.' },
      caveats: [reason],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Statistics helpers — pure functions, exported for direct unit testing.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wilson score interval (95%, z = 1.96).
 *
 * Chosen over the normal approximation because this project works with tens to hundreds
 * of samples, where the normal interval is unreliable and can produce bounds outside
 * [0, 1]. Wilson is also asymmetric near 0 and 1, which is correct — uncertainty about a
 * 95% hit rate is genuinely one-sided.
 */
export function wilsonInterval(k: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    low: clamp01((centre - spread) / denom),
    high: clamp01((centre + spread) / denom),
  };
}

/**
 * Two-sided exact binomial test vs p0 = 0.5.
 *
 * Exact rather than normal-approximated, because n is small. Computed by summing the
 * probability of every outcome at least as extreme as the one observed — the standard
 * two-sided definition, which avoids the asymmetry of naive doubling.
 */
export function exactBinomialTwoSided(k: number, n: number, p0 = 0.5): number {
  if (n === 0) return 1;
  const observed = binomialPmf(k, n, p0);
  let total = 0;
  for (let i = 0; i <= n; i++) {
    const p = binomialPmf(i, n, p0);
    // Tolerance guards against float drift making an exactly-equal term fall out.
    if (p <= observed + 1e-12) total += p;
  }
  return Math.min(1, total);
}

function binomialPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  // Computed in log space: nCk overflows Number for n above ~1000, and a coefficient of
  // Infinity would make the whole test return NaN for large samples.
  const logCoeff = logFactorial(n) - logFactorial(k) - logFactorial(n - k);
  return Math.exp(logCoeff + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

const LOG_FACTORIAL_CACHE: number[] = [0];
function logFactorial(n: number): number {
  if (n <= 1) return 0;
  if (LOG_FACTORIAL_CACHE[n] !== undefined) return LOG_FACTORIAL_CACHE[n];
  let acc = LOG_FACTORIAL_CACHE[LOG_FACTORIAL_CACHE.length - 1];
  for (let i = LOG_FACTORIAL_CACHE.length; i <= n; i++) {
    acc += Math.log(i);
    LOG_FACTORIAL_CACHE[i] = acc;
  }
  return LOG_FACTORIAL_CACHE[n];
}

/**
 * Verdict ladder. `insufficient` is the default below MIN_SAMPLES_FOR_VERDICT so a small
 * sample can never produce a confident-sounding answer.
 */
export function verdictFor(n: number, ciLow: number, pValue: number): EvidenceVerdict {
  if (n < MIN_SAMPLES_FOR_VERDICT) return 'insufficient';
  if (ciLow <= 0.5 || pValue >= 0.05) return 'no-edge';
  return n >= STRONG_SAMPLE ? 'edge' : 'possible-edge';
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
