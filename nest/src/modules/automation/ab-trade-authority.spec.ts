import { AbTestService } from './ab-test.service';

/**
 * #929 — who decides HOW an A/B side trades, and what happens when nobody can.
 *
 * ⚠️ THE DEFECT THIS LOCKS OUT. `dispatchSideTrade` read its `mode` from the SNAPSHOT:
 *
 *     const mode = (controlCfg.mode ?? variantCfg.mode ?? 'manual');
 *     if (mode !== 'auto') { ...record an intent, place nothing... }
 *
 * `snapshot.mode` is written from `scoringStrategy.mode` (`metastack-versioning.service.ts` L42),
 * so it holds the SCORING style. Measured on the live database 2026-09-23:
 *
 *     scoring_strategy.mode -> 'score' x18 | 'semi-auto' x7 | 'manual' x2 | 'auto' x0
 *
 * `'auto'` is not a value a scoring strategy has EVER held. So `mode !== 'auto'` was true for
 * every stack in existence and the order branch was **unreachable** — A/B ran for a day without
 * placing one order, while logging ten `EXECUTED` rows that had `brokerTicket: NULL`.
 *
 * The fix reads the mode from the BOT (`trading_strategy.mode`, which really is
 * `'auto' | 'manual'`) via `resolveTradeAuthority()`. The test at the top of this file is the one
 * that matters: a snapshot whose own `mode` is `'score'` must resolve to the bot's mode, and must
 * never resolve to `'score'`.
 *
 * ⚠️ CANARY (run before trusting this file). Reinstate the snapshot read in
 * `automation-loop.service.ts` — `const mode = (controlCfg.mode ?? variantCfg.mode ?? 'manual')`
 * — and pass it as `tradeMode`. The first test then fails with `mode: 'score'`, and the
 * `auto`-places-an-order test fails with `refused: true`.
 */

const CONTROL_SNAPSHOT = {
  id: 'snap-control',
  scoringStrategyId: 'ss-gold',
  version: '1.0.1',
  // ⚠️ The score-style mode that used to be mistaken for a trading mode. Its presence in these
  // fixtures is deliberate: it is what the runner must IGNORE.
  snapshot: { mode: 'score', protocolId: 'xau-speed-m15', brokerId: 'mt5', tradeThreshold: 10 },
};

/**
 * ⚠️ A VARIANT THAT ACTUALLY DIFFERS — added 2026-09-25. It is not decoration.
 *
 * Before this existed, `findUnique` returned `CONTROL_SNAPSHOT` for BOTH the control and the
 * variant id. So the fixture described two arms with byte-identical configs — a state
 * `AbTestService.create()` now REFUSES, and one that no real test can be in. The degenerate mock
 * was harmless while nothing looked at the diff; once `computeResults` started reporting whether
 * the arms CAN differ, it produced `verdict: 'unmeasurable'` and this file failed.
 *
 * The fix is to the FIXTURE, not to the assertion. Asserting `insufficient-data` on two identical
 * arms would be asserting a bug: a test with identical arms cannot produce a result, and the
 * verdict is right to say so. The difference below is a field the pipeline reads, so this pair is
 * genuinely measurable and the sample-size verdict is the correct one to expect.
 */
const VARIANT_SNAPSHOT = {
  id: 'snap-variant',
  scoringStrategyId: 'ss-gold',
  version: '1.0.2',
  snapshot: { mode: 'score', protocolId: 'xau-speed-m15', brokerId: 'mt5', tradeThreshold: 20 },
};

