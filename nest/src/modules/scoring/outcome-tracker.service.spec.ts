import { OutcomeTrackerService, canonicalTimeframe } from './outcome-tracker.service';

/**
 * MST-007 / #733 — the directive outcome learning loop.
 *
 * Live state before this fix (2026-09-10): 40,120 outcome rows, **zero** horizon
 * prices filled anywhere, 3,000 rows finalised with NULL data. Two causes:
 *
 *  1. `timeframe` label mismatch — 35,472 rows carried MT5-style `M15` while
 *     `MarketBar.timeframe` stores `15m`, so the equality filter never matched and
 *     every horizon matured to NULL.
 *  2. Starvation — the sweep takes the 500 oldest rows, so valid rows (correct
 *     labels, bars available) sat behind the unfillable backlog for days.
 */

function mockPrisma() {
  return {
    isAvailable: true,
    symbol: { findFirst: jest.fn().mockResolvedValue({ id: 'sym-1' }) },
    // ⚠️ `timestamp` MUST be present. #830 added it to the query select and uses it to
    // classify a resolution as on-time vs next-session; a mock returning only `{ close }`
    // is not a faithful double and previously made every horizon resolve to null.
    marketBar: {
      findFirst: jest.fn().mockResolvedValue({ close: 0.7215, timestamp: new Date() }),
    },
    directiveOutcome: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

/** A pending outcome row whose horizons are all due (predicted 30h ago). */
function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    symbol: 'AUDUSD',
    timeframe: 'M15',
    signalClass: 'bullish',
    predictedAt: new Date(Date.now() - 30 * 3600_000),
    priceAtPredict: 0.72,
    priceT15m: null,
    priceT1h: null,
    priceT4h: null,
    priceT24h: null,
    directionCorrect: null,
    ...overrides,
  };
}

describe('canonicalTimeframe', () => {
  it('maps MT5-style labels onto the MarketBar labels', () => {
    expect(canonicalTimeframe('M5')).toBe('5m');
    expect(canonicalTimeframe('M15')).toBe('15m');
    expect(canonicalTimeframe('M30')).toBe('30m');
    expect(canonicalTimeframe('H1')).toBe('1h');
    expect(canonicalTimeframe('H4')).toBe('4h');
    expect(canonicalTimeframe('D1')).toBe('1d');
  });

  it('leaves canonical labels (and casing) alone', () => {
    expect(canonicalTimeframe('15m')).toBe('15m');
    expect(canonicalTimeframe('1D')).toBe('1d');
    expect(canonicalTimeframe(' 5m ')).toBe('5m');
  });
});

