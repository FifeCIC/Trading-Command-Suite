/**
 * BacktestService — the comparison contract (#965 items 1 and 2).
 * ===============================================================
 *
 * WHAT THIS GUARDS, and why each one is here rather than in prose:
 *
 *   1. **The sample bar.** Measured 2026-09-23: `POST /api/backtest/runs/compare` named a winner
 *      on THREE trades (`xau-speed-m15`, sharpe 42.31) and presented it identically to a result
 *      from three hundred. Two of these tests exist to keep that impossible.
 *   2. **The units.** The old formatter applied one ×100 to `winRate` (a fraction), `maxDrawdown`
 *      (already a percent) and `avgTradePnl` (already a percent). A 0.27% drawdown was served as
 *      **27**, and −14.47% as **−1447**. These tests pin the scale, so a future formatter cannot
 *      quietly reintroduce the ×100.
 *   3. **Two populations, kept apart.** `winRate` on the stored row is a SIGNAL rate and
 *      `totalTrades` is a TRADE count. Run `0dd94ddd` served `winRate: 100` beside
 *      `totalTrades: 3` while its own trade rows are **0 winners of 3**. `signalWinRatePct` and
 *      `tradeWinRatePct` must never collapse back into one number.
 *
 * A guard that has never been observed to fail is a decoration — every one of these was canaried
 * in both directions when it was written (see the issue comment for the observed failures).
 */
import { BacktestService, mergeBotConfig, BotForBacktest } from './backtest.service';

/** One stored run, shaped as `findMany` returns it (symbol included). */
function run(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    symbolId: 'sym-1',
    protocolId: 'xau-speed-m15',
    timeframe: '15m',
    startDate: new Date('2026-08-01T00:00:00Z'),
    endDate: new Date('2026-08-31T00:00:00Z'),
    totalDays: 30,
    totalTrades: 3,
    totalSignals: 40,
    winRate: 1,        // FRACTION — 100% of entry SIGNALS were profitable
    totalPnl: -0.0009,
    profitFactor: 0.9,
    sharpeRatio: 42.3146,
    maxDrawdown: 0.27, // ALREADY a percent — this is the field the old formatter inflated to 27
    avgTradePnl: -0.1767,
    createdAt: new Date('2026-09-23T00:00:00Z'),
    symbol: { ticker: 'XAUUSD' },
    ...over,
  };
}

/**
 * Minimal Prisma stand-in. `trades` is `[runId, winningRowCount, losingRowCount]` so the two
 * counted populations (all trades, winners) can be driven independently of the STORED counts —
 * which is what makes the disagreement test possible.
 */
function mockPrisma(opts: { runs?: any[]; trades?: Array<[string, number, number]>; bot?: any } = {}) {
  const trades = opts.trades ?? [];
  return {
    isAvailable: true,
    backtestRun: {
      findMany: jest.fn(async () => opts.runs ?? []),
    },
    tradingStrategy: {
      // #965 item 3 — a bot-driven run reads the bot before anything else.
      findUnique: jest.fn(async () => opts.bot ?? null),
    },
    backtestTrade: {
      // Two groupBy calls: all trades, then winners only (the service passes `pnl: { gt: 0 }`).
      // ⚠️ Test for the KEY, not the value: `where.pnl.gt` is literally `0`, so `Boolean(...)` on
      // it is FALSE and the mock would hand back every trade as a winner. That mistake was made
      // here and produced a duplicate-'wins' read of 3-of-3 — worth leaving a note about.
      groupBy: jest.fn(async (args: any) => {
        const winnersOnly = args?.where?.pnl !== undefined;
        return trades
          .map(([runId, w, l]) => ({
            runId,
            _count: { _all: winnersOnly ? w : w + l },
          }))
          .filter((r) => r._count._all > 0);
      }),
    },
  };
}

const svc = (prisma: any) =>
  new BacktestService(prisma, {} as any, {} as any, {} as any);

