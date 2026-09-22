/**
 * BotPerformanceService — the honesty gate is the thing under test.
 * ================================================================
 *
 * ⚠️ WHY THESE TESTS EXIST AND WHAT THEY PROTECT
 * ---------------------------------------------
 * #894 is explicit that a rating built on unsound data is WORSE than no rating, because
 * *"an operator would act on it"*. So the dangerous failure in this service is not a crash —
 * it is a **plausible number that should not exist**. That is the same defect class this repo
 * keeps re-finding (development-philosophy §7: plausible output, no error).
 *
 * Each test below therefore guards a specific way this file could produce a confident lie:
 *
 *   1. A phantom close counted as a real trade (the #931 USDCAD "20 trades, 3 wins" defect —
 *      it was really 3 trades, 3 wins, and the 17 phantoms were counted as losses).
 *   2. A break-even filed as a loss (the #884 class, still live in `symbols.service.ts`).
 *   3. A protocol slug's trades attributed to a bot (the dual-meaning `scoringStrategyId`).
 *   4. A failed lookup rendering as "no bots" — opposite conclusion, identical output.
 *   5. A rating awarded with a blocker outstanding.
 *   6. A missing denominator silently surfacing as 0.0%.
 *   7. A drawdown computed over unordered rows — a plausible wrong number, no error.
 */
import { BotPerformanceService, DEFAULT_RATING_POLICY } from './bot-performance.service';

/** A bot row shaped as the service selects it. */
function bot(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, name, protocolId: 'forex-session-v1', shortProtocolId: null, symbol: 'EURUSD',
    brokerId: 'mt5', timeframe: '5m', slPct: 1, tpPct: 2, mode: 'auto', active: true,
    maxPositions: 1, ...extra,
  };
}

/** One aggregate row as MySQL returns it. */
function agg(
  attribution: string | null,
  o: Partial<{
    trades: number; wins: number; losses: number; breakEven: number;
    avgWin: number | null; avgLoss: number | null; totalPnl: number;
    bestTrade: number | null; worstTrade: number | null;
    firstClose: string; lastClose: string;
  }> = {},
) {
  return {
    attribution,
    trades: o.trades ?? 1,
    wins: o.wins ?? 1,
    losses: o.losses ?? 0,
    breakEven: o.breakEven ?? 0,
    avgWin: o.avgWin === undefined ? 10 : o.avgWin,
    avgLoss: o.avgLoss === undefined ? -5 : o.avgLoss,
    totalPnl: o.totalPnl ?? 10,
    bestTrade: o.bestTrade === undefined ? 10 : o.bestTrade,
    worstTrade: o.worstTrade === undefined ? -5 : o.worstTrade,
    firstClose: new Date(o.firstClose ?? '2026-08-01T00:00:00Z'),
    lastClose: new Date(o.lastClose ?? '2026-09-20T00:00:00Z'),
  };
}

/**
 * Minimal Prisma stand-in.
 *
 * `failOn` lets a single lookup be made to throw, so the "a failed read must never look like an
 * empty table" behaviour can be canaried rather than assumed.
 */
function mockPrisma(opts: {
  aggregates?: any[];
  series?: any[];
  bots?: any[];
  protocols?: Array<{ slug: string }>;
  counts?: [number, number, number];
  available?: boolean;
  failOn?: 'tradingStrategy' | 'protocol' | 'aggregate' | 'series';
} = {}) {
  const counts = opts.counts ?? [0, 0, 0];
  return {
    isAvailable: opts.available ?? true,
    $queryRawUnsafe: jest.fn(async (sql: string) => {
      // The ordered series query is the one that names closedAt in its SELECT list.
      const isSeries = /SELECT scoringStrategyId AS attribution, pnl, closedAt/.test(sql);
      if (isSeries) {
        if (opts.failOn === 'series') throw new Error('series read failed');
        return opts.series ?? [];
      }
      if (opts.failOn === 'aggregate') throw new Error('aggregate read failed');
      return opts.aggregates ?? [];
    }),
    tradingStrategy: {
      findMany: jest.fn(async () => {
        if (opts.failOn === 'tradingStrategy') throw new Error('bot table locked');
        return opts.bots ?? [];
      }),
    },
    protocol: {
      findMany: jest.fn(async () => {
        if (opts.failOn === 'protocol') throw new Error('protocol table locked');
        return opts.protocols ?? [];
      }),
    },
    trade: {
      count: jest.fn(async () => counts.shift() ?? 0),
    },
  };
}

