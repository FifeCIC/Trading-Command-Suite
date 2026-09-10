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
    marketBar: { findFirst: jest.fn().mockResolvedValue({ close: 0.7215 }) },
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
    // 1000 rows = the batch size → saturation path.
    prisma.directiveOutcome.findMany.mockResolvedValue(
      Array.from({ length: 1000 }, (_, i) => pendingRow({ id: `row-${i}` })),
    );
    prisma.directiveOutcome.count.mockResolvedValue(37120);
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => undefined);

    const service = new OutcomeTrackerService(prisma as any);
    await service.computeOutcomes();

    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/batch saturated.*37120 rows pending/s);
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
