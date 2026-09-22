import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AbTest } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { sanitizeMt5Comment } from '../providers/mt5-comment.util';

/**
 * Symbols allowed in a single A/B test. Default 8 — env-overridable via AB_MAX_SYMBOLS (#929).
 *
 * ⚠️ #929 recorded the capacity decision (2026-09-22): one test × 4 symbols accrued evidence
 * too slowly for A/B to settle any open finding, so the SPEED constraint — not the plumbing —
 * was the binding one. Widened together with the honesty bar below, so more sampling cannot
 * turn into more confident wrong answers.
 */
const MAX_AB_SYMBOLS = (() => {
  const n = Number(process.env.AB_MAX_SYMBOLS);
  return Number.isFinite(n) && n > 0 ? n : 8;
})();

/**
 * Concurrent running tests allowed. Default 2 (#929 capacity decision) — the loop evaluates
 * EVERY active test each tick (`getActiveTests`). Env-overridable via AB_MAX_ACTIVE.
 */
const MAX_AB_ACTIVE = (() => {
  const n = Number(process.env.AB_MAX_ACTIVE);
  return Number.isFinite(n) && n > 0 ? n : 2;
})();

/**
 * Closed trades PER SIDE required before any winner is named. 30 matches the repo's n≥30
 * threshold language (#805's edge controller). Below it the result says `insufficient-data`
 * WITH the current n — refusing to answer is the honest output, not a tie.
 */
const AB_MIN_TRADES_FOR_VERDICT = 30;

/** Side tags used in the broker comment so results can be attributed. */
const SIDE_A_TAG = 'AB-A';
const SIDE_B_TAG = 'AB-B';

/**
 * A/B Test Runner (#482) — run two MetaStack snapshots (control vs variant)
 * side-by-side on the same symbols and compare real trading results.
 *
 * Lifecycle: draft → running → complete (or cancelled).
 * Trades are tagged with `Trade.abTestId` + `brokerComment "TCS AB-A/AB-B {name}"`.
 * Results (PnL, win rate, max drawdown) are computed from the Trade table on stop.
 */
@Injectable()
export class AbTestService {
  private readonly logger = new Logger(AbTestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly tradeRecorder: TradeRecorderService,
  ) {}

  /** Create a draft A/B test. Validates the 1-active / 4-symbol limits. */
  async create(input: {
    name: string;
    controlStackId: string;
    variantStackId: string;
    symbols: string[];
  }): Promise<AbTest> {
    if (!input.name?.trim()) throw new BadRequestException('name is required');
    if (!Array.isArray(input.symbols) || input.symbols.length === 0) {
      throw new BadRequestException('symbols must be a non-empty array');
    }
    const symbols = [...new Set(input.symbols.map((s) => String(s).trim()).filter(Boolean))];
    if (symbols.length > MAX_AB_SYMBOLS) {
      throw new BadRequestException(`A/B test limited to ${MAX_AB_SYMBOLS} symbols (got ${symbols.length})`);
    }
    if (input.controlStackId === input.variantStackId) {
      throw new BadRequestException('controlStackId and variantStackId must differ');
    }

    await this.assertSnapshotsExist(input.controlStackId, input.variantStackId);

    return this.prisma.abTest.create({
      data: {
        name: input.name.trim(),
        controlStackId: input.controlStackId,
        variantStackId: input.variantStackId,
        symbols,
        status: 'draft',
      },
    });
  }

  /** Start a test — enforces the max-1-active rule. */
  async start(id: string): Promise<AbTest> {
    const test = await this.prisma.abTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException(`A/B test ${id} not found`);
    if (test.status === 'running') return test;

    const active = await this.getActiveTests();
    if (active.length >= MAX_AB_ACTIVE && !active.some((t) => t.id === id)) {
      throw new BadRequestException(
        `A/B capacity reached (${active.length}/${MAX_AB_ACTIVE} running: ${active.map((t) => t.name).join(', ')}) — stop one first (#929)`,
      );
    }

    await this.assertSnapshotsExist(test.controlStackId, test.variantStackId);

    this.logger.log(`A/B test "${test.name}" started (${Array.isArray(test.symbols) ? test.symbols.length : 0} symbols)`);
    return this.prisma.abTest.update({
      where: { id },
      data: { status: 'running', startAt: new Date(), endAt: null, results: null },
    });
  }

  /** Stop a test and compute final results. */
  async stop(id: string): Promise<AbTest> {
    const test = await this.prisma.abTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException(`A/B test ${id} not found`);

    const results = await this.computeResults(test);
    this.logger.log(
      `A/B test "${test.name}" stopped — control PnL=${results.control.totalPnl} variant PnL=${results.variant.totalPnl}`,
    );
    return this.prisma.abTest.update({
      where: { id },
      data: { status: 'complete', endAt: new Date(), results },
    });
  }