describe('OutcomeTrackerService — maturation', () => {
  it('matures a legacy M15 row by querying 15m bars', async () => {
    const prisma = mockPrisma();
    prisma.directiveOutcome.findMany.mockResolvedValue([pendingRow()]);

    const service = new OutcomeTrackerService(prisma as any);
    const matured = await service.computeOutcomes();

    expect(matured).toBe(1);
    // Every lookup used the canonical label — never the raw 'M15'.
    expect(prisma.marketBar.findFirst).toHaveBeenCalledTimes(4); // T+15m/1h/4h/24h
    for (const call of prisma.marketBar.findFirst.mock.calls) {
      expect(call[0].where.timeframe).toBe('15m');
    }

    const update = prisma.directiveOutcome.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'row-1' });
    expect(update.data.priceT15m).toBe(0.7215);
    expect(update.data.priceT24h).toBe(0.7215);
    // All four filled → the row is finalised, and direction was scored at T+1h.
    expect(update.data.outcomeComputedAt).toBeInstanceOf(Date);
    expect(update.data.directionCorrect).toBe(true); // 0.7215 > 0.72, bullish
  });

  it('fills only the horizons whose due time has passed (independent maturity)', async () => {
    const prisma = mockPrisma();
    // Predicted 20h ago: T+15m/1h/4h are due, T+24h is not.
    prisma.directiveOutcome.findMany.mockResolvedValue([
      pendingRow({ predictedAt: new Date(Date.now() - 20 * 3600_000) }),
    ]);

    const service = new OutcomeTrackerService(prisma as any);
    await service.computeOutcomes();

    expect(prisma.marketBar.findFirst).toHaveBeenCalledTimes(3);
    const update = prisma.directiveOutcome.update.mock.calls[0][0];
    expect(update.data.priceT4h).toBe(0.7215);
    expect(update.data.priceT24h).toBeNull();
    // Not complete and inside the grace window → stays pending for the next sweep.
    expect(update.data.outcomeComputedAt).toBeNull();
  });

  it('finalises a row past the grace window even when horizons never fill', async () => {
    const prisma = mockPrisma();
    prisma.marketBar.findFirst.mockResolvedValue(null); // no bars for this symbol
    prisma.directiveOutcome.findMany.mockResolvedValue([
      pendingRow({ predictedAt: new Date(Date.now() - 40 * 3600_000) }),
    ]);

    const service = new OutcomeTrackerService(prisma as any);
    await service.computeOutcomes();

    const update = prisma.directiveOutcome.update.mock.calls[0][0];
    expect(update.data.outcomeComputedAt).toBeInstanceOf(Date);
  });

  it('warns when a saturated batch hides a backlog', async () => {
    const prisma = mockPrisma();
    // ⚠️ Must equal MATURATION_BATCH (250 since #828) or the saturation branch never runs.
    // The previous value of 1000 silently stopped exercising it when the batch was reduced
    // for pool health — the test kept passing its setup while asserting nothing.
    const BATCH = 250;
    prisma.directiveOutcome.findMany.mockResolvedValue(
      Array.from({ length: BATCH }, (_, i) => pendingRow({ id: `row-${i}` })),
    );
    prisma.directiveOutcome.count.mockResolvedValue(37120);
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => undefined);

    const service = new OutcomeTrackerService(prisma as any);
    // #1099 — zero the inter-pass yield: the saturated mock makes the tick drain its full
    // ceiling (6 passes), and real 5s sleeps would add ~25s and an open timer handle.
    (service as any).maturationYieldMs = 0;
    await service.computeOutcomes();

    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/batch saturated.*37120 rows pending/s);
    warn.mockRestore();
  });

  // ⚠️ GUARD (2026-11-19) — the saturation warn must not claim progress it did not make.
  //
  // Measured in production with the MT5 bridges down: one tick logged
  //   `visited 1500, filled 0, finalised 0 — backlog 42784 -> 42784`
  // and, from this branch, `drained 1500 this tick`. 1,500 rows were READ; nothing was
  // filled, nothing was finalised and the backlog did not move. A reader who trusts
  // "drained 1500" has no reason to look at the `finalised 0` beside it.
  //
  // This asserts the WORD, because the wording is the whole defect: it is the only thing a
  // human reads at 3am. The mock fills nothing, so any claim of drainage is false.
  // ⚠️ GUARD (#1312, measured 2026-11-19) — the tick's passes must walk FORWARD.
  //
  // The query is `take: 250, orderBy predictedAt ASC` and a pass writes nothing when it cannot
  // fill. Without a cursor, pass 2 asked the same question and got the same 250 rows back, so a
  // 6-pass tick "visited 1500" while covering **250 distinct rows**. Live evidence, bridges up:
  // four consecutive passes 6 s apart, each `visited 250, filled 0`, `MAX(outcomeComputedAt)`
  // frozen for 10 hours, 44,000 rows never read.
  //
  // This asserts the CALLS, because the defect was invisible in every return value: the tick
  // looked busy and its totals added up. Only the query it issued revealed the repeat.
  it('advances the cursor between passes instead of re-reading the same batch', async () => {
    const prisma = mockPrisma();
    // ⚠️ The mock must ADVANCE, or the assertion below tests the mock rather than the service.
    // A flat `mockResolvedValue` returns the same 250 rows to every pass, so `pass.last` never
    // changes and the cursor looks stuck even when the code threads it correctly. Each call
    // therefore returns a later window, exactly as the real query does.
    let call = 0;
    prisma.directiveOutcome.findMany.mockImplementation(async () => {
      call += 1;
      return Array.from({ length: 250 }, (_, i) => pendingRow({
        id: `row-${call}-${String(i).padStart(3, '0')}`,
        predictedAt: new Date(Date.now() - (48 - call) * 3600_000 - i * 1000),
      }));
    });
    prisma.directiveOutcome.count.mockResolvedValue(43692);
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'log').mockImplementation(() => undefined);

    const service = new OutcomeTrackerService(prisma as any);
    (service as any).maturationYieldMs = 0;
    await service.computeOutcomes();

    const calls = prisma.directiveOutcome.findMany.mock.calls.map((c: any[]) => c[0]);
    expect(calls.length).toBeGreaterThan(1); // a multi-pass tick, not a single sweep

    // Pass 1 has no cursor; every later pass must carry one.
    expect(calls[0].where.AND).toBeUndefined();
    const later = calls.slice(1);
    expect(later.length).toBeGreaterThan(0);
    for (const call of later) {
      expect(Array.isArray(call.where.AND)).toBe(true);
      const cursorClause = JSON.stringify(call.where.AND[1]);
      expect(cursorClause).toMatch(/"gt"/);
      expect(cursorClause).toMatch(/row-\d+/); // the id tiebreak, not just a timestamp
    }

    // …and it must MOVE, or pass 2 re-reads pass 1's rows.
    const cursors = later.map((c: any) => JSON.stringify(c.where.AND[1]));
    expect(new Set(cursors).size).toBeGreaterThan(1);

    // Each pass must inherit the PREVIOUS pass's last row — not the first pass's.
    for (let i = 0; i < later.length - 1; i += 1) {
      expect(cursors[i + 1]).not.toBe(cursors[i]);
    }

    // The order must be stable, or `gt` on a duplicate timestamp skips rows non-deterministically.
    for (const call of calls) {
      expect(JSON.stringify(call.orderBy)).toContain('id');
    }
  });

  it('does not claim rows were drained when nothing was filled or finalised', async () => {
    const prisma = mockPrisma();
    const BATCH = 250;
    prisma.directiveOutcome.findMany.mockResolvedValue(
      Array.from({ length: BATCH }, (_, i) => pendingRow({ id: `row-${i}` })),
    );
    prisma.directiveOutcome.count.mockResolvedValue(43692);
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => undefined);

    const service = new OutcomeTrackerService(prisma as any);
    (service as any).maturationYieldMs = 0;
    // ⚠️ Reproduce the PRODUCTION condition, not a comfortable one: with the MT5 bridges
    // down, `getPriceAt` finds no bar for any horizon, so every row is visited and none
    // progresses. Assuming the default mock fills nothing was WRONG — it fills everything
    // (finalised 1500 / filled 1500), which would make this test assert the opposite of the
    // state it names.
    (service as any).getPriceAt = async () => null;
    await service.computeOutcomes();

    const text = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(text).toMatch(/batch saturated/);
    // The defect was the WORD. `visited` means rows read; `finalised`/`filled` mean rows that
    // progressed. The warn must never call a visited row "drained", whatever the counters are.
    expect(text).not.toMatch(/drained/i);
    // …and it must print BOTH progress counters, so the reader can see visited ≠ progress
    // without cross-referencing the tick summary line.
    expect(text).toMatch(/visited \d+ this tick \(finalised \d+, filled \d+\)/);
    warn.mockRestore();
  });

  // ⚠️ REGRESSION GUARD (#828/#830). `Matured N` counted rows VISITED, not filled, so a
  // sweep that achieved nothing logged identically to one that filled everything. That is
  // what hid a stopped pipeline for a day. These pin the split counters, and the WARN when
  // nothing was filled.
  it('reports visited / filled / finalised separately, not one misleading total', async () => {
    const prisma = mockPrisma();
    prisma.directiveOutcome.findMany.mockResolvedValue([pendingRow()]);
    const log = jest.spyOn(require('@nestjs/common').Logger.prototype, 'log').mockImplementation(() => undefined);

    const service = new OutcomeTrackerService(prisma as any);
    await service.computeOutcomes();

    const line = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toMatch(/visited \d+/);
    expect(line).toMatch(/filled \d+/);
    expect(line).toMatch(/finalised \d+/);
    log.mockRestore();
  });

  it('logs at WARN, not LOG, when a sweep fills nothing', async () => {
    const prisma = mockPrisma();
    prisma.directiveOutcome.findMany.mockResolvedValue([pendingRow()]);
    // Every horizon lookup finds no bar → visited > 0, filled 0. A stalled queue.
    prisma.marketBar.findFirst.mockResolvedValue(null);
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => undefined);

    const service = new OutcomeTrackerService(prisma as any);
    await service.computeOutcomes();

    const line = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toMatch(/filled 0/);
    warn.mockRestore();
  });
});

describe('OutcomeTrackerService — recording', () => {
  it('stores the canonical timeframe label', async () => {
    const prisma = mockPrisma();
    const service = new OutcomeTrackerService(prisma as any);

    await service.recordOutcomes([{
      directiveId: 'rsi-oversold',
      symbol: 'AUDUSD',
      timeframe: 'M15',
      score: 55,
      signalClass: 'bullish',
      confidence: 0.6,
      predictedAt: new Date(),
      priceAtPredict: 0.72,
    }]);

    expect(prisma.directiveOutcome.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ timeframe: '15m' })],
      }),
    );
  });
});