const svc = (prisma: any) => new BotPerformanceService(prisma);

describe('BotPerformanceService — the query that defines a realised trade', () => {
  /**
   * ⚠️ THE REGRESSION GUARD FOR #931. If someone "simplifies" the WHERE clause to
   * `status = 'closed'` — or to `pnlInvalid = 0`, which as of 2026-09-21 misses 17 measured
   * rows — the phantom rows come back as losses and every per-bot figure below is wrong.
   * The predicate is asserted as TEXT because that is where the defect would be introduced.
   */
  it('requires brokerTicket and exitPrice, never just status=closed', async () => {
    const prisma = mockPrisma({ aggregates: [] });
    await svc(prisma).getBotPerformance();

    const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('brokerTicket IS NOT NULL');
    expect(sql).toContain('exitPrice IS NOT NULL');
    // The looser form must not be present on its own anywhere in the predicate.
    expect(sql).not.toMatch(/WHERE\s+status\s*=\s*'closed'\s*$/m);
  });

  it('splits pnl into three buckets, so a break-even is not a loss', async () => {
    const prisma = mockPrisma({ aggregates: [] });
    await svc(prisma).getBotPerformance();

    const sql: string = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('WHEN pnl > 0');
    expect(sql).toContain('WHEN pnl < 0');
    expect(sql).toContain('WHEN pnl = 0');
    // `pnl <= 0` folds a genuine scratch into the losing side — the #884 defect.
    expect(sql).not.toContain('WHEN pnl <= 0');
  });
});

describe('BotPerformanceService — attribution', () => {
  it('matches a bot id and reports it as a bot', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'EURUSD London')],
      aggregates: [agg('b1', { trades: 3, wins: 2, losses: 1, totalPnl: 15 })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots).toHaveLength(1);
    expect(out.bots[0].matched).toBe(true);
    expect(out.bots[0].attributionKind).toBe('bot');
    expect(out.bots[0].botName).toBe('EURUSD London');
  });

  /**
   * ⚠️ The dual-meaning column. `symbols.service.ts` measured one USDCAD row holding the
   * protocol slug `forex-session-v1` where a bot UUID was expected. If that resolved as a bot,
   * a protocol's P&L would be reported as some bot's record — silently, with a real name on it.
   */
  it('never attributes a protocol slug to a bot', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'Some Bot')],
      protocols: [{ slug: 'forex-session-v1' }],
      aggregates: [agg('forex-session-v1', { trades: 4, wins: 3, losses: 1 })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].matched).toBe(false);
    expect(out.bots[0].attributionKind).toBe('protocol_slug');
    expect(out.bots[0].botId).toBeNull();
    expect(out.bots[0].blockers).toContain('attribution_unresolved');
  });

  it('lists an unknown attribution by name rather than only counting it', async () => {
    const prisma = mockPrisma({
      bots: [], protocols: [],
      aggregates: [agg('ghost-uuid-1234', { trades: 2, wins: 1, losses: 1 })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].attributionKind).toBe('unresolved');
    expect(out.unattributed.unresolvedValues).toContain('ghost-uuid-1234');
  });

  /**
   * ⚠️ `none` and `unresolved` are different CAUSES, not two names for one thing:
   * a null means a writer omitted the field; an unrecognised value means a writer used a
   * convention nobody knows. They are different writers, so collapsing them would erase the
   * only diagnostic that says which one is misbehaving.
   */
  it('separates a null attribution from an unresolved one', async () => {
    const prisma = mockPrisma({
      bots: [], protocols: [],
      aggregates: [agg(null, { trades: 5, wins: 2, losses: 3 })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].attributionKind).toBe('none');
    expect(out.unattributed.noAttribution).toBe(1);
    expect(out.unattributed.unresolved).toBe(0);
    // Nothing to list, because there is no value to name.
    expect(out.unattributed.unresolvedValues).toHaveLength(0);
  });
});

