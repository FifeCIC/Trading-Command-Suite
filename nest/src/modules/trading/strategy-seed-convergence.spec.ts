/**
 * Seed convergence — the guard for #833.
 *
 * ⚠️ THE DEFECT THIS LOCKS OUT. `seedDefaults()` was CREATE-ONLY: any bot that already existed
 * was `continue`d past. So the seeder could initialise a database and never repair one, and:
 *
 *   • a seed edit had no effect on a live bot (correcting four sizes and five modes needed
 *     13 hand-made PATCH calls);
 *   • a deliberately wrong value SURVIVED a re-seed — reproduced live with
 *     `Gold Swing 1H baseSize = 0.99` returning `{"created":0,"skipped":27}`;
 *   • 8 FX session bots exist only in the database and had no re-seed path at all.
 *
 * The seed file is the durable artefact; the database is not. So "the row exists" must write, not
 * skip — which is what these tests assert. Reverting to create-only fails them.
 *
 * The `active` tests are the other half and they encode a deliberate asymmetry: a seed that
 * DECLARES `active` is obeyed, and a seed that omits it must not resurrect a bot an operator
 * switched off. Getting that backwards would start trading a bot somebody had stopped.
 */
import { TradingStrategyService } from './trading-strategy.service';

const SEEDED = {
  name: 'Gold Swing 1H',
  symbol: 'XAUUSD',
  protocolId: 'xau-speed-1h',
  brokerId: 'mt5',
  mode: 'semi-auto',
  timeframe: '1h',
  baseSize: 0.02,
  slPct: 1.5,
  tpPct: 3.0,
  minComposite: 9,
  sessionWindow: null,
  maxHoldHours: 72,
};

function harness(opts?: {
  existing?: Record<string, unknown> | null;
  subscription?: Record<string, unknown> | null;
}) {
  const calls = {
    update: [] as any[],
    create: [] as any[],
    subCreate: [] as any[],
    subUpdate: [] as any[],
  };

  const prisma: any = {
    isAvailable: true,
    tradingStrategy: {
      findFirst: jest.fn(async () => opts?.existing ?? null),
      update: jest.fn(async (a: any) => {
        calls.update.push(a);
        return a;
      }),
      create: jest.fn(async (a: any) => {
        calls.create.push(a);
        return { id: 'new-bot-id', ...a.data };
      }),
    },
    scoringStrategy: {
      findFirst: jest.fn(async () => ({ id: 'scoring-1' })),
      create: jest.fn(async (a: any) => ({ id: 'scoring-new', ...a.data })),
    },
    strategyProtocol: {
      findFirst: jest.fn(async () => opts?.subscription ?? null),
      create: jest.fn(async (a: any) => {
        calls.subCreate.push(a);
        return { id: 'sub-1', ...a.data };
      }),
      update: jest.fn(async (a: any) => {
        calls.subUpdate.push(a);
        return a;
      }),
    },
  };

  // Instantiate the prototype directly: this exercises the real method body without standing up
  // the whole Nest DI graph, which would test the wiring rather than the behaviour.
  const svc: any = Object.create(TradingStrategyService.prototype);
  svc.prisma = prisma;
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  return { svc, calls, prisma };
}

/** A stored row that ALREADY matches the seed in every declared field. */
const MATCHING_ROW = {
  id: 'bot-1',
  name: SEEDED.name,
  symbol: SEEDED.symbol,
  protocolId: SEEDED.protocolId,
  brokerId: SEEDED.brokerId,
  mode: SEEDED.mode,
  timeframe: SEEDED.timeframe,
  baseSize: 0.02,
  slPct: 1.5,
  tpPct: 3.0,
  minComposite: 9,
  sessionWindow: null,
  requireDirection: null,
  maxHoldHours: 72,
  active: true,
};

describe('seedDefaults — CONVERGENCE (#833)', () => {
  it('UPDATES an existing bot whose size drifted, instead of skipping it', async () => {
    const { svc, calls } = harness({
      existing: { ...MATCHING_ROW, baseSize: 0.05 }, // the real drift found on 2026-09-22
      subscription: { id: 'sub-1', role: 'long' },
    });

    const r = await svc.seedDefaults([SEEDED]);

    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].data.baseSize).toBe(0.02);
    expect(r.updated).toBe(1);
    expect(r.created).toBe(0);
    expect(r.changes[0].fields).toContain('baseSize');
  });

  it('writes NOTHING when the row already matches, and reports it as unchanged', async () => {
    const { svc, calls } = harness({
      existing: MATCHING_ROW,
      subscription: { id: 'sub-1', role: 'long' },
    });

    const r = await svc.seedDefaults([SEEDED]);

    expect(calls.update).toHaveLength(0);
    expect(r.unchanged).toBe(1);
    expect(r.updated).toBe(0);
  });

  it('does not flap on a numeric string vs a number (would rewrite every run)', async () => {
    const { svc, calls } = harness({
      existing: { ...MATCHING_ROW, baseSize: '0.02' },
      subscription: { id: 'sub-1', role: 'long' },
    });

    await svc.seedDefaults([SEEDED]);

    expect(calls.update).toHaveLength(0);
  });
});

