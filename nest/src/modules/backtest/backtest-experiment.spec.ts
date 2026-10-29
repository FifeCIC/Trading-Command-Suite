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
  resolveExperiment(id?: string | null): Promise<{ id: string; iteration: number } | null>;
  currentConfigVersion(protocolId: string): Promise<number | null>;
};

function prismaStub(over: Record<string, any> = {}) {
  return {
    backtestExperiment: {
      findUnique: jest.fn(async () => ({ id: 'exp-1', status: 'running' })),
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
    ...over,
  };
}

describe('resolveExperiment — the iteration is derived, not trusted', () => {
  it('returns null when no experiment was asked for (a one-off run)', async () => {
    expect(await priv(svc(prismaStub())).resolveExperiment(undefined)).toBeNull();
    expect(await priv(svc(prismaStub())).resolveExperiment(null)).toBeNull();
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
    expect(await priv(svc(prismaStub())).currentConfigVersion('btc-speed-v1')).toBe(0);
  });

  it('reads the latest recorded version', async () => {
    const prisma = prismaStub();
    prisma.protocolDirectiveChange.aggregate = jest.fn(async () => ({ _max: { configVersion: 7 } }));
    expect(await priv(svc(prisma)).currentConfigVersion('btc-speed-v1')).toBe(7);
  });

  it('returns null (NOT RECORDED) when the log cannot be read, rather than inventing 0', async () => {
    const prisma = prismaStub();
    prisma.protocolDirectiveChange.aggregate = jest.fn(async () => {
      throw new Error('table missing');
    });
    expect(await priv(svc(prisma)).currentConfigVersion('btc-speed-v1')).toBeNull();
  });
});

describe('experiments — create and close', () => {
  it('refuses an experiment with no protocol or no label', async () => {
    const s = svc(prismaStub());
    await expect(s.createExperiment({ label: 'x' })).rejects.toThrow(/protocolId/);
    await expect(s.createExperiment({ protocolId: 'btc-speed-v1' })).rejects.toThrow(/label/);
  });

  it('stores the goal and window, because they are the termination condition', async () => {
    const prisma = prismaStub();
    const s = svc(prisma);
    await s.createExperiment({
      protocolId: 'btc-speed-v1',
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