describe('BotPerformanceService — realised figures', () => {
  /**
   * ⚠️ Payoff is NULL, not 0, when a side has no observations. "A bot with 5 wins and no
   * losses" has an unbounded payoff; reporting 0.0 would describe the best possible record as
   * the worst. The null semantics are copied from `symbols.service.ts` (#921) on purpose.
   */
  it('returns null payoff when there are no losing trades, not zero', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'Winners Only')],
      aggregates: [agg('b1', { trades: 5, wins: 5, losses: 0, avgWin: 20, avgLoss: null, totalPnl: 100 })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].realised.payoff).toBeNull();
    expect(out.bots[0].realised.avgLoss).toBeNull();
    expect(out.bots[0].realised.winRate).toBe(1);
  });

  it('computes payoff as avgWin over |avgLoss|', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', { trades: 2, wins: 1, losses: 1, avgWin: 30, avgLoss: -10, totalPnl: 20 })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].realised.payoff).toBe(3);
  });

  /**
   * ⚠️ `winRate: null`, not 0, when there are no trades. There is no rate without a
   * denominator, and 0.0% would read as "this bot always loses".
   */
  it('returns null win rate for a zero-sample bucket', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', { trades: 0, wins: 0, losses: 0, breakEven: 0, avgWin: null, avgLoss: null, totalPnl: 0 })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].realised.winRate).toBeNull();
    expect(out.bots[0].realised.samples).toBe(0);
    expect(out.bots[0].blockers).toContain('no_realised_trades');
  });

  it('reports declared payoff from the bot config', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B', { slPct: 0.5, tpPct: 1.5 })],
      aggregates: [agg('b1')],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].declared?.payoff).toBe(3);
  });

  it('reports declared payoff as null when slPct or tpPct is unset', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B', { slPct: null, tpPct: 1.5 })],
      aggregates: [agg('b1')],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].declared?.payoff).toBeNull();
  });
});