describe('BacktestService.compareRuns — the sample bar (#965 item 1)', () => {
  /**
   * ⚠️ THE CITED DEFECT, reproduced as a test. Before this change the assertion below failed:
   * `best` was `{ metric: 'sharpeRatio', value: 42.31 }` — a winner named on three trades.
   */
  it('refuses to name a winner on three trades, and names the counts', async () => {
    const prisma = mockPrisma({
      runs: [run('r-m15'), run('r-m5', { totalTrades: 0, totalSignals: 0, sharpeRatio: 0, winRate: 0 })],
      trades: [['r-m15', 0, 3]], // 0 winners of 3 — the measured reality for that run
    });
    const out = await svc(prisma).compareRuns(['r-m15', 'r-m5']);

    expect(out.best).toBeNull();
    expect(out.verdict.verdict).toBe('insufficient-data');
    expect(out.verdict.requiredPerSide).toBe(30);
    expect(out.verdict.metric).toBeNull();
    // The counts are IN the note, so the reader sees why rather than a bare refusal.
    expect(out.verdict.note).toMatch(/3/);
    expect(out.verdict.note).toMatch(/≥30/);
  });

  /**
   * ⚠️ THE SHARPEST FORM OF THE DEFECT, and the one the bar exists for: a THIN run whose Sharpe is
   * inflated by a handful of samples out-scoring a THICK run. Measured on the live table, the thin
   * side was `xau-speed-m15` (3 trades, sharpe 42.31) and the thick side was 48–59 trades at
   * sharpe 1.4–4.3. Without the bar, the 3-trade run was named `best`.
   */
  it('will not let a 3-trade run out-score a 40-trade run', async () => {
    const prisma = mockPrisma({
      runs: [
        run('r-thick', { protocolId: 'xau-speed-m5', totalTrades: 40, totalSignals: 200, sharpeRatio: 1.4 }),
        run('r-thin', { protocolId: 'xau-speed-m15', totalTrades: 3, totalSignals: 40, sharpeRatio: 42.31 }),
      ],
      trades: [['r-thick', 22, 18], ['r-thin', 0, 3]],
    });
    const out = await svc(prisma).compareRuns(['r-thick', 'r-thin']);

    // The thin run still LEADS on the metric — the point is that it is not NAMED.
    expect(out.runs.find((r) => r.id === 'r-thin')!.sharpeRatio).toBe(42.31);
    expect(out.best).toBeNull();
    expect(out.verdict.verdict).toBe('insufficient-data');
  });

  it('names a winner above the bar, WITH its method and its sample', async () => {
    const prisma = mockPrisma({
      runs: [run('r-a', { totalTrades: 40, totalSignals: 120, sharpeRatio: 1.2 })],
      trades: [['r-a', 22, 18]],
    });
    const out = await svc(prisma).compareRuns(['r-a']);

    expect(out.verdict.verdict).toBe('winner');
    expect(out.best).not.toBeNull();
    expect(out.best!.metric).toBe('sharpeRatio');
    expect(out.best!.sample).toBe(40);
    // The method is stated where a reader will see it, not only in the field name.
    expect(out.verdict.note).toMatch(/sharpeRatio/);
    // And the bar is NOT a significance claim.
    expect(out.verdict.note).toMatch(/NOT "statistically significant"/);
  });

  /**
   * ⚠️ THE SECOND POPULATION. The winner metric is computed over entry SIGNALS, so a bar on trades
   * alone would still let the verdict rest on an unrecorded sample. A run made before the
   * `totalSignals` column existed reports UNKNOWN — and unknown must refuse, not pass.
   */
  it('refuses when the SIGNAL sample is unrecorded rather than treating it as zero', async () => {
    const prisma = mockPrisma({
      runs: [run('r-legacy', { totalTrades: 50, totalSignals: null })],
      trades: [['r-legacy', 25, 25]],
    });
    const out = await svc(prisma).compareRuns(['r-legacy']);

    expect(out.best).toBeNull();
    expect(out.verdict.verdict).toBe('sample-unknown');
    expect(out.verdict.note).toMatch(/UNKNOWN/);
    expect(out.verdict.note).toMatch(/not measured/);
  });

  it('reports no data as a distinct outcome, not as a tie', async () => {
    const out = await svc(mockPrisma({ runs: [] })).compareRuns(['missing-id']);

    expect(out.verdict.verdict).toBe('no-runs');
    expect(out.best).toBeNull();
    expect(out.verdict.note).toMatch(/no data was read/i);
  });

  /** A stored count that disagrees with the trade rows is a finding and is surfaced. */
  it('surfaces a stored-vs-counted disagreement instead of smoothing it over', async () => {
    const prisma = mockPrisma({
      runs: [run('r-x', { totalTrades: 99, totalSignals: 120 })],
      trades: [['r-x', 20, 20]], // 40 counted, not 99
    });
    const out = await svc(prisma).compareRuns(['r-x']);

    expect(out.runs[0].totalTrades).toBe(99);
    expect(out.runs[0].tradesCounted).toBe(40);
    expect(out.verdict.note).toMatch(/stored 99, found 40/);
  });
});

