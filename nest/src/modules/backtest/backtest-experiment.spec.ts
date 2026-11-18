import { BacktestService } from './backtest.service';

/**
 * backtest-experiment.spec.ts — the provenance a tuning loop needs (#1144).
 *
 * WHY THIS EXISTS
 * ---------------
 * A run already records WHAT it measured. Nothing recorded WHY it exists, so a series of runs an agent
 * produced while adjusting one setting was an unordered pile: `pickRepeatPair` could only guess a
 * window's A and B as "oldest and newest", and "is run 7 better than run 6 of the same attempt?" had no
 * answer. These cases pin the three things that make the record trustworthy:
 *
 *   · the ITERATION is derived (`MAX + 1`), never taken from the caller — two runs both claiming
 *     "iteration 3" is exactly the ambiguity the column exists to remove;
 *   · an unknown or ABANDONED experiment REFUSES, because a run silently stored against neither is
 *     worse than an error (the persistence block swallows errors and would drop the run);
 *   · `configVersion` distinguishes "no override ever recorded" (0) from "could not read the log" (null).
 *
 * `resolveExperiment`/`currentConfigVersion` are private on purpose — they are implementation of `run()`
 * — so they are reached through a bracket cast. That is deliberate: this spec is asserting the wiring
 * INSIDE `run()`, which is the part that silently stops working if the call is removed.
 */

const svc = (prisma: any) => new BacktestService(prisma, {} as any, {} as any, {} as any);
const priv = (s: BacktestService) => s as unknown as {
  resolveExperiment(
    id?: string | null,
    protocolId?: string | null,
  ): Promise<{ id: string; iteration: number } | null>;
  currentConfigVersion(protocolId: string): Promise<number | null>;
};

function prismaStub(over: Record<string, any> = {}) {
  return {
    backtestExperiment: {
      findUnique: jest.fn(async () => ({ id: 'exp-1', status: 'running' })),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'exp-new', ...data, createdAt: new Date() })),
      findMany: jest.fn(async () => []),
      update: jest.fn(async ({ data }: any) => ({ id: 'exp-1', protocolId: 'btc', label: 'l', goal: null, windowLabel: null, status: data.status, createdBy: 'owner', createdAt: new Date() })),
    },
    backtestRun: {
      aggregate: jest.fn(async () => ({ _max: { iteration: null } })),
      count: jest.fn(async () => 0),
    },
    protocolDirectiveChange: {
      aggregate: jest.fn(async () => ({ _max: { configVersion: null } })),
    },
    // ⚠️ Default is "this protocol does not exist". Every auto-filing case has to opt IN to a real
    // protocol, so a test that forgets is caught rather than silently filing under nothing.
    protocol: {
      findFirst: jest.fn(async () => null),
    },
    ...over,
  };
}