describe('BotPerformanceService — the rating gate', () => {
  /**
   * ⚠️ THE CENTRAL PROPERTY. A rating must be impossible while any blocker is outstanding.
   * If this test ever passes trivially — because blockers are empty for another reason — the
   * companion assertion below (`blockers.length > 0`) is what catches it.
   */
  it('never awards gold while a blocker is outstanding', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', {
        trades: 100, wins: 60, losses: 40, avgWin: 30, avgLoss: -10, totalPnl: 1400,
        firstClose: '2026-01-01T00:00:00Z', lastClose: '2026-09-01T00:00:00Z',
      })],
    });
    const out = await svc(prisma).getBotPerformance();

    for (const b of out.bots) {
      if (b.rating === 'gold') {
        expect(b.blockers).toHaveLength(0);
      } else {
        expect(b.blockers.length).toBeGreaterThan(0);
      }
    }
  });

  it('refuses a rating on insufficient samples and says the floor', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', { trades: 4, wins: 3, losses: 1, totalPnl: 30 })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].rating).toBeNull();
    expect(out.bots[0].blockers).toContain('insufficient_samples');
    expect(out.bots[0].blockersDetail.join(' ')).toContain(String(DEFAULT_RATING_POLICY.minSamples));
  });

  it('refuses a rating when the window is too short', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', {
        trades: 40, wins: 25, losses: 15, totalPnl: 300,
        firstClose: '2026-09-18T00:00:00Z', lastClose: '2026-09-20T00:00:00Z',
      })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].blockers).toContain('window_too_short');
    expect(out.bots[0].window.days).toBeLessThan(DEFAULT_RATING_POLICY.minWindowDays);
  });

  /**
   * ⚠️⚠️ REGRESSION GUARD FOR A REAL DEFECT CAUGHT AGAINST THE LIVE TABLE (2026-09-22).
   *
   * The first implementation returned drawdown as a PERCENTAGE OF PEAK CUMULATIVE P&L, and
   * printed **1780%** for a live bot (GBPCAD: peak +0.10, trough -1.68). A drawdown percentage
   * cannot exceed 100%, so the figure was self-evidently wrong — but it was produced without
   * error, which is the whole defect class this repo keeps re-finding.
   *
   * `maxDrawdownPct` must therefore stay null and `maxDrawdown` must stay ABSOLUTE. If someone
   * reintroduces a percentage here, this test is what stops it reaching an operator.
   */
  it('never reports a drawdown percentage — only an absolute decline', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', { trades: 2, wins: 1, losses: 1, avgWin: 0.1, avgLoss: -1.68, totalPnl: -1.58 })],
      // The exact live shape: a tiny peak then a much larger loss.
      series: [
        { attribution: 'b1', pnl: 0.1, closedAt: new Date('2026-01-01T00:00:00Z') },
        { attribution: 'b1', pnl: -1.68, closedAt: new Date('2026-01-02T00:00:00Z') },
      ],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].maxDrawdownPct).toBeNull();
    // Arithmetic shown so the figure is checkable rather than trusted:
    //   after trade 1: cum = +0.10, peak = +0.10, decline 0
    //   after trade 2: cum = -1.58, peak = +0.10, decline 1.68  <= peak-to-trough
    // (Not 1.78 — declining from a peak is not the same as summing the moves.)
    expect(out.bots[0].maxDrawdown).toBe(1.68);
    // The defect produced 1780; nothing here may ever be expressed as a percentage.
    expect(out.bots[0].maxDrawdown).toBeLessThan(100);
    expect(out.bots[0].blockers).toContain('drawdown_unverifiable');
  });

  it('computes drawdown over the ordered series, not the aggregate', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', { trades: 3, wins: 2, losses: 1, totalPnl: 4 })],
      // peak 5 then trough 2 => absolute decline of 3
      series: [
        { attribution: 'b1', pnl: 5, closedAt: new Date('2026-01-01T00:00:00Z') },
        { attribution: 'b1', pnl: -3, closedAt: new Date('2026-01-02T00:00:00Z') },
        { attribution: 'b1', pnl: 2, closedAt: new Date('2026-01-03T00:00:00Z') },
      ],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].maxDrawdown).toBe(3);
  });

  /**
   * ⚠️ The peak starts at ZERO, not at the first trade's P&L. A bot that opens with a loss has
   * a genuine decline from zero, and starting the peak at that loss would report the worst
   * possible case as no drawdown at all.
   */
  it('measures drawdown from zero for a bot that never profited', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', { trades: 2, wins: 0, losses: 2, avgWin: null, avgLoss: -5, totalPnl: -10 })],
      series: [
        { attribution: 'b1', pnl: -5, closedAt: new Date('2026-01-01T00:00:00Z') },
        { attribution: 'b1', pnl: -5, closedAt: new Date('2026-01-02T00:00:00Z') },
      ],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].maxDrawdown).toBe(10);
    expect(Number.isNaN(out.bots[0].maxDrawdown)).toBe(false);
    expect(out.bots[0].realised.totalPnl).toBe(-10);
  });

  /**
   * #894: *"A drawdown condition is not optional."* With no capital base the condition cannot
   * be APPLIED — so it must block the rating rather than be silently skipped. Skipping it would
   * award the stamp with no risk condition evaluated at all.
   */
  it('blocks the rating when the required drawdown condition cannot be applied', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', {
        trades: 100, wins: 70, losses: 30, totalPnl: 900,
        firstClose: '2026-01-01T00:00:00Z', lastClose: '2026-09-01T00:00:00Z',
      })],
      series: [
        { attribution: 'b1', pnl: 900, closedAt: new Date('2026-01-01T00:00:00Z') },
        { attribution: 'b1', pnl: -1, closedAt: new Date('2026-02-01T00:00:00Z') },
      ],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].blockers).toContain('drawdown_unverifiable');
    expect(out.bots[0].rating).toBeNull();
  });

  it('refuses a rating on negative expectancy', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', {
        trades: 60, wins: 40, losses: 20, avgWin: 5, avgLoss: -20, totalPnl: -200,
        firstClose: '2026-01-01T00:00:00Z', lastClose: '2026-09-01T00:00:00Z',
      })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].blockers).toContain('expectancy_negative');
    expect(out.bots[0].realised.expectancy).toBeLessThan(0);
  });

  /**
   * ⚠️ THE SCHEMA-GAP ASSERTION. `trading_strategy` has no capital-allocation column, so
   * realised return as a PERCENTAGE has no denominator. The service must say so rather than
   * invent one. If an allocation field is ever added, this test SHOULD fail — and that is the
   * signal to implement the percentage properly rather than delete the test.
   */
  it('serves realisedPct as an explicit null with a stated reason', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', { trades: 50, wins: 30, losses: 20, totalPnl: 400 })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].realisedPct).toBeNull();
    expect(out.bots[0].blockers).toContain('no_allocation_basis');
    expect(out.bots[0].blockersDetail.join(' ')).toMatch(/allocation/i);
  });

  it('honours an overridden policy so the rating stays recomputable', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'B')],
      aggregates: [agg('b1', {
        trades: 4, wins: 3, losses: 1, totalPnl: 30,
        firstClose: '2026-01-01T00:00:00Z', lastClose: '2026-09-01T00:00:00Z',
      })],
    });
    const strict = await svc(prisma).getBotPerformance();
    const loose = await svc(prisma).getBotPerformance({
      policy: { minSamples: 2, minWindowDays: 1, maxDrawdownPct: 99 },
    });

    expect(strict.bots[0].blockers).toContain('insufficient_samples');
    expect(loose.bots[0].blockers).not.toContain('insufficient_samples');
  });
});

