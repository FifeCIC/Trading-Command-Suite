/**
 * BacktestPeriodService — the captured-window contract (#986).
 * ============================================================
 *
 * WHAT THIS GUARDS, and why each one is a test rather than a sentence in a comment:
 *
 *   1. **Idempotency, asserted on the ARITHMETIC.** The acceptance criterion is "bars import ...
 *      idempotently (assert row counts before and after a re-run)". So `summariseImport` is pinned
 *      directly: a second identical import must report `inserted: 0`. That number is what the
 *      criterion asks for, so it is the number the guard checks.
 *   2. **Three outcomes that must not collapse into one.** `no-bars` (the provider answered and the
 *      window is empty) is a FINDING; `provider-unavailable` (nothing answered) means we do not know
 *      whether bars exist; `imported` is a success. The reported defect class in this repo is
 *      "plausible output, no error" — and an import that found nothing returning a tidy
 *      `{ inserted: 0 }` with no outcome IS that defect. Each is asserted separately.
 *   3. **A provider that cannot target a past window is SKIPPED, not asked.** `getCandles()` is
 *      limit-based and walks BACK from the newest bar. Falling back to it would "succeed" while
 *      capturing the wrong dates — the failure mode is invisible in the output, so it needs a test.
 *   4. **A window that is not fully covered is REPORTED as truncated.** Yahoo caps intraday history,
 *      so a request past the cap returns the servable part WITH NO ERROR. A 2-day capture silently
 *      becoming a 1-day capture still looks like a result.
 *
 * A guard that has never been observed to fail is a decoration — each was canaried in both
 * directions when written (see the issue comment for the observed failures).
 */
import { BacktestPeriodService, summariseImport } from './backtest-period.service';

/**
 * The health standard the service now reads. Stubbed at the DECLARED DEFAULTS
 * (`backtest.periodMinCoveragePct` 90, `backtest.periodMaxHoleMinutes` 120) so a spec exercises the
 * same rule the app runs, rather than a number invented in the test.
 */
const settingsStub = (over = {}) => ({
  get: async (key) => ({
    'backtest.periodMinCoveragePct': 90,
    'backtest.periodMaxHoleMinutes': 120,
    ...over,
  }[key]),
});

import { BadRequestException, NotFoundException } from '@nestjs/common';

// ── Pure arithmetic: the idempotency claim, testable with no database ────────────────────────

describe('summariseImport — idempotency, on the numbers the criterion asks for (#986)', () => {
  it('a FIRST import reports every fetched bar as inserted', () => {
    const s = summariseImport({ fetched: 2880, barsBefore: 0, barsAfter: 2880 });
    expect(s.inserted).toBe(2880);
    expect(s.alreadyPresent).toBe(0);
    expect(s.lostRows).toBe(0);
  });

  it('⚠️ a RE-RUN of the same import reports inserted: 0 — the idempotency assertion', () => {
    // The window already holds exactly what the provider returns, so the before/after counts are
    // equal. This is the criterion's "assert row counts before and after a re-run".
    const s = summariseImport({ fetched: 2880, barsBefore: 2880, barsAfter: 2880 });
    expect(s.inserted).toBe(0);
    expect(s.alreadyPresent).toBe(2880);
    expect(s.lostRows).toBe(0);
  });

  it('a PARTIAL overlap reports both numbers rather than a single ambiguous one', () => {
    const s = summariseImport({ fetched: 500, barsBefore: 300, barsAfter: 500 });
    expect(s.inserted).toBe(200);
    expect(s.alreadyPresent).toBe(300);
  });

  it('⚠️ rows that DISAPPEAR are reported as lost, never smoothed into a passing import', () => {
    // Nothing in this service deletes. A negative delta can only be a concurrent prune or a bug,
    // and reporting `inserted: 0` here would hide it behind a plausible number.
    const s = summariseImport({ fetched: 100, barsBefore: 100, barsAfter: 90 });
    expect(s.inserted).toBe(-10);
    expect(s.lostRows).toBe(10);
  });
});

// ── Harness ─────────────────────────────────────────────────────────────────────────────────

type AdapterStub = {
  id: string;
  getCandlesRange?: (symbol: string, timeframe: string, from: Date, to: Date) => Promise<any[] | null>;
};

