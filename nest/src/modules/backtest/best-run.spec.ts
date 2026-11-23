/**
 * best-run.spec.ts — the guards on the BEST-RESULT record.
 *
 * The record exists so a tuning loop cannot "improve" its way below a result it already set. That
 * only works if the BASIS cannot be fooled, so the load-bearing cases here are:
 *
 *   · a run measuring MORE days with the same total must NOT replace the record (it improved nothing
 *     except its own denominator);
 *   · a zero-day run must be refused, not divided into `Infinity` — an infinite record can never be
 *     beaten, which would silently end the mechanism it is part of;
 *   · a record written under older execution semantics must be REPLACED rather than compared, since a
 *     delta between two different rule sets is arithmetic wearing a result's clothes;
 *   · a failed write must be reported, never thrown — the run produced real numbers and must not be
 *     failed by the bookkeeping beside it.
 */
import { BestRunService, bestProfileKey, perDayOf } from './best-run.service';
import { EXECUTION_SEMANTICS } from '../../common/trading/execution-semantics';

type Row = Record<string, any>;

/** A tiny in-memory `backtestBest` that behaves like the Prisma model for the calls used here. */
function fakePrisma(seed: Row[] = [], opts: { failWrite?: boolean; failRead?: boolean } = {}) {
  const rows: Row[] = seed.map((r) => ({ ...r }));
  const key = (w: Row) => `${w.scope}::${w.profileKey}`;
  const api = {
    findUnique: async ({ where }: any) => {
      if (opts.failRead) throw new Error('read exploded');
      const k = key(where.scope_profileKey);
      const row = rows.find((r) => key(r) === k);
      return row ? { ...row } : null;
    },
    findMany: async ({ where }: any) =>
      rows.filter((r) => r.scope === where.scope).map((r) => ({ ...r })),
    upsert: async ({ where, create, update }: any) => {
      if (opts.failWrite) throw new Error('write exploded');
      const k = key(where.scope_profileKey);
      const idx = rows.findIndex((r) => key(r) === k);
      if (idx === -1) {
        const row = { id: `id-${rows.length}`, attempts: 1, ...create };
        rows.push(row);
        return { ...row };
      }
      const merged = { ...rows[idx], ...update };
      if (update.attempts?.increment) merged.attempts = rows[idx].attempts + update.attempts.increment;
      rows[idx] = merged;
      return { ...merged };
    },
    update: async ({ where, data }: any) => {
      if (opts.failWrite) throw new Error('write exploded');
      const k = key(where.scope_profileKey);
      const idx = rows.findIndex((r) => key(r) === k);
      if (idx === -1) throw new Error('record not found');
      rows[idx] = { ...rows[idx], attempts: rows[idx].attempts + (data.attempts?.increment ?? 0) };
      return { ...rows[idx] };
    },
  };
  return { prisma: { backtestBest: api } as any, rows };
}

const candidate = (over: Partial<Parameters<BestRunService['consider']>[0]> = {}) => ({
  scope: 'movers-selection' as const,
  profileKey: bestProfileKey(['movers-v1-long', 'long', 'top1', '15:30']),
  label: 'Movers long · top 1 · 15:30',
  netPnl: 500,
  days: 5,
  trades: 20,
  wins: 9,
  winRate: 45,
  profitFactor: 1.2,
  config: [{ id: 'slPct', value: 5, applied: true }],
  runId: 'run-1',
  engineVersion: '0.172.1',
  ...over,
});

describe('perDayOf — the basis, and why it is not the raw total', () => {
  it('divides by the measured days', () => {
    expect(perDayOf(500, 5)).toBe(100);
    expect(perDayOf(-250, 5)).toBe(-50);
  });

  it('refuses zero days rather than returning Infinity', () => {
    expect(perDayOf(500, 0)).toBeNull();
    expect(perDayOf(500, -1)).toBeNull();
    expect(perDayOf(Number.NaN, 5)).toBeNull();
  });
});

