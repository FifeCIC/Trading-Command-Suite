import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AbTest } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { sanitizeMt5Comment } from '../providers/mt5-comment.util';

/** Symbols allowed in a single A/B test. */
const MAX_AB_SYMBOLS = 4;

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

    const active = await this.getActiveTest();
    if (active && active.id !== id) {
      throw new BadRequestException(`Another A/B test is already running (${active.name}) — stop it first`);
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

  /** The currently running test (null if none). */
  async getActiveTest(): Promise<AbTest | null> {
    return this.prisma.abTest.findFirst({ where: { status: 'running' } });
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
      where: { abTestId: test.id },
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

    return {
      control: summarize(sideA, liveBySide.A),
      variant: summarize(sideB, liveBySide.B),
      symbols: test.symbols,
      computedAt: new Date().toISOString(),
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