describe('BacktestService.compareRuns — units and populations (#965 item 2)', () => {
  /**
   * ⚠️ THE ×100 REGRESSION. `maxDrawdown` and `avgTradePnl` are already percents; the old
   * formatter multiplied them by 100. These assertions are the guard: 0.27 must stay 0.27 and
   * −0.1767 must stay −0.1767.
   */
  it('serves percent fields at their stored scale, never inflated by 100', async () => {
    const prisma = mockPrisma({
      runs: [run('r-1', { totalTrades: 3, totalSignals: 40 })],
      trades: [['r-1', 0, 3]],
    });
    const out = await svc(prisma).compareRuns(['r-1']);

    expect(out.runs[0].maxDrawdownPct).toBe(0.27);   // NOT 27
    expect(out.runs[0].avgTradePnlPct).toBe(-0.1767); // NOT -17.67
    // The fraction→percent conversion is still applied to the ONE field that needs it.
    expect(out.runs[0].signalWinRatePct).toBe(100);
  });

  /** A small loss must not round to 0.00 — the old 2dp rounding turned −0.0009 into nothing. */
  it('keeps a small P&L visible instead of rounding it to zero', async () => {
    const prisma = mockPrisma({
      runs: [run('r-2', { totalPnl: -0.0009, totalTrades: 3, totalSignals: 40 })],
      trades: [['r-2', 0, 3]],
    });
    const out = await svc(prisma).compareRuns(['r-2']);

    expect(out.runs[0].totalPnl).toBe(-0.0009);
    expect(out.runs[0].totalPnl).not.toBe(0);
  });

  /**
   * ⚠️ THE TWO POPULATIONS, side by side and both true. This is the measured shape that made the
   * old payload misleading: a 100% figure and a 0-wins record on one row. They must stay
   * distinguishable, and the trade rate must be counted from the trades.
   */
  it('keeps the SIGNAL rate and the TRADE rate apart, and counts the trade rate from the trades', async () => {
    const prisma = mockPrisma({
      runs: [run('r-3', { winRate: 1, totalTrades: 3, totalSignals: 40 })],
      trades: [['r-3', 0, 3]], // zero winners
    });
    const out = await svc(prisma).compareRuns(['r-3']);

    expect(out.runs[0].signalWinRatePct).toBe(100); // 100% of SIGNALS were profitable
    expect(out.runs[0].tradeWinRatePct).toBe(0);    // 0 of 3 TRADES won
    expect(out.runs[0].totalSignals).toBe(40);
  });

  /** No trades means the trade rate is UNKNOWN, never a fabricated 0%. */
  it('serves a null trade win rate when there are no trades to win', async () => {
    const prisma = mockPrisma({
      runs: [run('r-4', { totalTrades: 0, totalSignals: 0 })],
      trades: [],
    });
    const out = await svc(prisma).compareRuns(['r-4']);

    expect(out.runs[0].tradeWinRatePct).toBeNull();
  });

  /**
   * ⚠️ #965 item 4 — LIKE-FOR-LIKE. Measured on the real XAU pair: its two sides are driven by bots
   * sized 0.01 and 0.02 lots, and this backtester cannot reproduce a lot size (#843). A comparison
   * across them must not let the difference be credited to the protocol alone.
   */
  it('says NOT LIKE-FOR-LIKE when the two sides were sized differently', async () => {
    const prisma = mockPrisma({
      runs: [
        run('r-a', { protocolId: 'xau-speed-m5', totalTrades: 40, totalSignals: 200, botId: 'bot-a', botBaseSize: 0.01 }),
        run('r-b', { protocolId: 'xau-speed-m15', totalTrades: 40, totalSignals: 200, botId: 'bot-b', botBaseSize: 0.02 }),
      ],
      trades: [['r-a', 20, 20], ['r-b', 20, 20]],
    });
    const out = await svc(prisma).compareRuns(['r-a', 'r-b']);

    expect(out.verdict.sizeWarning).not.toBeNull();
    expect(out.verdict.sizeWarning).toMatch(/NOT LIKE-FOR-LIKE/);
    expect(out.verdict.sizeWarning).toMatch(/0\.01 vs 0\.02 lots/);
    // It travels on the verdict note too, where a reader actually looks.
    expect(out.verdict.note).toMatch(/NOT LIKE-FOR-LIKE/);
    expect(out.runs[0].botBaseSize).not.toBeNull();
  });

  it('stays silent when both sides were sized alike', async () => {
    const prisma = mockPrisma({
      runs: [
        run('r-a', { totalTrades: 40, totalSignals: 200, botId: 'bot-a', botBaseSize: 0.01 }),
        run('r-b', { totalTrades: 40, totalSignals: 200, botId: 'bot-b', botBaseSize: 0.01 }),
      ],
      trades: [['r-a', 20, 20], ['r-b', 20, 20]],
    });
    const out = await svc(prisma).compareRuns(['r-a', 'r-b']);

    expect(out.verdict.sizeWarning).toBeNull();
    expect(out.verdict.note).not.toMatch(/NOT LIKE-FOR-LIKE/);
  });

  /**
   * ⚠️ UNKNOWN IS NOT EQUAL. A run with no recorded bot size (legacy, or hand-assembled) must be
   * named as unknown rather than assumed to match the others — the same rule as null-vs-zero.
   */
  it('names an UNKNOWN bot size rather than assuming the sides match', async () => {
    const prisma = mockPrisma({
      runs: [
        run('r-a', { totalTrades: 40, totalSignals: 200, botId: null, botBaseSize: null }),
        run('r-b', { totalTrades: 40, totalSignals: 200, botId: 'bot-b', botBaseSize: 0.02 }),
      ],
      trades: [['r-a', 20, 20], ['r-b', 20, 20]],
    });
    const out = await svc(prisma).compareRuns(['r-a', 'r-b']);

    expect(out.verdict.sizeWarning).toMatch(/LOT SIZE is UNKNOWN/);
    expect(out.verdict.sizeWarning).toMatch(/Unknown is not the same as equal/);
  });
});