describe('BestRunService.consider', () => {
  it('records the first run without claiming an improvement', async () => {
    const { prisma } = fakePrisma();
    const service = new BestRunService(prisma);

    const result = await service.consider(candidate());

    expect(result.improved).toBe(false);
    expect(result.previous).toBeNull();
    expect(result.best?.perDay).toBe(100);
    expect(result.best?.netPnl).toBe(500);
    expect(result.because).toContain('first record');
  });

  it('replaces the record when net P/L per day is higher', async () => {
    const { prisma } = fakePrisma();
    const service = new BestRunService(prisma);
    await service.consider(candidate());

    const result = await service.consider(candidate({ netPnl: 900, days: 5, runId: 'run-2' }));

    expect(result.improved).toBe(true);
    expect(result.best?.perDay).toBe(180);
    expect(result.previous?.perDay).toBe(100);
  });

  /**
   * ⚠️ THE CANARY FOR THE WHOLE DESIGN. 500 over 5 days is 100/day; 600 over 10 days is 60/day. The
   * raw total went UP and the record must NOT move — if this ever fails, the record is comparing two
   * numbers on different bases and will drift toward whichever run measured the most days.
   */
  it('does NOT replace the record when a bigger total came from more days', async () => {
    const { prisma } = fakePrisma();
    const service = new BestRunService(prisma);
    await service.consider(candidate({ netPnl: 500, days: 5 }));

    const result = await service.consider(candidate({ netPnl: 600, days: 10 }));

    expect(result.improved).toBe(false);
    expect(result.best?.perDay).toBe(100);
    expect(result.best?.netPnl).toBe(500);
    expect(result.because).toContain('no improvement');
  });

  it('counts an attempt that did not beat the record, so "unchanged" is not "not run"', async () => {
    const { prisma, rows } = fakePrisma();
    const service = new BestRunService(prisma);
    await service.consider(candidate({ netPnl: 500, days: 5 })); // 100/day — the record
    await service.consider(candidate({ netPnl: 490, days: 5 })); // 98/day — worse
    await service.consider(candidate({ netPnl: 495, days: 5 })); // 99/day — worse

    expect(rows[0].attempts).toBe(3);
    expect(rows[0].perDay).toBe(100);
  });

  it('refuses a zero-day run instead of recording an unbeatable Infinity', async () => {
    const { prisma, rows } = fakePrisma();
    const service = new BestRunService(prisma);

    const result = await service.consider(candidate({ days: 0 }));

    expect(result.best).toBeNull();
    expect(result.improved).toBe(false);
    expect(rows).toHaveLength(0);
    expect(result.because).toContain('undefined');
  });

  it('replaces a record set under different execution semantics rather than comparing it', async () => {
    const { prisma } = fakePrisma([
      {
        scope: 'movers-selection',
        profileKey: bestProfileKey(['movers-v1-long', 'long', 'top1', '15:30']),
        label: 'old',
        perDay: 10_000,
        netPnl: 50_000,
        days: 5,
        trades: 20,
        wins: 9,
        winRate: 45,
        profitFactor: 1.1,
        configJson: null,
        runId: 'legacy',
        // A version that predates the current one: its number measured different rules.
        semanticsVersion: EXECUTION_SEMANTICS - 1,
        engineVersion: '0.100.0',
        achievedAt: new Date('2026-01-01T00:00:00Z'),
        attempts: 4,
      },
    ]);
    const service = new BestRunService(prisma);

    const result = await service.consider(candidate({ netPnl: 50, days: 5 }));

    expect(result.improved).toBe(true);
    expect(result.best?.perDay).toBe(10);
    expect(result.previous?.perDay).toBe(10_000);
  });

  it('reports a failed write instead of failing the run that produced the numbers', async () => {
    const { prisma } = fakePrisma([], { failWrite: true });
    const service = new BestRunService(prisma);

    const result = await service.consider(candidate());

    expect(result.improved).toBe(false);
    expect(result.because).toContain('could not be stored');
    expect(result.because).toContain('100.00 per day');
  });

  it('continues when the record cannot be READ, treating it as absent rather than as a best', async () => {
    const { prisma } = fakePrisma([], { failRead: true });
    const service = new BestRunService(prisma);

    const result = await service.consider(candidate());

    // The run continues and the record is written; `previous` is null because nothing was seen, which
    // is the honest report rather than a fabricated comparison against a record we could not read.
    expect(result.previous).toBeNull();
    expect(result.best?.perDay).toBe(100);
  });

  it('says the record could not be stored when neither the read nor the write lands', async () => {
    const { prisma } = fakePrisma([], { failRead: true, failWrite: true });
    const service = new BestRunService(prisma);

    const result = await service.consider(candidate());

    expect(result.best).toBeNull();
    expect(result.because).toContain('could not be stored');
  });
});

describe('bestProfileKey', () => {
  it('is stable for the same test and differs when a setting-bearing part differs', () => {
    const a = bestProfileKey(['p', 'long', 'top1', '15:30']);
    const b = bestProfileKey(['p', 'long', 'top1', '15:30']);
    const c = bestProfileKey(['p', 'short', 'top1', '15:30']);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('treats a missing bot as its own case rather than as the empty string', () => {
    expect(bestProfileKey(['p', null])).not.toBe(bestProfileKey(['p', '']));
  });
});
