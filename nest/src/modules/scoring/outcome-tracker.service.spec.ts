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