describe('run() with a botId — an unresolvable bot must not run', () => {
  /**
   * ⚠️ The defect this guards: falling back to an unscoped run would MEASURE a configuration nobody
   * asked for while reporting the bot that was requested. It throws, and it throws before reading
   * any market data.
   */
  it('refuses an unknown bot id instead of measuring something else', async () => {
    const prisma = mockPrisma({ bot: null });

    await expect(svc(prisma).run({ botId: 'does-not-exist' })).rejects.toThrow(
      /No bot with id does-not-exist/,
    );
    // And it refused BEFORE touching bars — no market read happened.
    expect(prisma.backtestRun.findMany).not.toHaveBeenCalled();
  });
});

describe('mergeBotConfig — "backtest this bot" as one call (#965 item 3)', () => {
  const bot = (over: Partial<BotForBacktest> = {}): BotForBacktest => ({
    id: 'bot-1',
    name: 'EURCAD Macro Session',
    symbol: 'EURCAD',
    protocolId: 'forex-session-v1',
    timeframe: '5m',
    slPct: 1,
    tpPct: 1,
    baseSize: 0.01,
    mode: 'auto',
    active: true,
    ...over,
  });

  it('takes the bot\'s own configuration when the caller supplies only a botId', () => {
    const out = mergeBotConfig({ botId: 'bot-1' }, bot());

    expect(out.request.symbol).toBe('EURCAD');
    expect(out.request.protocolId).toBe('forex-session-v1');
    expect(out.request.timeframe).toBe('5m');
    expect(out.request.slPct).toBe(1);
    expect(out.request.tpPct).toBe(1);
    expect(out.drivenBy.botName).toBe('EURCAD Macro Session');
    // Nothing was replaced, so nothing is claimed to have been.
    expect(out.drivenBy.overridden).toEqual([]);
  });

  /**
   * ⚠️ The run must say what it MEASURED, not what was asked for. A caller tightening the stop is
   * running a different configuration, and the record has to carry that.
   */
  it('lets an explicit field win, and records that it overrode the bot', () => {
    const out = mergeBotConfig({ botId: 'bot-1', slPct: 0.5, symbol: 'XAUUSD' }, bot());

    expect(out.request.slPct).toBe(0.5);
    expect(out.request.symbol).toBe('XAUUSD');
    expect(out.drivenBy.overridden).toContain('slPct');
    // The bot's own value is still reported, so the two can be compared.
    expect(out.drivenBy.protocolId).toBe('forex-session-v1');
  });

  /**
   * ⚠️ #843 — the caveat must be present on EVERY bot-driven run, with the bot's own lot size in
   * it. This is what stops the result reading as a forecast of the bot's P&L.
   */
  it('states the sizing divergence with the bot\'s own lot size (#843)', () => {
    const out = mergeBotConfig({ botId: 'bot-1' }, bot());

    expect(out.caveats.join(' ')).toMatch(/POSITION SIZING DOES NOT MATCH THE LIVE PATH/);
    expect(out.caveats.join(' ')).toMatch(/0\.01 lot/);
    expect(out.caveats.join(' ')).toMatch(/ENTRY LOGIC/);
    expect(out.drivenBy.baseSize).toBe(0.01);
  });

  /** NULL is not 0: the live loop would substitute its own default, and the caveat says which. */
  it('reports an UNSET baseSize as the live default rather than as zero', () => {
    const out = mergeBotConfig({ botId: 'bot-1' }, bot({ baseSize: null }));

    expect(out.drivenBy.baseSize).toBeNull();
    expect(out.caveats.join(' ')).toMatch(/UNSET baseSize/);
    expect(out.caveats.join(' ')).toMatch(/0\.01 default/);
  });

  it('warns when the bot has no protocolId, rather than measuring against a default', () => {
    const out = mergeBotConfig({ botId: 'bot-1' }, bot({ protocolId: null }));

    expect(out.request.protocolId).toBeUndefined();
    expect(out.caveats.join(' ')).toMatch(/NO protocolId/);
  });
});