  /** Cancel a draft/running test without computing results. */
  async cancel(id: string): Promise<AbTest> {
    const test = await this.prisma.abTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException(`A/B test ${id} not found`);
    return this.prisma.abTest.update({ where: { id }, data: { status: 'cancelled' } });
  }

  /** Get a test plus its current results (computed live if running). */
  async getResults(id: string): Promise<{ test: AbTest; results: any }> {
    const test = await this.prisma.abTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException(`A/B test ${id} not found`);
    const results = test.status === 'complete' ? (test.results ?? {}) : await this.computeResults(test);
    return { test, results };
  }

  /** The first running test (null if none). ⚠️ Prefer getActiveTests() — capacity is >1 (#929). */
  async getActiveTest(): Promise<AbTest | null> {
    return this.prisma.abTest.findFirst({ where: { status: 'running' } });
  }

  /** Every running test (capacity: MAX_AB_ACTIVE). The loop evaluates all of them each tick (#929). */
  async getActiveTests(): Promise<AbTest[]> {
    return this.prisma.abTest.findMany({ where: { status: 'running' }, orderBy: { startAt: 'asc' } });
  }

  /** List recent A/B tests (newest first). */
  async list(limit = 25): Promise<AbTest[]> {
    return this.prisma.abTest.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  /** List available MetaStack snapshots for the create form. */
  async listSnapshots(): Promise<Array<{ id: string; scoringStrategyId: string; version: string; createdAt: Date }>> {
    return this.prisma.metaStackSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, scoringStrategyId: true, version: true, createdAt: true },
      take: 100,
    });
  }

  /**
   * Dispatch a single side's trade (called by the automation loop).
   * Places the order via the adapter (auto mode) and records it with abTestId.
   */
  async dispatchSideTrade(params: {
    test: AbTest;
    side: 'A' | 'B';
    symbol: string;
    brokerId: string;
    sideDir: 'BUY' | 'SELL';
    quantity: number;
    slPct: number;
    tpPct: number;
    entryPrice: number;
    mode: string;
  }): Promise<{ success: boolean; error?: string; ticket?: number; price?: number }> {
    const { test, side, symbol, brokerId, sideDir, quantity, slPct, tpPct, entryPrice, mode } = params;
    const comment = sanitizeMt5Comment(`TCS ${side === 'A' ? SIDE_A_TAG : SIDE_B_TAG} ${test.name}`, 27);

    const sl = sideDir === 'BUY' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100);
    const tp = sideDir === 'BUY' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100);

    if (mode !== 'auto') {
      // Manual/semi-auto: record intent only — no live order.
      await this.tradeRecorder.record({
        symbol,
        side: sideDir.toLowerCase() as 'buy' | 'sell',
        quantity,
        entryPrice,
        provider: (brokerId as any) || 'mt5',
        strategy: `AB-${side} ${test.name}`,
        status: 'open',
        origin: 'strategy',
        source: 'meta-stack',
        abTestId: test.id,
        sl,
        tp,
        brokerComment: comment,
      });
      return { success: true };
    }

    const adapter = this.adapterFactory.create(brokerId);
    if (!adapter?.placeOrder) {
      return { success: false, error: `Broker ${brokerId} has no order capability` };
    }

    const result = await adapter.placeOrder({
      symbol,
      side: sideDir,
      quantity,
      sl,
      tp,
      comment,
      clientOrderId: `ab-${test.id}-${side}-${symbol}`,
    });

    await this.tradeRecorder.record({
      symbol,
      side: sideDir.toLowerCase() as 'buy' | 'sell',
      quantity,
      entryPrice: result.price || entryPrice || 0,
      provider: (brokerId as any) || 'mt5',
      strategy: `AB-${side} ${test.name}`,
      status: result.success ? 'open' : 'rejected',
      origin: 'strategy',
      source: 'meta-stack',
      abTestId: test.id,
      brokerTicket: result.ticket != null ? String(result.ticket) : undefined,
      sl,
      tp,
      brokerComment: comment,
    });

    return { success: result.success, error: result.error, ticket: result.ticket as number | undefined, price: result.price };
  }

  /** Aggregate per-side PnL, win rate, and max drawdown from recorded trades. */
  private async computeResults(test: AbTest): Promise<any> {
    const trades = await this.prisma.trade.findMany({
      where: { abTestId: test.id, pnlInvalid: 0 }, // #931 — phantom closes are not results
      orderBy: { openedAt: 'asc' },
    });

    const sideA = trades.filter((t) => t.brokerComment?.includes(SIDE_A_TAG));
    const sideB = trades.filter((t) => t.brokerComment?.includes(SIDE_B_TAG));

    // Live unrealized P&L from MT5 positions tagged with the A/B comment.
    let liveBySide: Record<'A' | 'B', number> = { A: 0, B: 0 };
    try {
      const mt5 = this.adapterFactory.create('mt5') as any;
      const raw = mt5?.getPositionsRaw ? await mt5.getPositionsRaw() : [];
      for (const p of raw) {
        const comment = String(p.comment ?? '');
        if (comment.includes(SIDE_A_TAG)) liveBySide.A += Number(p.profit ?? 0);
        else if (comment.includes(SIDE_B_TAG)) liveBySide.B += Number(p.profit ?? 0);
      }
    } catch (err) {
      this.logger.warn(`A/B unrealized P&L lookup failed: ${(err as Error).message}`);
    }

    const summarize = (rows: typeof trades, livePnl: number) => {
      const closed = rows.filter((t) => t.status === 'closed' && t.pnl != null);
      const open = rows.filter((t) => t.status === 'open');
      const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
      const realized = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
      // Running equity curve for max drawdown (realized + live unrealized)
      let equity = livePnl;
      let peak = Math.max(0, equity);
      let maxDrawdown = peak - equity;
      for (const t of closed) {
        equity += t.pnl ?? 0;
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
      return {
        trades: rows.length,
        openTrades: open.length,
        closedTrades: closed.length,
        winRate: closed.length ? +(wins / closed.length).toFixed(4) : null,
        realizedPnl: +realized.toFixed(2),
        unrealizedPnl: +livePnl.toFixed(2),
        totalPnl: +(realized + livePnl).toFixed(2),
        maxDrawdown: +maxDrawdown.toFixed(2),
      };
    };

    const result = {
      control: summarize(sideA, liveBySide.A),
      variant: summarize(sideB, liveBySide.B),
      symbols: test.symbols,
      computedAt: new Date().toISOString(),
    };
    // #929 — a result without a stated verdict is not a result. The verdict REFUSES to name a
    // winner below the per-side sample bar, and names its method when it does.
    return { ...result, verdict: this.buildVerdict(result.control, result.variant) };
  }

  /**
   * #929 — the honesty bar. Two things must never happen: a verdict on a sample too small to
   * carry one, and a verdict with no stated method. Below AB_MIN_TRADES_FOR_VERDICT per side
   * this returns `insufficient-data` WITH the counts; above, it runs a two-proportion z-test on
   * win rates and reports the PnL-per-trade difference, both named.
   */
  private buildVerdict(control: any, variant: any): Record<string, unknown> {
    const nA = control.closedTrades ?? 0;
    const nB = variant.closedTrades ?? 0;
    if (nA < AB_MIN_TRADES_FOR_VERDICT || nB < AB_MIN_TRADES_FOR_VERDICT) {
      return {
        verdict: 'insufficient-data',
        n: { control: nA, variant: nB },
        requiredPerSide: AB_MIN_TRADES_FOR_VERDICT,
        note:
          `Refusing to name a winner: ${nA} vs ${nB} closed trades (need ≥${AB_MIN_TRADES_FOR_VERDICT} per side). ` +
          `A verdict on a smaller sample is noise wearing a result's clothes (#929).`,
      };
    }
    const pA = control.winRate ?? 0;
    const pB = variant.winRate ?? 0;
    const z = twoProportionZ(pA, nA, pB, nB);
    const pValue = 2 * (1 - normalCdf(Math.abs(z)));
    const pnlPerTradeA = control.realizedPnl / nA;
    const pnlPerTradeB = variant.realizedPnl / nB;
    const significant = pValue < 0.05;
    return {
      verdict: !significant ? 'no-significant-difference' : pA > pB ? 'control-leads' : 'variant-leads',
      method: 'two-proportion z-test on win rate (p<0.05); PnL-per-trade difference reported, not tested',
      n: { control: nA, variant: nB },
      winRate: { control: pA, variant: pB, delta: +(pB - pA).toFixed(4) },
      pnlPerTrade: {
        control: +pnlPerTradeA.toFixed(2),
        variant: +pnlPerTradeB.toFixed(2),
        delta: +(pnlPerTradeB - pnlPerTradeA).toFixed(2),
      },
      pValue: +pValue.toFixed(4),
    };
  }

  private async assertSnapshotsExist(controlStackId: string, variantStackId: string): Promise<void> {
    const snapshots = await this.prisma.metaStackSnapshot.findMany({
      where: { id: { in: [controlStackId, variantStackId] } },
      select: { id: true, scoringStrategyId: true, version: true },
    });
    const found = new Set(snapshots.map((s) => s.id));
    if (!found.has(controlStackId)) throw new BadRequestException(`controlStackId ${controlStackId} is not a valid snapshot`);
    if (!found.has(variantStackId)) throw new BadRequestException(`variantStackId ${variantStackId} is not a valid snapshot`);
  }
}

/** Two-proportion z statistic for win rates (pooled variance, the standard test for this comparison). */
function twoProportionZ(p1: number, n1: number, p2: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 0;
  const p = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se === 0 ? 0 : (p1 - p2) / se;
}

/** erf via Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7) — one formula is not worth a stats dependency. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF, for the two-sided p-value in buildVerdict (#929). */
function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