describe('BotPerformanceService — failure must not look like emptiness', () => {
  /**
   * ⚠️ development-philosophy §7. "No bots found" and "the bot table could not be read" are
   * opposite conclusions that render identically if a failed lookup is swallowed.
   */
  it('surfaces a failed bot lookup as a caveat', async () => {
    const prisma = mockPrisma({
      failOn: 'tradingStrategy',
      aggregates: [agg('b1', { trades: 3 })],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.caveats.join(' ')).toMatch(/FAILED/);
    expect(out.caveats.join(' ')).toContain('bot table locked');
    // The row survives, but it is correctly unresolved rather than silently dropped.
    expect(out.bots[0].attributionKind).toBe('unresolved');
  });

  it('surfaces a failed aggregate read instead of returning an empty report', async () => {
    const prisma = mockPrisma({ failOn: 'aggregate' });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots).toHaveLength(0);
    expect(out.caveats.join(' ')).toContain('aggregate read failed');
    expect(out.populationNote).toBe('No trades evaluated.');
  });

  it('distinguishes database-unavailable from an empty result', async () => {
    const prisma = mockPrisma({ available: false });
    const out = await svc(prisma).getBotPerformance();

    expect(out.caveats).toContain('Database unavailable');
    // The query must not even be attempted when the connection is known-down.
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('counts phantom rows and how many lack the pnlInvalid flag', async () => {
    const prisma = mockPrisma({ aggregates: [], counts: [206, 99, 17] });
    const out = await svc(prisma).getBotPerformance();

    expect(out.excluded.totalClosed).toBe(206);
    expect(out.excluded.phantom).toBe(99);
    expect(out.excluded.phantomNotFlagged).toBe(17);
    expect(out.populationNote).toContain('17');
  });
});

describe('BotPerformanceService — ordering and stability', () => {
  it('leads with the largest sample', async () => {
    const prisma = mockPrisma({
      bots: [bot('b1', 'Small'), bot('b2', 'Big')],
      aggregates: [
        agg('b1', { trades: 2, wins: 1, losses: 1, totalPnl: 5 }),
        agg('b2', { trades: 40, wins: 25, losses: 15, totalPnl: 300 }),
      ],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots[0].botName).toBe('Big');
    expect(out.bots[1].botName).toBe('Small');
  });

  it('is stable when samples and pnl tie', async () => {
    const prisma = mockPrisma({
      bots: [bot('bb', 'BBB'), bot('aa', 'AAA')],
      aggregates: [
        agg('bb', { trades: 5, wins: 3, losses: 2, totalPnl: 10 }),
        agg('aa', { trades: 5, wins: 3, losses: 2, totalPnl: 10 }),
      ],
    });
    const out = await svc(prisma).getBotPerformance();

    expect(out.bots.map((b) => b.attribution)).toEqual(['aa', 'bb']);
  });
});