describe('seedDefaults — `active` is converged only when DECLARED', () => {
  it('does NOT re-enable a bot the operator switched off (seed omits active)', async () => {
    const { svc, calls } = harness({
      existing: { ...MATCHING_ROW, active: false },
      subscription: { id: 'sub-1', role: 'long' },
    });

    await svc.seedDefaults([SEEDED]); // SEEDED declares no `active`

    // Either no write at all, or a write that deliberately omits `active`.
    for (const u of calls.update) expect(u.data).not.toHaveProperty('active');
    expect(calls.update.every((u: any) => !('active' in u.data))).toBe(true);
  });

  it('DOES apply a declared active:false (the A/B control bot case)', async () => {
    const { svc, calls } = harness({
      existing: { ...MATCHING_ROW, active: true },
      subscription: { id: 'sub-1', role: 'long' },
    });

    await svc.seedDefaults([{ ...SEEDED, active: false }]);

    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].data.active).toBe(false);
  });
});

describe('seedDefaults — queue routing is repaired, not left dead', () => {
  it('creates the MISSING `strategy_protocol` row (a bot without one can never trade)', async () => {
    const { svc, calls } = harness({
      existing: MATCHING_ROW,
      subscription: null, // lost its subscription — invisible in the bot queue, never trades
    });

    const r = await svc.seedDefaults([SEEDED]);

    expect(calls.subCreate).toHaveLength(1);
    expect(calls.subCreate[0].data.protocolId).toBe(SEEDED.protocolId);
    expect(r.subscriptionsRepaired).toBe(1);
  });

  it('corrects a subscription whose role is wrong', async () => {
    const { svc, calls } = harness({
      existing: MATCHING_ROW,
      subscription: { id: 'sub-1', role: 'long' },
    });

    const r = await svc.seedDefaults([{ ...SEEDED, requireDirection: 'SELL' }]);

    expect(calls.subUpdate).toHaveLength(1);
    expect(r.rolesCorrected).toBe(1);
  });

  it('leaves a correct subscription and role alone', async () => {
    const { svc, calls } = harness({
      existing: MATCHING_ROW,
      subscription: { id: 'sub-1', role: 'long' },
    });

    const r = await svc.seedDefaults([SEEDED]);

    expect(calls.subCreate).toHaveLength(0);
    expect(calls.subUpdate).toHaveLength(0);
    expect(r.subscriptionsRepaired).toBe(0);
    expect(r.rolesCorrected).toBe(0);
  });
});

describe('seedDefaults — an ABSENT optional field means "no opinion", never "set to null"', () => {
  /**
   * 🛑 THIS IS THE 2026-09-23 REGRESSION, TESTED.
   *
   * The first version of the convergence fix wrote `maxHoldHours: (s.maxHoldHours ?? null)` for
   * every bot. The seeder declares it for the FX session bots but OMITS it for the gold bots — so
   * the first live re-seed wrote `null` over four gold time-stops (72h/120h/4h/24h) and Tokyo
   * USDJPY's (12h), silently removing the slot-releasing control #773 exists to provide. The same
   * run flipped five bots `auto` → `semi-auto`, which stops them dispatching entirely.
   *
   * Neither was caught by a test at the time — they were caught by re-reading the rows. These
   * tests exist so the next person cannot repeat it.
   */
  const withoutMaxHold = { ...SEEDED, maxHoldHours: undefined };

  it('does NOT clear maxHoldHours when the seed entry omits it', async () => {
    const { svc, calls } = harness({
      existing: { ...MATCHING_ROW, maxHoldHours: 72 },
      subscription: { id: 'sub-1', role: 'long' },
    });

    await svc.seedDefaults([withoutMaxHold]);

    for (const u of calls.update) expect(u.data).not.toHaveProperty('maxHoldHours');
    expect(calls.update.every((u: any) => !('maxHoldHours' in u.data))).toBe(true);
  });

  it('DOES converge maxHoldHours when the seed declares it (the FX session bots)', async () => {
    const { svc, calls } = harness({
      existing: { ...MATCHING_ROW, maxHoldHours: null }, // drifted to null on the live run
      subscription: { id: 'sub-1', role: 'long' },
    });

    const r = await svc.seedDefaults([{ ...SEEDED, maxHoldHours: 12 }]);

    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].data.maxHoldHours).toBe(12);
    expect(r.changes[0].fields).toContain('maxHoldHours');
  });

  it('does NOT clear sessionWindow when the seed entry omits it', async () => {
    const { svc, calls } = harness({
      existing: { ...MATCHING_ROW, sessionWindow: '["london"]' },
      subscription: { id: 'sub-1', role: 'long' },
    });

    const noWindow: any = { ...SEEDED };
    delete noWindow.sessionWindow;

    await svc.seedDefaults([noWindow]);

    expect(calls.update.every((u: any) => !('sessionWindow' in u.data))).toBe(true);
  });

  it('DOES clear sessionWindow when the seed declares null explicitly', async () => {
    const { svc, calls } = harness({
      existing: { ...MATCHING_ROW, sessionWindow: '["london"]' },
      subscription: { id: 'sub-1', role: 'long' },
    });

    await svc.seedDefaults([{ ...SEEDED, sessionWindow: null }]);

    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].data.sessionWindow).toBeNull();
  });
});

describe('seedDefaults — an unavailable database is not a successful seed', () => {
  it('reports the rows as FAILED, never as unchanged or skipped', async () => {
    const { svc, prisma } = harness();
    prisma.isAvailable = false;

    const r = await svc.seedDefaults([SEEDED]);

    expect(r.failed).toBe(1);
    expect(r.unchanged).toBe(0);
    expect(r.created).toBe(0);
    expect(r.updated).toBe(0);
  });
});
