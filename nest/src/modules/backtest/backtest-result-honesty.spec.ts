import { BacktestService } from './backtest.service';

/**
 * The READ path's honesty (#1134).
 *
 * ⚠️ WHAT THIS GUARDS, AND WHY IT NEEDED A GUARD. `formatRunResult()` — the only path a stored run
 * is ever read back through — returned literal `0` for `averageReturn10d` and `maxReturn10d`, and
 * dropped `measuredPeriod` entirely. Measured 2026-10-22 on run `a129a36a`:
 *
 *     averageReturn10d: 0   beside   totalPnl: 97699.97
 *
 * "0%" there reads as "the strategy returned nothing", which the row cannot support: `backtestrun`
 * stores no per-signal forward returns. A fabricated zero is the most expensive kind of wrong number
 * because it looks like a result — nothing throws and nothing looks empty.
 *
 * ⚠️ AND THE PERIOD. `run()` echoes `measuredPeriod`, but that field has no column, so the stored run
 * loses it — while the Backtest Lab ALWAYS reads via `GET /results/:runId`. The "Captured period"
 * line could therefore never appear. It is reconstructed here from the period row, NOT derived from
 * `startDate`: that is `bars[windowSize].timestamp`, the first SCORABLE bar, which on the measured run
 * was 2026-09-10 against a period starting 2026-09-09. Deriving the window from the dates is off by
 * exactly the warm-up, and reads as correct.
 */

function mockPrisma(opts: { run?: any; period?: any } = {}) {
  return {
    isAvailable: true,
    backtestRun: { findUnique: jest.fn(async () => opts.run ?? null) },
    backtestPeriod: { findUnique: jest.fn(async () => opts.period ?? null) },
  };
}

const svc = (prisma: any) => new BacktestService(prisma, {} as any, {} as any, {} as any);

/** A stored run shaped like a real row. `periodId` is what makes `measuredPeriod` reconstructable. */
function storedRun(overrides: Record<string, any> = {}) {
  return {
    id: 'run-1',
    symbol: { ticker: 'BTC' },
    protocolId: 'btc-speed-v1',
    timeframe: '15m',
    // ⚠️ A DAY LATER THAN THE PERIOD — the warm-up. This is the value a naive implementation uses.
    startDate: new Date('2026-09-10T00:00:00.000Z'),
    endDate: new Date('2026-10-20T00:00:00.000Z'),
    totalDays: 41,
    totalSignals: 1285,
    totalTrades: 1285,
    winRate: 0.5051,
    totalPnl: 97699.9665,
    profitFactor: 2340.383,
    sharpeRatio: 0.467,
    maxDrawdown: -99.96,
    avgTradePnl: 0.0658,
    periodId: 'period-1',
    trades: [],
    ...overrides,
  };
}

const storedPeriod = (overrides: Record<string, any> = {}) => ({
  id: 'period-1',
  name: 'dev-window-v1',
  note: 'CANONICAL DEVELOPMENT TESTING WINDOW',
  fromDate: new Date('2026-09-09T00:00:00.000Z'),
  toDate: new Date('2026-10-20T23:59:59.000Z'),
  barCount: null,
  ...overrides,
});

describe('BacktestService.getResult — a stored run must not fabricate numbers (#1134)', () => {
  it('serves NULL, not 0, for the forward returns it never stored', async () => {
    const out = await svc(mockPrisma({ run: storedRun(), period: storedPeriod() })).getResult('run-1');

    expect(out).not.toBeNull();
    // The whole point: `0` would render as "0% — flat", which is a claim this row cannot support.
    expect(out!.stats.averageReturn10d).toBeNull();
    expect(out!.stats.maxReturn10d).toBeNull();
    // Canaried in the other direction: the numbers it DOES store still come through.
    expect(out!.stats.totalPnl).toBe(97699.9665);
    expect(out!.stats.totalSignals).toBe(1285);
  });

  it('states that the per-signal rows are absent, so the empty list is not read as "no signals"', async () => {
    const out = await svc(mockPrisma({ run: storedRun(), period: storedPeriod() })).getResult('run-1');

    expect(out!.entrySignals).toEqual([]);
    // 1,285 signals counted, zero rows listed. Without this sentence those two facts collide.
    expect(out!.stats.totalSignals).toBe(1285);
    const caveat = (out!.caveats ?? []).join(' ');
    expect(caveat).toMatch(/per-signal rows are not stored/i);
    expect(caveat).toMatch(/cannot list the entry signals/i);
  });

  it('reconstructs the captured period from the PERIOD, not from the run dates', async () => {
    const out = await svc(mockPrisma({ run: storedRun(), period: storedPeriod() })).getResult('run-1');

    expect(out!.measuredPeriod).toBeDefined();
    expect(out!.measuredPeriod!.name).toBe('dev-window-v1');
    // ⚠️ THE CANARY. `startDate` is 2026-09-10; the period starts 2026-09-09. If this assertion ever
    // reads 2026-09-10, someone has "simplified" the reconstruction to use the run's own dates and
    // quietly narrowed every window by its warm-up.
    expect(out!.measuredPeriod!.from).toBe('2026-09-09');
    expect(out!.measuredPeriod!.to).toBe('2026-10-20');
  });

  it('reports the imported bar count when it has one, and NULL when it does not', async () => {
    const withoutCount = await svc(
      mockPrisma({ run: storedRun(), period: storedPeriod({ barCount: null }) }),
    ).getResult('run-1');
    expect(withoutCount!.measuredPeriod!.bars).toBeNull();

    const withCount = await svc(
      mockPrisma({ run: storedRun(), period: storedPeriod({ barCount: 2743 }) }),
    ).getResult('run-1');
    // Canaried both ways: a hardcoded 0 or a hardcoded number would fail one of these two.
    expect(withCount!.measuredPeriod!.bars).toBe(2743);
  });

  it('leaves measuredPeriod absent on a run that was never period-scoped', async () => {
    const out = await svc(
      mockPrisma({ run: storedRun({ periodId: null }), period: storedPeriod() }),
    ).getResult('run-1');

    // NULL periodId is a plain day-range run — the absence is information, not a failure.
    expect(out!.measuredPeriod).toBeUndefined();
  });
});