describe('BacktestService.getSummary — two populations, each named (#980)', () => {
  /**
   * ⚠️ THE CITED DEFECT, reproduced as a test.
   *
   * `getSummary` used to return `signals: r.totalTrades` — a TRADE count under a SIGNAL name — and
   * `winRate: r.winRate`, the SIGNAL rate, with nothing naming either population. Run `0dd94ddd` is
   * the measured case: stored `winRate 1` (100%) beside **0 winners of 3** trades. A consumer could
   * therefore read "3 signals, 100% win rate" from a run that lost every trade it made.
   *
   * Acceptance criteria this pins:
   *   1. no signal rate under a trade name, or vice versa;
   *   2. `0 of 3 trades won` AND `100% of entry signals profitable` visible as DISTINCT figures;
   *   3. an unrecorded signal count reports as UNKNOWN — never 0, never the trade count.
   */
  function summaryPrisma(r: any, trades: Array<[string, number, number]>) {
    return {
      isAvailable: true,
      symbol: { findUnique: jest.fn(async () => ({ id: 'sym-1', ticker: 'XAUUSD' })) },
      backtestRun: { findMany: jest.fn(async () => [r]) },
      backtestTrade: {
        groupBy: jest.fn(async (args: any) => {
          // ⚠️ Key on presence of `where.pnl`, not its truthiness — `pnl: { gt: 0 }` is an object
          // and `gt` is literally 0, so a Boolean check would return every trade as a winner.
          const winnersOnly = args?.where?.pnl !== undefined;
          return trades
            .map(([runId, w, l]) => ({ runId, _count: { _all: winnersOnly ? w : w + l } }))
            .filter((x) => x._count._all > 0);
        }),
      },
    };
  }

  it('serves 0 of 3 TRADES won beside 100% of entry SIGNALS, as two distinct figures', async () => {
    const prisma = summaryPrisma(run('r-980'), [['r-980', 0, 3]]);
    const row = (await svc(prisma).getSummary('XAUUSD')).runs[0];

    expect(row.signalWinRatePct).toBe(100); // 100% of entry SIGNALS were profitable
    expect(row.tradeWinRatePct).toBe(0);    // 0 of 3 TRADES won — the measured reality
    expect(row.trades).toBe(3);
    expect(row.signals).toBe(40);           // the SIGNAL count, from its own column
  });

  it('never substitutes totalTrades for an unrecorded signal count', async () => {
    // Legacy run: written before `backtestrun.totalSignals` existed.
    const prisma = summaryPrisma(run('r-legacy', { totalSignals: null, totalTrades: 50 }), []);
    const row = (await svc(prisma).getSummary('XAUUSD')).runs[0];

    expect(row.signals).toBeNull();   // UNKNOWN — the old form served 50 here
    expect(row.signals).not.toBe(50);
    expect(row.signals).not.toBe(0);
    expect(row.trades).toBe(50);      // still available, under its own name
  });

  it('reports a trade rate of NULL when the run produced no trades, never a borrowed number', async () => {
    const prisma = summaryPrisma(run('r-empty', { totalTrades: 0, winRate: 1 }), []);
    const row = (await svc(prisma).getSummary('XAUUSD')).runs[0];

    expect(row.tradeWinRatePct).toBeNull(); // NOT the 100% signal rate
    expect(row.tradeWinRatePct).not.toBe(100);
    expect(row.signalWinRatePct).toBe(100);
  });
});

