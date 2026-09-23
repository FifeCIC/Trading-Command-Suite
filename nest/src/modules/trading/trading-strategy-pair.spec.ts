/**
 * The A/B pair lifecycle — the guard for #963 / SETTLED-DECISIONS #25.
 *
 * ⚠️ WHAT THESE LOCK OUT. `duplicate()` has always RECORDED a pairing: the copy gets
 * `duplicatedFromId` pointing at its source, and both lineage links are preserved. But nothing ever
 * READ that back, so:
 *
 *   • an operator holding two bots had no way to see that they were a pair, or which side was the
 *     incumbent they were supposed to be changing;
 *   • activation was per-row, so one side could be switched without the other — and the owner's
 *     rule is explicit: *"ensuring they are activate/deactivated together"*;
 *   • a GROUP (two or more copies of one bot) was indistinguishable from a pair, so any tool that
 *     picked "the other bot" would silently compare the wrong two things.
 *
 * ⚠️ THE OWNER'S ERROR I MADE HERE, AND CORRECTED. I first reported that `duplicatedFromId` having
 * **0 rows** meant the pairing half was MISSING. It is not missing — it has simply never been used.
 * A row count is evidence about USAGE, not about EXISTENCE. These tests assert the mechanism that
 * already existed, plus the lifecycle that did not.
 *
 * ⚠️ CANARY (run before trusting this file). Make `getPair` return `paired: true` when more than
 * one copy exists — i.e. delete the `copies.length > 1` branch and fall through to the single-copy
 * return. The GROUP test then fails with `paired: true`, which is exactly the silent wrong-pair
 * comparison the branch exists to prevent.
 */
import { TradingStrategyService } from './trading-strategy.service';

const INCUMBENT = {
  id: 'bot-a', name: 'Gold Day-Trade M15', symbol: 'XAUUSD', active: true,
  duplicatedFromId: null, protocolId: 'xau-speed-m15', minComposite: 10,
};
const VARIANT = {
  id: 'bot-b', name: 'Gold Day-Trade M15 (copy)', symbol: 'XAUUSD', active: false,
  duplicatedFromId: 'bot-a', protocolId: 'xau-speed-m15-copy', minComposite: 10,
};