/**
 * A prisma double covering only the calls the service makes.
 * `bars` is the marketbar table as a mutable array, so a SECOND import genuinely re-counts.
 */
function mockPrisma(opts: {
  period: any;
  symbol: any;
  bars?: Array<{ symbolId: string; timeframe: string; timestamp: Date; provider: string }>;
  runsUsingPeriod?: number;
}) {
  const bars = opts.bars ?? [];
  const created: any[] = [];
  const updated: any[] = [];

  const inSpan = (w: any) =>
    bars.filter(
      (b) =>
        b.symbolId === w.symbolId &&
        b.timeframe === w.timeframe &&
        b.timestamp >= w.timestamp.gte &&
        b.timestamp <= w.timestamp.lte,
    );

  return {
    _bars: bars,
    _created: created,
    _updated: updated,
    backtestPeriod: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: 'per-1', provider: null, barCount: null, ...data };
        created.push(row);
        return row;
      }),
      findUnique: jest.fn(async () => opts.period),
      update: jest.fn(async ({ data }: any) => {
        updated.push(data);
        Object.assign(opts.period, data);
        return opts.period;
      }),
      delete: jest.fn(async () => ({})),
    },
    symbol: {
      // Distinguishes the by-ticker lookup from the by-id lookup.
      findUnique: jest.fn(async ({ where }: any) =>
        where.ticker !== undefined ? opts.symbol : opts.symbol,
      ),
      create: jest.fn(async ({ data }: any) => ({ id: 'sym-new', ...data })),
    },
    marketBar: {
      count: jest.fn(async ({ where }: any) => inSpan(where).length),
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        const rows = inSpan(where).sort((a, b) =>
          orderBy.timestamp === 'asc'
            ? a.timestamp.getTime() - b.timestamp.getTime()
            : b.timestamp.getTime() - a.timestamp.getTime(),
        );
        return rows[0] ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        const seen = new Set<string>();
        return inSpan(where).filter((b) => {
          if (seen.has(b.provider)) return false;
          seen.add(b.provider);
          return true;
        });
      }),
      createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
        let count = 0;
        for (const d of data) {
          const exists = bars.some(
            (b) =>
              b.symbolId === d.symbolId &&
              b.timeframe === d.timeframe &&
              b.timestamp.getTime() === d.timestamp.getTime(),
          );
          if (exists) {
            // INSERT IGNORE — the unique key is (symbolId, timeframe, timestamp).
            if (!skipDuplicates) throw new Error('duplicate');
            continue;
          }
          bars.push(d);
          count++;
        }
        return { count };
      }),
    },
    backtestRun: {
      count: jest.fn(async () => opts.runsUsingPeriod ?? 0),
      updateMany: jest.fn(async () => ({ count: opts.runsUsingPeriod ?? 0 })),
    },
  } as any;
}

/** AdapterFactory double — only `yahoo` is configured, and only with what the test wants. */
function mockAdapters(stubs: Record<string, AdapterStub | null>) {
  return { create: (id: string) => stubs[id] ?? null } as any;
}

const PERIOD = {
  id: 'per-1',
  name: 'Greenland Mining surge',
  note: 'Trump signs the deal — 2 days',
  symbolId: 'sym-1',
  timeframe: '5m',
  fromDate: new Date('2026-03-11T00:00:00Z'),
  toDate: new Date('2026-03-13T00:00:00Z'),
  provider: null,
  barCount: null,
};

const SYMBOL = { id: 'sym-1', ticker: 'GML', name: 'Greenland Mining', aliases: {} };

/** 5-minute bars across the period window, starting at `fromDate`. */
function barsFor(count: number, start = '2026-03-11T00:00:00Z') {
  const t0 = new Date(start).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(t0 + i * 300_000),
    open: 10 + i, high: 11 + i, low: 9 + i, close: 10.5 + i, volume: 1000,
  }));
}

// ── create(): the named, noted object ───────────────────────────────────────────────────────