function make(opts: { snapshot?: any; bots?: any[]; running?: any[] } = {}) {
  const svc = Object.create(AbTestService.prototype) as AbTestService;

  const adapter = {
    placeOrder: jest.fn(async () => ({ success: true, ticket: 987654, price: 2013.5 })),
  };

  (svc as any).prisma = {
    metaStackSnapshot: {
      // `'snapshot' in opts`, not `opts.snapshot ?? CONTROL_SNAPSHOT` — an EXPLICIT null is the
      // "snapshot is missing" fixture, and `??` would have silently swallowed it and passed the
      // wrong snapshot in. Caught by the missing-snapshot test failing on `mode: 'auto'`.
      // Keyed on the id so control and variant are genuinely different configs (see VARIANT_SNAPSHOT).
      findUnique: jest.fn(async (args: any) => {
        if ('snapshot' in opts) return opts.snapshot;
        return args?.where?.id === VARIANT_SNAPSHOT.id ? VARIANT_SNAPSHOT : CONTROL_SNAPSHOT;
      }),
      findMany: jest.fn(async () => [{ id: 'snap-control' }, { id: 'snap-variant' }]),
    },
    tradingStrategy: { findMany: jest.fn(async () => opts.bots ?? [bot()]) },
    abTest: {
      findUnique: jest.fn(async (args: any) => ({
        id: args.where.id,
        name: 'XAU M15 — group vs maxscore',
        status: 'draft',
        controlStackId: 'snap-control',
        variantStackId: 'snap-variant',
        symbols: ['XAUUSD'],
      })),
      findMany: jest.fn(async () => opts.running ?? []),
      update: jest.fn(async ({ data }: any) => ({ id: 'ab1', ...data })),
    },
    trade: { findMany: jest.fn(async () => []) },
  };
  (svc as any).adapterFactory = { create: jest.fn(() => adapter) };
  (svc as any).tradeRecorder = { record: jest.fn(async (a: any) => a) };
  (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  return { svc, adapter };
}

const bot = (over: Record<string, unknown> = {}) => ({
  id: '9b2a1e22', name: 'Gold Day-Trade M15', mode: 'auto', active: 1, ...over,
});

/** The arguments `dispatchSideTrade` needs; `tradeMode` is the field under test. */
const dispatchArgs = (tradeMode: string | null, extra: Record<string, unknown> = {}) => ({
  test: { id: 'ab1', name: 'XAU M15 comparison' } as any,
  side: 'A' as const,
  symbol: 'XAUUSD',
  brokerId: 'mt5',
  sideDir: 'BUY' as const,
  quantity: 0.01,
  slPct: 1,
  tpPct: 2,
  entryPrice: 2000,
  tradeMode,
  tradeModeSource: 'bot "Gold Day-Trade M15"',
  tradeModeReason: undefined as string | undefined,
  ...extra,
});

describe('AbTestService — trade authority resolution (#929)', () => {
  it('resolves the mode from the OWNING BOT, ignoring the snapshot\'s scoring `mode`', async () => {
    const { svc } = make({ bots: [bot({ mode: 'auto' })] });

    const authority = await svc.resolveTradeAuthority('snap-control');

    // The whole point: the snapshot says 'score'; the answer must be the bot's 'auto'.
    expect(CONTROL_SNAPSHOT.snapshot.mode).toBe('score');
    expect(authority.mode).toBe('auto');
    expect(authority.botName).toBe('Gold Day-Trade M15');
    expect(authority.botId).toBe('9b2a1e22');
  });

  it('cannot judge when NO bot references the scoring strategy — and does not default', async () => {
    const { svc } = make({ bots: [] });

    const authority = await svc.resolveTradeAuthority('snap-control');

    expect(authority.mode).toBeNull();
    expect(authority.reason).toContain('no trading_strategy row references scoring strategy ss-gold');
  });

  it('cannot judge when every bot on the scoring strategy is INACTIVE', async () => {
    const { svc } = make({ bots: [bot({ active: 0 })] });

    const authority = await svc.resolveTradeAuthority('snap-control');

    expect(authority.mode).toBeNull();
    expect(authority.reason).toContain('is inactive');
    expect(authority.reason).toContain('Gold Day-Trade M15');
  });

  it('cannot judge when bots on the SAME scoring strategy disagree — naming both', async () => {
    const { svc } = make({
      bots: [bot({ name: 'Gold A', mode: 'auto' }), bot({ id: 'b2', name: 'Gold B', mode: 'manual' })],
    });

    const authority = await svc.resolveTradeAuthority('snap-control');

    // Comparing against an ambiguous authority would measure two things at once.
    expect(authority.mode).toBeNull();
    expect(authority.reason).toContain('Gold A=auto');
    expect(authority.reason).toContain('Gold B=manual');
  });

  it('cannot judge when the snapshot itself is missing', async () => {
    const { svc } = make({ snapshot: null });

    const authority = await svc.resolveTradeAuthority('snap-gone');

    expect(authority.mode).toBeNull();
    expect(authority.reason).toContain('snapshot snap-gone not found');
  });
});

describe('AbTestService — a refusal is not a trade, and not an error (#929)', () => {
  it("REFUSES and writes NO trade row when the authority cannot be judged (tradeMode null)", async () => {
    const { svc, adapter } = make();

    const res = await svc.dispatchSideTrade(
      dispatchArgs(null, { tradeModeReason: 'no trading_strategy row references scoring strategy ss-gold' }),
    );

    expect(res.success).toBe(false);
    expect(res.refused).toBe(true);
    expect(res.error).toContain('cannot determine how to trade');
    // The evidence that a signal fired belongs in decision_log. A `trade` row that is not a trade
    // is a lie in the very table `computeResults` reads to build the verdict.
    expect((svc as any).tradeRecorder.record).not.toHaveBeenCalled();
    expect(adapter.placeOrder).not.toHaveBeenCalled();
  });

  it('REFUSES a non-auto bot without recording — and does not report it as a failure', async () => {
    const { svc, adapter } = make();

    const res = await svc.dispatchSideTrade(dispatchArgs('manual'));

    expect(res.refused).toBe(true);
    expect(res.error).toContain(`is 'manual'`);
    expect((svc as any).tradeRecorder.record).not.toHaveBeenCalled();
    expect(adapter.placeOrder).not.toHaveBeenCalled();
  });

  it("places a REAL order when the owning bot is 'auto', and records the ticket", async () => {
    const { svc, adapter } = make();

    const res = await svc.dispatchSideTrade(dispatchArgs('auto'));

    expect(res.refused).toBeUndefined();
    expect(res.success).toBe(true);
    expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
    const recorded = (svc as any).tradeRecorder.record.mock.calls[0][0];
    expect(recorded.brokerTicket).toBe('987654');
    expect(recorded.abTestId).toBe('ab1');
    // ⚠️ The side is stored structurally — the verdict must not depend on a comment string the
    // stranded-trade reaper is free to overwrite.
    expect(recorded.abTestSide).toBe('A');
    // SL/TP go to the broker, which is what lets the position close on its own — the reason a
    // real order can produce a result and a recorded intent never can.
    const order = adapter.placeOrder.mock.calls[0][0];
    expect(order.sl).toBe(1980); // 2000 * (1 - 1%)
    expect(order.tp).toBe(2040); // 2000 * (1 + 2%)
    expect(recorded.pnlInvalid).toBeUndefined(); // a real order is a real result, not quarantined
  });
});

describe('AbTestService — a test that cannot measure is refused at START (#929)', () => {
  it('refuses to start when the owning bot is not auto, naming the bot and its mode', async () => {
    const { svc } = make({ bots: [bot({ mode: 'semi-auto' })] });

    await expect(svc.start('ab1')).rejects.toThrow(/cannot produce a result/);
    await expect(svc.start('ab1')).rejects.toThrow(/Gold Day-Trade M15/);
  });

  it('refuses to start when the authority CANNOT BE JUDGED, quoting the reason', async () => {
    const { svc } = make({ bots: [] });

    await expect(svc.start('ab1')).rejects.toThrow(/cannot produce a result/);
    await expect(svc.start('ab1')).rejects.toThrow(/no trading_strategy row references scoring strategy/);
  });

  it("starts when the owning bot is 'auto', recording the authority in the log", async () => {
    const { svc } = make({ bots: [bot({ mode: 'auto' })] });

    const started = await svc.start('ab1');

    expect(started.status).toBe('running');
    expect((svc as any).logger.log.mock.calls[0][0]).toContain('Gold Day-Trade M15');
  });
});

describe('AbTestService — the authority is VISIBLE in the payload, not inferred (#929)', () => {
  it('reports the resolved bot alongside the results, so "cannot trade" is distinguishable from "has not traded"', async () => {
    const { svc } = make({ bots: [bot({ mode: 'auto' })] });

    const out = await svc.getResults('ab1');

    // Both cases render as `0 vs 0` in `results`. The authority is what separates them.
    expect(out.results.verdict.verdict).toBe('insufficient-data');
    expect(out.tradeAuthority.mode).toBe('auto');
    expect(out.tradeAuthority.botName).toBe('Gold Day-Trade M15');
  });
});