function make(opts: {
  /** The row for the bot under test — overrides the default entry for that same id. */
  bot?: any;
  /** Overrides/additions to the two-bot default world. */
  byId?: Record<string, any>;
  /** Extra bots pointing at `bot-a` — this is what decides pair vs GROUP. */
  copies?: any[];
  ceiling?: { ceilingPct: number; samples: number; slug?: string; ceilingRaw?: number; capacity?: number } | null;
  /** Registered comparisons — `ab_pair` rows. Empty means "a pair with no comparison declared". */
  pairRows?: any[];
} = {}) {
  const svc = Object.create(TradingStrategyService.prototype) as TradingStrategyService;

  // ⚠️ A LIVE view, not a frozen snapshot. `findMany` reads `rows`, so a write to one side is
  // visible to the NEXT read — which is what the database does. The first version returned a static
  // `opts.copies` array and made `getPair()` report stale state after a successful pair activation.
  const rows: Record<string, any> = {
    'bot-a': { ...INCUMBENT },
    'bot-b': { ...VARIANT },
    ...(opts.byId ?? {}),
  };
  for (const c of opts.copies ?? []) rows[c.id] = { ...c };
  if (opts.bot) rows[opts.bot.id] = { ...opts.bot };
  const pairRows: any[] = (opts.pairRows ?? []).map((p) => ({ ...p }));

  const updates: Array<{ id: string; data: any }> = [];

  (svc as any).prisma = {
    tradingStrategy: {
      findUnique: jest.fn(async (args: any) => rows[args.where.id] ?? null),
      findMany: jest.fn(async (args: any) => {
        const want = args?.where?.duplicatedFromId;
        return Object.values(rows).filter((r: any) => r.duplicatedFromId === want);
      }),
      update: jest.fn(async (args: any) => {
        updates.push({ id: args.where.id, data: args.data });
        if (args.data.active !== undefined && rows[args.where.id]) {
          rows[args.where.id] = { ...rows[args.where.id], active: args.data.active };
        }
        return rows[args.where.id] ?? args;
      }),
    },
    // ⚠️ `ab_pair`, the REGISTERED comparison (#963). Distinct from the `duplicatedFromId` link:
    // a pair can exist with no comparison ever declared (`registered: false`).
    abPair: {
      findUnique: jest.fn(async (args: any) =>
        pairRows.find((p) => p.variantId === args?.where?.variantId) ?? null,
      ),
      findFirst: jest.fn(async (args: any) => {
        const w = args?.where ?? {};
        return (
          pairRows.find((p) => {
            if (w.state && p.state !== w.state) return false;
            return (w.OR ?? []).some(
              (clause: any) =>
                (clause.incumbentId && clause.incumbentId === p.incumbentId) ||
                (clause.variantId && clause.variantId === p.variantId),
            );
          }) ?? null
        );
      }),
      create: jest.fn(async (args: any) => {
        const row = { id: `pair-${pairRows.length + 1}`, endedAt: null, ...args.data };
        pairRows.push(row);
        return row;
      }),
      update: jest.fn(async (args: any) => {
        const row = pairRows.find((p) => p.variantId === args.where.variantId);
        if (!row) throw new Error('ab_pair row not found');
        Object.assign(row, args.data);
        return row;
      }),
    },
    // Sequential apply — enough to prove the ops are issued, and that the caller reads the
    // created row out of position 2.
    $transaction: jest.fn(async (ops: any[]) => {
      const out: any[] = [];
      for (const op of ops) out.push(await op);
      return out;
    }),
  };
  (svc as any).protocolHealth = {
    measureProtocolCeiling: jest.fn(async () =>
      opts.ceiling === undefined ? { ceilingPct: 90, samples: 100, slug: 'xau-speed-m15', ceilingRaw: 90, capacity: 100 } : opts.ceiling,
    ),
  };
  (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  return { svc, updates, state: () => rows, pairs: () => pairRows };
}

describe('getPair — resolving the pairing that was recorded but never read (#963)', () => {
  it('a COPY resolves to incumbent = source, variant = itself', async () => {
    const { svc } = make({ bot: VARIANT, copies: [] });

    const pair = await svc.getPair('bot-b');

    expect(pair.paired).toBe(true);
    expect(pair.incumbent?.id).toBe('bot-a');
    expect(pair.incumbent?.name).toBe('Gold Day-Trade M15');
    expect(pair.variant?.id).toBe('bot-b');
  });

  it('the SOURCE resolves to incumbent = itself, variant = its copy', async () => {
    const { svc } = make({ bot: INCUMBENT, copies: [VARIANT] });

    const pair = await svc.getPair('bot-a');

    expect(pair.paired).toBe(true);
    expect(pair.incumbent?.id).toBe('bot-a');
    expect(pair.variant?.id).toBe('bot-b');
  });

  it('an UNPAIRED bot is not a pair — and says nothing false about it', async () => {
    // No pointer either way: the world is two independent bots, not a pair.
    const { svc } = make({ byId: { 'bot-b': { ...VARIANT, duplicatedFromId: null } }, copies: [] });

    const pair = await svc.getPair('bot-a');

    expect(pair.paired).toBe(false);
    expect(pair.incumbent).toBeNull();
    expect(pair.variant).toBeNull();
    expect(pair.reason).toBeUndefined();
  });

  it('a GROUP is NOT a pair — reported with the reason, never resolved arbitrarily', async () => {
    const third = { ...VARIANT, id: 'bot-c', name: 'Gold Day-Trade M15 (copy 2)', duplicatedFromId: 'bot-a' };
    const { svc } = make({ bot: INCUMBENT, copies: [VARIANT, third] });

    const pair = await svc.getPair('bot-a');

    // Picking "the first other bot" here would silently compare the WRONG TWO THINGS.
    expect(pair.paired).toBe(false);
    expect(pair.reason).toContain('that is a GROUP, not a pair');
    expect(pair.reason).toContain('Gold Day-Trade M15 (copy 2)');
  });

  it('DANGLING lineage is cannot-judge, not a pair with a missing side', async () => {
    const orphan = { ...VARIANT, duplicatedFromId: 'bot-deleted' };
    const { svc } = make({ byId: { 'bot-b': orphan } });

    const pair = await svc.getPair('bot-b');

    expect(pair.paired).toBe(false);
    expect(pair.reason).toContain('DANGLING');
  });

  it('CHAIN — a bot that was copied FROM and has been copied TO resolves to the NEW pair', async () => {
    // ⚠️ Owner point, 2026-09-23: *"B can be duplicated and thus becomes A in a new pair."*
    // `bot-b` is A's variant AND `bot-c`'s incumbent. The LIVE comparison is B & C — resolving to
    // the stale A & B pair would make `startPair(B)` measure the wrong thing, silently.
    const c = {
      ...VARIANT, id: 'bot-c', name: 'Gold Day-Trade M15 (copy 2)', duplicatedFromId: 'bot-b',
    };
    const { svc } = make({ byId: { 'bot-c': c } });

    const pair = await svc.getPair('bot-b');

    expect(pair.paired).toBe(true);
    expect(pair.incumbent?.id).toBe('bot-b'); // B has GRADUATED to incumbent
    expect(pair.variant?.id).toBe('bot-c');
  });

  it('CHAIN — the parent still resolves its own pair, so the older comparison stays reachable', async () => {
    const c = { ...VARIANT, id: 'bot-c', duplicatedFromId: 'bot-b' };
    const { svc } = make({ byId: { 'bot-c': c } });

    const pair = await svc.getPair('bot-a');

    expect(pair.incumbent?.id).toBe('bot-a');
    expect(pair.variant?.id).toBe('bot-b');
  });

  it('inSync reports the truth for a freshly duplicated pair (A active, B inactive)', async () => {
    const { svc } = make({ bot: VARIANT, copies: [] });

    const pair = await svc.getPair('bot-b');

    // This is the DESIGNED starting state, not a fault — which is exactly why `active` alone
    // cannot be used to infer whether a comparison is running.
    expect(pair.inSync).toBe(false);
    expect(pair.incumbent?.active).toBe(true);
    expect(pair.variant?.active).toBe(false);
  });
});

describe('setPairActive — both sides move together (#963, decision 25)', () => {
  it('ACTIVATES both sides from the designed starting state', async () => {
    const { svc, state, updates } = make({ bot: INCUMBENT, copies: [VARIANT] });

    const result = await svc.setPairActive('bot-a', true);

    expect(state()['bot-a'].active).toBe(true);
    expect(state()['bot-b'].active).toBe(true);
    expect(result.changed).toEqual(['Gold Day-Trade M15 (copy)']); // the source was already active
    expect(result.pair.inSync).toBe(true);
    // One side was already active, so exactly ONE write is correct — not two.
    expect(updates.length).toBe(1);
  });

  it('DEACTIVATES both sides together — the direction the owner named', async () => {
    const both = {
      'bot-a': { ...INCUMBENT, active: true },
      'bot-b': { ...VARIANT, active: true },
    };
    const { svc, state } = make({ bot: both['bot-a'], byId: both, copies: [both['bot-b']] });

    await svc.setPairActive('bot-a', false);

    expect(state()['bot-a'].active).toBe(false);
    expect(state()['bot-b'].active).toBe(false);
  });

  it('is a NO-OP, not a double write, when the pair is already in step', async () => {
    const both = {
      'bot-a': { ...INCUMBENT, active: true },
      'bot-b': { ...VARIANT, active: true },
    };
    const { svc, updates } = make({ bot: both['bot-a'], byId: both, copies: [both['bot-b']] });

    const result = await svc.setPairActive('bot-a', true);

    expect(result.alreadyInStep).toBe(true);
    expect(result.changed).toEqual([]);
    expect(updates.length).toBe(0);
  });

  it('REFUSES a bot that is not a resolvable pair, quoting the reason', async () => {
    const { svc } = make({ byId: { 'bot-b': { ...VARIANT, duplicatedFromId: null } }, copies: [] });

    await expect(svc.setPairActive('bot-a', true)).rejects.toThrow(/not a resolvable A\/B pair/);
  });

  it('REFUSES a GROUP rather than moving an arbitrary two', async () => {
    const third = { ...VARIANT, id: 'bot-c', name: 'copy 2', duplicatedFromId: 'bot-a' };
    const { svc, updates } = make({ bot: INCUMBENT, copies: [VARIANT, third] });

    await expect(svc.setPairActive('bot-a', true)).rejects.toThrow(/GROUP, not a pair/);
    expect(updates.length).toBe(0); // nothing was moved
  });

  it('does NOT bypass the #905 ceiling gate — a side that could never fire is refused', async () => {
    const { svc, updates } = make({
      bot: INCUMBENT,
      copies: [VARIANT],
      ceiling: { ceilingPct: 5, samples: 100, slug: 'xau-speed-m15-copy', ceilingRaw: 5, capacity: 100 },
    });

    // minComposite is 10; the protocol has never exceeded 5% of capacity.
    await expect(svc.setPairActive('bot-a', true)).rejects.toThrow(/could never fire/);
    expect(updates.length).toBe(0);
  });

  it('REVERTS a half-applied pair and throws — MyISAM has no transactions', async () => {
    const both = {
      'bot-a': { ...INCUMBENT, active: false },
      'bot-b': { ...VARIANT, active: false },
    };
    const { svc, state } = make({ bot: both['bot-a'], byId: both, copies: [both['bot-b']] });

    // Fail the SECOND write only; the first must be rolled back.
    const realUpdate = (svc as any).prisma.tradingStrategy.update;
    let call = 0;
    (svc as any).prisma.tradingStrategy.update = jest.fn(async (args: any) => {
      call += 1;
      if (call === 2) throw new Error('connection lost mid-pair');
      return realUpdate(args);
    });

    await expect(svc.setPairActive('bot-a', true)).rejects.toThrow(/could not be moved together/);

    // ⚠️ The whole point: a pair that LOOKS synchronised but is not is worse than a refused one.
    expect(state()['bot-a'].active).toBe(false);
    expect(state()['bot-b'].active).toBe(false);
  });
});

describe('startPair / stopPair — the comparison becomes a RECORDED fact (#963)', () => {
  const RUNNING = {
    id: 'pair-1', incumbentId: 'bot-a', variantId: 'bot-b', state: 'running',
    declaredChange: 'weightStrategy', falsification: null, startedAt: new Date(), endedAt: null,
  };

  it('REFUSES without a declared change — the ONE field under test must be named', async () => {
    const { svc, pairs } = make();

    await expect(svc.startPair('bot-a', {})).rejects.toThrow(/must declare the ONE field/);

    // Nothing was written and nothing was activated.
    expect(pairs().length).toBe(0);
  });

  it('REFUSES a second start on an ALREADY RUNNING pair — one comparison at a time', async () => {
    const { svc } = make({ pairRows: [RUNNING] });

    await expect(svc.startPair('bot-a', { declaredChange: 'slPct' })).rejects.toThrow(/ALREADY running/);
  });

  it('STARTS: activates BOTH sides and registers the comparison', async () => {
    const { svc, state, pairs } = make();

    const result = await svc.startPair('bot-a', { declaredChange: 'weightStrategy' });

    expect(state()['bot-a'].active).toBe(true);
    expect(state()['bot-b'].active).toBe(true);
    expect(pairs()[0].state).toBe('running');
    expect(pairs()[0].declaredChange).toBe('weightStrategy');
    expect(result.started).toBe(true);
    expect(result.comparisonId).toBe('pair-1');
  });

  it('does NOT bypass the #905 ceiling gate when starting', async () => {
    const { svc, pairs } = make({
      ceiling: { ceilingPct: 5, samples: 100, slug: 'xau-speed-m15-copy', ceilingRaw: 5, capacity: 100 },
    });

    await expect(svc.startPair('bot-a', { declaredChange: 'weightStrategy' })).rejects.toThrow(/could never fire/);
    expect(pairs().length).toBe(0); // nothing registered, nothing activated
  });

  it('REFUSES to stop when nothing is running — and says which state it IS in', async () => {
    const { svc } = make();

    await expect(svc.stopPair('bot-a')).rejects.toThrow(/no RUNNING comparison/);
    await expect(svc.stopPair('bot-a')).rejects.toThrow(/unregistered/);
  });

  it('STOPS: deactivates BOTH sides and records the end', async () => {
    const { svc, state, pairs } = make({
      byId: { 'bot-b': { ...VARIANT, active: true } },
      copies: [{ ...VARIANT, active: true }],
      pairRows: [RUNNING],
    });

    await svc.stopPair('bot-a');

    expect(state()['bot-a'].active).toBe(false);
    expect(state()['bot-b'].active).toBe(false);
    expect(pairs()[0].state).toBe('complete');
    expect(pairs()[0].endedAt).toBeTruthy();
  });

  it('a pair with NO comparison declared is `registered: false`, not a false negative', async () => {
    const { svc } = make();

    const status = await svc.getPairStatus('bot-a');

    // paired (the link exists) but nothing declared — a DIFFERENT fact from "not a pair".
    expect(status.paired).toBe(true);
    expect(status.comparison.registered).toBe(false);
    expect(status.comparison.state).toBe('unregistered');
  });
});

describe('INVARIANT 6 — a RUNNING comparison freezes both sides (#963, decision 25)', () => {
  const RUNNING = {
    id: 'pair-1', incumbentId: 'bot-a', variantId: 'bot-b', state: 'running',
    declaredChange: 'weightStrategy', startedAt: new Date(), endedAt: null,
  };

  it('REFUSES a behavioural edit to either side, naming the field and the comparison', async () => {
    const { svc, updates } = make({ pairRows: [RUNNING] });

    await expect(svc.update('bot-a', { slPct: 2 })).rejects.toThrow(/RUNNING A\/B comparison/);
    await expect(svc.update('bot-b', { slPct: 2 })).rejects.toThrow(/weightStrategy/);
    // ⚠️ Editing one side mid-comparison invalidates the METHOD, not just the number: the two
    // sides would have been measured under different configurations, so the result describes
    // neither. Nothing may be written.
    expect(updates.filter((u) => u.data.slPct !== undefined).length).toBe(0);
  });

  it('ALLOWS a non-behavioural edit while running — the freeze must not become a trap', async () => {
    const { svc } = make({ pairRows: [RUNNING] });

    // `duplicatedFromId` is in NON_BEHAVIOURAL_COLUMNS: it cannot shape a trade.
    await expect(svc.update('bot-a', { duplicatedFromId: null })).resolves.toBeDefined();
  });

  it('ALLOWS any edit when no comparison is running', async () => {
    const { svc } = make();

    await expect(svc.update('bot-b', { slPct: 2 })).resolves.toBeDefined();
  });
});