describe('BacktestPeriodService.create — a window that says why it mattered (#986)', () => {
  it('stores name, note, symbol, timeframe and both ends', async () => {
    const prisma = mockPrisma({ period: PERIOD, symbol: SYMBOL });
    const svc = new BacktestPeriodService(prisma, mockAdapters({}), settingsStub());

    const out: any = await svc.create({
      name: '  Greenland Mining surge  ',
      note: '  Trump signs the deal — 2 days  ',
      symbol: 'gml',
      timeframe: '5m',
      from: '2026-03-11T00:00:00Z',
      to: '2026-03-13T00:00:00Z',
    });

    const data = prisma._created[0];
    expect(data.name).toBe('Greenland Mining surge');   // trimmed
    expect(data.note).toBe('Trump signs the deal — 2 days');
    expect(data.symbolId).toBe('sym-1');
    expect(data.timeframe).toBe('5m');
    expect(data.fromDate.toISOString()).toBe('2026-03-11T00:00:00.000Z');
    expect(data.toDate.toISOString()).toBe('2026-03-13T00:00:00.000Z');
    expect(out.symbolRegistered).toBe(false);
  });

  it('refuses a blank name — the name is how the window is found again', async () => {
    const prisma = mockPrisma({ period: PERIOD, symbol: SYMBOL });
    const svc = new BacktestPeriodService(prisma, mockAdapters({}), settingsStub());
    await expect(
      svc.create({ name: '   ', symbol: 'GML', timeframe: '5m', from: '2026-03-11', to: '2026-03-13' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses an inverted window rather than storing a negative span', async () => {
    const prisma = mockPrisma({ period: PERIOD, symbol: SYMBOL });
    const svc = new BacktestPeriodService(prisma, mockAdapters({}), settingsStub());
    await expect(
      svc.create({
        name: 'backwards', symbol: 'GML', timeframe: '5m',
        from: '2026-03-13T00:00:00Z', to: '2026-03-11T00:00:00Z',
      }),
    ).rejects.toThrow(/must be BEFORE/);
  });

  it('refuses an unparseable date instead of letting Date guess', async () => {
    const prisma = mockPrisma({ period: PERIOD, symbol: SYMBOL });
    const svc = new BacktestPeriodService(prisma, mockAdapters({}), settingsStub());
    await expect(
      svc.create({ name: 'x', symbol: 'GML', timeframe: '5m', from: 'last tuesday', to: '2026-03-13' }),
    ).rejects.toThrow(/not a valid date/);
  });

  it('REGISTERS an unknown ticker and reports that it did', async () => {
    const prisma = mockPrisma({ period: PERIOD, symbol: null });
    const svc = new BacktestPeriodService(prisma, mockAdapters({}), settingsStub());

    const out: any = await svc.create({
      name: 'GML surge', symbol: 'GML', timeframe: '5m',
      from: '2026-03-11T00:00:00Z', to: '2026-03-13T00:00:00Z',
      symbolName: 'Greenland Mining', symbolType: 'stock',
    });

    expect(prisma.symbol.create).toHaveBeenCalledTimes(1);
    expect(out.symbolRegistered).toBe(true);
    // ⚠️ Reported, never silently true: a registered symbol is a DATABASE-ONLY row with no seeder,
    // so the caller has to be able to see that it happened.
    expect(prisma._created[0].symbolId).toBe('sym-new');
  });

  it('can be told NOT to register, and then refuses — no silent symbol creation', async () => {
    const prisma = mockPrisma({ period: PERIOD, symbol: null });
    const svc = new BacktestPeriodService(prisma, mockAdapters({}), settingsStub());
    await expect(
      svc.create({
        name: 'x', symbol: 'NOPE', timeframe: '5m',
        from: '2026-03-11T00:00:00Z', to: '2026-03-13T00:00:00Z',
        registerSymbol: false,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.symbol.create).not.toHaveBeenCalled();
  });
});

// ── importBars(): three outcomes that must not collapse ─────────────────────────────────────

describe('BacktestPeriodService.importBars — three outcomes, never one (#986)', () => {
  it('imports and reports the counts a re-run will be judged against', async () => {
    const prisma = mockPrisma({ period: { ...PERIOD }, symbol: SYMBOL });
    const adapters = mockAdapters({
      yahoo: { id: 'yahoo', getCandlesRange: async () => barsFor(576) },
    });
    const svc = new BacktestPeriodService(prisma, adapters, settingsStub());

    const out = await svc.importBars('per-1');

    expect(out.outcome).toBe('imported');
    expect(out.provider).toBe('yahoo');
    expect(out.fetched).toBe(576);
    expect(out.inserted).toBe(576);
    expect(out.alreadyPresent).toBe(0);
    expect(out.barsAfter).toBe(576);
    expect(out.findings).toEqual([]);
  });

  it('⚠️ a RE-RUN inserts nothing — the criterion, end to end through the service', async () => {
    const prisma = mockPrisma({ period: { ...PERIOD }, symbol: SYMBOL });
    const adapters = mockAdapters({
      yahoo: { id: 'yahoo', getCandlesRange: async () => barsFor(576) },
    });
    const svc = new BacktestPeriodService(prisma, adapters, settingsStub());

    const first = await svc.importBars('per-1');
    const second = await svc.importBars('per-1');

    expect(first.inserted).toBe(576);
    expect(second.inserted).toBe(0);
    expect(second.fetched).toBe(576);
    expect(second.alreadyPresent).toBe(576);
    // The row counts the acceptance criterion names, before and after the re-run.
    expect(second.barsBefore).toBe(576);
    expect(second.barsAfter).toBe(576);
    expect(second.findings.join(' ')).toMatch(/ALREADY in MarketBar/);
  });

  it('⚠️ an EMPTY window is `no-bars`, never `imported` with a zero', async () => {
    const prisma = mockPrisma({ period: { ...PERIOD }, symbol: SYMBOL });
    const adapters = mockAdapters({
      yahoo: { id: 'yahoo', getCandlesRange: async () => [] },
    });
    const svc = new BacktestPeriodService(prisma, adapters, settingsStub());

    const out = await svc.importBars('per-1');

    expect(out.outcome).toBe('no-bars');
    expect(out.outcome).not.toBe('imported');
    expect(out.inserted).toBe(0);
    expect(out.findings.join(' ')).toMatch(/EMPTY/);
  });

  it('⚠️ a provider that does not ANSWER is `provider-unavailable`, a different claim again', async () => {
    const prisma = mockPrisma({ period: { ...PERIOD }, symbol: SYMBOL });
    const adapters = mockAdapters({
      // `null` = could not answer. That is NOT `[]` = answered, found nothing.
      yahoo: { id: 'yahoo', getCandlesRange: async () => null },
    });
    const svc = new BacktestPeriodService(prisma, adapters, settingsStub());

    const out = await svc.importBars('per-1');

    expect(out.outcome).toBe('provider-unavailable');
    expect(out.findings.join(' ')).toMatch(/NOT the same as an empty window/);
    // Nothing fetched AND nothing already present, so 0 is the true count here.
    expect(prisma._updated.at(-1)).toEqual({ barCount: 0, provider: null });
  });

  it('⚠️ NO provider answering does NOT make a window that already holds bars read as empty', async () => {
    // ⚠️ THE MEASURED DEFECT, reproduced. Observed live on XAUUSD 5m 2026-09-15 → 2026-09-16:
    //   import outcome : provider-unavailable
    //   stored barCount: 0     <- what this branch used to write, without looking at MarketBar
    //   coverage       : 289, providers=[mt5]
    // The LIST is what a human picks from, so that made a perfectly measurable window look EMPTY.
    const existing = barsFor(12).map((b) => ({
      symbolId: 'sym-1', timeframe: '5m', timestamp: b.timestamp, provider: 'mt5',
    }));
    const prisma = mockPrisma({ period: { ...PERIOD }, symbol: SYMBOL, bars: existing });
    const adapters = mockAdapters({
      yahoo: { id: 'yahoo', getCandlesRange: async () => null },
    });
    const svc = new BacktestPeriodService(prisma, adapters, settingsStub());

    const out = await svc.importBars('per-1');

    expect(out.outcome).toBe('provider-unavailable');
    // The stored count is the TABLE's count, not the import's fetched count.
    expect(prisma._updated.at(-1)).toEqual({ barCount: 12, provider: null });
    // `barCount` and `provider` answer different questions, and the null is explained rather than
    // left to read as "this window is empty".
    expect(out.findings.join(' ')).toMatch(/ALREADY HOLDS 12 bar\(s\) from \[mt5\]/);
    expect(out.barsBefore).toBe(12);
    expect(out.barsAfter).toBe(12);
  });

  it('⚠️ an adapter with NO range fetch is SKIPPED, never asked with the limit-based method', async () => {
    const prisma = mockPrisma({ period: { ...PERIOD }, symbol: SYMBOL });
    // A limit-based adapter — implementing getCandles only, which walks BACK from the newest bar.
    const limitOnly = { id: 'mt5', getCandles: jest.fn(async () => barsFor(10)) } as any;
    const adapters = mockAdapters({ yahoo: null, mt5: limitOnly });
    const svc = new BacktestPeriodService(prisma, adapters, settingsStub());

    const out = await svc.importBars('per-1');

    // ⚠️ This is the defect the test exists for: asking this adapter would have returned the most
    // recent N bars and reported a successful capture of dates it never requested.
    expect(limitOnly.getCandles).not.toHaveBeenCalled();
    expect(out.outcome).toBe('provider-unavailable');
    expect(out.attempted[0].reason).toMatch(/cannot target a past window/);
  });

  it('⚠️ reports TRUNCATION when the window is not fully covered', async () => {
    const prisma = mockPrisma({ period: { ...PERIOD }, symbol: SYMBOL });
    const adapters = mockAdapters({
      // Only the second half of the requested 2-day window came back — the silent case.
      yahoo: { id: 'yahoo', getCandlesRange: async () => barsFor(288, '2026-03-12T00:00:00Z') },
    });
    const svc = new BacktestPeriodService(prisma, adapters, settingsStub());

    const out = await svc.importBars('per-1');

    expect(out.outcome).toBe('imported');
    expect(out.coveredFrom).toBe('2026-03-12T00:00:00.000Z');
    expect(out.findings.join(' ')).toMatch(/TRUNCATED at the start/);
    expect(out.findings.join(' ')).toMatch(/WITHOUT an error/);
  });

  it('falls through to the next provider when the first cannot answer', async () => {
    const prisma = mockPrisma({ period: { ...PERIOD }, symbol: SYMBOL });
    const adapters = mockAdapters({
      yahoo: { id: 'yahoo', getCandlesRange: async () => null },
      mt5: { id: 'mt5', getCandlesRange: async () => barsFor(100) },
    });
    const svc = new BacktestPeriodService(prisma, adapters, settingsStub());

    const out = await svc.importBars('per-1');

    expect(out.outcome).toBe('imported');
    expect(out.provider).toBe('mt5');
    expect(out.attempted[0]).toMatchObject({ provider: 'yahoo' });
  });

  it('refuses a period id that does not resolve instead of importing nothing quietly', async () => {
    const prisma = mockPrisma({ period: null, symbol: SYMBOL });
    const svc = new BacktestPeriodService(prisma, mockAdapters({}), settingsStub());
    await expect(svc.importBars('missing')).rejects.toThrow(NotFoundException);
  });
});

// ── delete: the label is removable, the evidence is not ─────────────────────────────────────

describe('BacktestPeriodService.remove — a measured window is not a draft (#986)', () => {
  it('REFUSES to delete a period that runs reference, and names the count', async () => {
    const prisma = mockPrisma({ period: { ...PERIOD }, symbol: SYMBOL, runsUsingPeriod: 4 });
    const svc = new BacktestPeriodService(prisma, mockAdapters({}), settingsStub());

    await expect(svc.remove('per-1')).rejects.toThrow(/4 backtest run/);
    expect(prisma.backtestPeriod.delete).not.toHaveBeenCalled();
  });

  it('unlinks the runs when told to, rather than deleting the measurements', async () => {
    const prisma = mockPrisma({ period: { ...PERIOD }, symbol: SYMBOL, runsUsingPeriod: 4 });
    const svc = new BacktestPeriodService(prisma, mockAdapters({}), settingsStub());

    const out = await svc.remove('per-1', { cascade: true });

    // ⚠️ `periodId` goes back to NULL = "not period-scoped". The RUNS are the measurement and are
    // never deleted to tidy up a label.
    expect(prisma.backtestRun.updateMany).toHaveBeenCalledWith({
      where: { periodId: 'per-1' },
      data: { periodId: null },
    });
    expect(out).toMatchObject({ deleted: true, unlinkedRuns: 4, barsRetained: true });
  });
});