describe('resolveExperiment — the iteration is derived, not trusted', () => {
  it('returns null when no experiment was asked for (a one-off run)', async () => {
    expect(await priv(svc(prismaStub())).resolveExperiment(undefined)).toBeNull();
    expect(await priv(svc(prismaStub())).resolveExperiment(null)).toBeNull();
  });

  /*
   * ── #1295 + the #1292 follow-up: auto-filing must never NAME A PROTOCOL THAT DOES NOT EXIST ────
   *
   * ⚠️ WHY THE 'default' CASE IS THE IMPORTANT ONE. `protocolId` arrives from the caller verbatim.
   * A caller in June 2026 sent the literal 'default' (before protocols were minted per strategy),
   * and filing it created a `backtest_experiment` row whose `protocolId` resolved to nothing. That
   * passed unnoticed until `validate-protocol-refs.cjs` failed on it — because nothing on the filing
   * path checked that the protocol existed. The run itself is fine and keeps its own protocolId; it
   * is the BUCKET that asserted a false fact.
   *
   * A bucket keyed on a non-existent protocol is unreachable by every protocol-filtered report, and
   * its label reads as though a protocol called "default" is real. Not filing is the honest answer.
   */
  it('⚠️ REFUSES to file under a protocol that does not exist — and SAYS SO', async () => {
    const prisma = prismaStub(); // protocol.findFirst -> null by default
    const service = svc(prisma);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    expect(await priv(service).resolveExperiment(undefined, 'default')).toBeNull();
    expect(prisma.backtestExperiment.create).not.toHaveBeenCalled();

    // ⚠️ THE WARNING IS THE ASSERTION THAT MATTERS. Removing the existence check also yields `null`
    // — `protocol.slug` throws on null and the catch returns null — so *outcome alone cannot tell
    // the two apart*. Measured: a canary that deleted the check left this suite GREEN. The warning
    // is what distinguishes "refused deliberately" from "crashed and got swallowed".
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('default');
  });

  it('files under a real protocol, keyed on its SLUG', async () => {
    const prisma = prismaStub();
    prisma.protocol.findFirst = jest.fn(async () => ({ slug: 'btc-speed-v1-long' }));
    prisma.backtestExperiment.findFirst = jest.fn(async () => ({ id: 'bucket-1' }));
    expect(await priv(svc(prisma)).resolveExperiment(undefined, 'btc-speed-v1-long')).toEqual({
      id: 'bucket-1',
      iteration: 1,
    });
  });

  it('accepts a protocol UUID and stores the SLUG — one bucket per protocol, not two', async () => {
    const prisma = prismaStub();
    prisma.protocol.findFirst = jest.fn(async () => ({ slug: 'btc-speed-v1-long' }));
    prisma.backtestExperiment.findFirst = jest.fn(async () => null);
    await priv(svc(prisma)).resolveExperiment(undefined, '0d5f6a10-0000-4000-8000-000000000001');
    const created = prisma.backtestExperiment.create.mock.calls[0][0].data;
    expect(created.protocolId).toBe('btc-speed-v1-long');
    expect(created.label).toContain('btc-speed-v1-long');
  });

  it('a lookup that throws leaves the run UNFILED rather than failing it', async () => {
    const prisma = prismaStub();
    prisma.protocol.findFirst = jest.fn(async () => {
      throw new Error('connection lost');
    });
    expect(await priv(svc(prisma)).resolveExperiment(undefined, 'btc-speed-v1-long')).toBeNull();
  });

  it('appoints MAX(iteration) + 1, so two runs cannot claim the same number', async () => {
    const prisma = prismaStub();
    prisma.backtestRun.aggregate = jest.fn(async () => ({ _max: { iteration: 3 } }));
    expect(await priv(svc(prisma)).resolveExperiment('exp-1')).toEqual({ id: 'exp-1', iteration: 4 });
    expect(prisma.backtestRun.aggregate).toHaveBeenCalledWith({
      where: { experimentId: 'exp-1' },
      _max: { iteration: true },
    });
  });

  it('REFUSES an unknown experiment instead of storing an orphan run', async () => {
    const prisma = prismaStub();
    prisma.backtestExperiment.findUnique = jest.fn(async () => null);
    await expect(priv(svc(prisma)).resolveExperiment('nope')).rejects.toThrow(/No backtest experiment "nope"/);
  });

  it('REFUSES an abandoned experiment — the record would imply it is still being pursued', async () => {
    const prisma = prismaStub();
    prisma.backtestExperiment.findUnique = jest.fn(async () => ({ id: 'exp-1', status: 'abandoned' }));
    await expect(priv(svc(prisma)).resolveExperiment('exp-1')).rejects.toThrow(/abandoned/);
  });

  it('accepts an experiment that is stopped or accepted — closing a loop does not erase its history', async () => {
    for (const status of ['stopped', 'accepted', 'running']) {
      const prisma = prismaStub();
      prisma.backtestExperiment.findUnique = jest.fn(async () => ({ id: 'exp-1', status }));
      await expect(priv(svc(prisma)).resolveExperiment('exp-1')).resolves.toEqual({ id: 'exp-1', iteration: 1 });
    }
  });
});

describe('currentConfigVersion — 0 is a state, null is an absence', () => {
  it('reads 0 when no override has ever been recorded', async () => {
    expect(await priv(svc(prismaStub())).currentConfigVersion('btc-speed-v1-long')).toBe(0);
  });

  it('reads the latest recorded version', async () => {
    const prisma = prismaStub();
    prisma.protocolDirectiveChange.aggregate = jest.fn(async () => ({ _max: { configVersion: 7 } }));
    expect(await priv(svc(prisma)).currentConfigVersion('btc-speed-v1-long')).toBe(7);
  });

  it('returns null (NOT RECORDED) when the log cannot be read, rather than inventing 0', async () => {
    const prisma = prismaStub();
    prisma.protocolDirectiveChange.aggregate = jest.fn(async () => {
      throw new Error('table missing');
    });
    expect(await priv(svc(prisma)).currentConfigVersion('btc-speed-v1-long')).toBeNull();
  });
});

describe('experiments — create and close', () => {
  it('refuses an experiment with no protocol or no label', async () => {
    const s = svc(prismaStub());
    await expect(s.createExperiment({ label: 'x' })).rejects.toThrow(/protocolId/);
    await expect(s.createExperiment({ protocolId: 'btc-speed-v1-long' })).rejects.toThrow(/label/);
  });

  it('stores the goal and window, because they are the termination condition', async () => {
    const prisma = prismaStub();
    const s = svc(prisma);
    await s.createExperiment({
      protocolId: 'btc-speed-v1-long',
      label: 'raise signal sum',
      goal: '+10% Σ signal % without more worsened bars',
      windowLabel: 'dev-window-v1',
    });
    const data = prisma.backtestExperiment.create.mock.calls[0][0].data;
    expect(data.goal).toBe('+10% Σ signal % without more worsened bars');
    expect(data.windowLabel).toBe('dev-window-v1');
  });

  it('accepts only the four real statuses', async () => {
    const prisma = prismaStub();
    const s = svc(prisma);
    for (const status of ['running', 'stopped', 'accepted', 'abandoned']) {
      await expect(s.setExperimentStatus('exp-1', status)).resolves.toMatchObject({ status });
    }
    await expect(s.setExperimentStatus('exp-1', 'finished')).rejects.toThrow(/status must be one of/);
  });
});
