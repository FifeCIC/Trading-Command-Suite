import { AbTestService } from './ab-test.service';

/**
 * #929 — an A/B test whose arms cannot differ can never produce a result, and nothing said so.
 *
 * ⚠️ THE DEFECT THIS LOCKS OUT, AND IT ALREADY COST A MEASUREMENT WINDOW.
 *
 * The only A/B test that has ever completed ran 2026-09-22 11:19 → 2026-09-23 10:01. Its two
 * snapshots differed in EXACTLY ONE field:
 *
 *     control v1.0.1  weightStrategy: "group-weighted"
 *     variant v1.0.2  weightStrategy: "maxscore-weighted"
 *
 * ...and `weightStrategy` is declared INERT in `protocol-gating.service.ts` — the denominator is
 * hardcoded, so both arms scored identically. The test was therefore null BY CONSTRUCTION.
 *
 * Its verdict read `"Refusing to name a winner: 0 vs 0 closed trades (need >=30 per side)"`, which
 * blames SAMPLE SIZE for a comparison that was empty from the start. The correct instruction was
 * never "wait for more trades" — no number of trades could separate two arms running identical
 * arithmetic. A whole window was spent, and the output invited the operator to spend another.
 *
 * ⚠️ HOW TO CANARY THIS FILE (do it before trusting it — a guard never seen to fail is decoration).
 *
 *   1. Empty `INERT_SNAPSHOT_FIELDS` in `ab-test.service.ts` (→ `new Set([])`).
 *      The 'differs only in an INERT field' test must then FAIL — because nothing is known-inert,
 *      every differing field reads as liveable and the refusal does not fire.
 *
 *   2. In `buildVerdict`, move the `arms && !arms.measurable` block BELOW the
 *      `nA < AB_MIN_TRADES_FOR_VERDICT` block. The 'unmeasurable outranks insufficient-data' test
 *      must FAIL — the sample-size note would mask it, which is the exact bug being fixed.
 *
 * Restore byte-for-byte and confirm both pass again.
 */
describe('AbTestService — arms that cannot differ (#929)', () => {
  /** Two snapshots whose only difference is the field under test. */
  const snap = (id: string, version: string, over: Record<string, unknown> = {}) => ({
    id,
    scoringStrategyId: 'ss-gold',
    version,
    snapshot: {
      mode: 'score',
      name: 'XAU M15 Day-Trade',
      protocolId: 'xau-speed-m15',
      brokerId: 'mt5',
      tradeThreshold: 10,
      weightStrategy: 'group-weighted',
      ...over,
    },
  });

  function make(control: unknown, variant: unknown) {
    const svc = Object.create(AbTestService.prototype) as AbTestService;
    const created: any[] = [];
    (svc as any).prisma = {
      metaStackSnapshot: {
        // Keyed on the id so the control and variant reads genuinely differ — a mock returning one
        // object for both would make every arms-diff test pass for the wrong reason.
        findUnique: jest.fn(async (args: any) =>
          args.where.id === control?.id ? control : variant,
        ),
      },
      abTest: {
        create: jest.fn(async ({ data }: any) => {
          created.push(data);
          return { id: 'ab-new', ...data };
        }),
        findUnique: jest.fn(async () => ({
          id: 'ab-complete',
          name: 'completed test',
          status: 'complete',
          controlStackId: 'snap-control',
          variantStackId: 'snap-variant',
          symbols: ['XAUUSD'],
          // ⚠️ A STORED blob with NO `arms` — which is exactly what every test completed before
          // this diagnostic existed carries, including the one real test in the database.
          results: { verdict: { verdict: 'insufficient-data' }, symbols: ['XAUUSD'] },
        })),
      },
      tradingStrategy: { findMany: jest.fn(async () => []) },
    };
    // `assertSnapshotsExist` is a separate concern with its own coverage; spying keeps this file
    // about the arms rule. If it ever stops being called, THIS test does not notice — which is why
    // the `create()` call below is asserted to have reached the arms check, not merely to throw.
    (svc as any).assertSnapshotsExist = jest.fn(async () => undefined);
    (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { svc, created };
  }

  const input = (over: Record<string, unknown> = {}) => ({
    name: 'XAU M15 — group vs maxscore',
    controlStackId: 'snap-control',
    variantStackId: 'snap-variant',
    symbols: ['XAUUSD'],
    ...over,
  });

  it('REFUSES a test whose arms differ ONLY in a field declared inert', async () => {
    // ⚠️ The real-world fixture: this is verbatim what the completed test compared.
    const { svc, created } = make(
      snap('snap-control', '1.0.1', { weightStrategy: 'group-weighted' }),
      snap('snap-variant', '1.0.2', { weightStrategy: 'maxscore-weighted' }),
    );

    await expect((svc as any).create(input())).rejects.toThrow(/INERT/i);
    // Naming the field is the whole value: "cannot measure anything" without saying WHICH field is
    // the difference between a fixable refusal and a dead end.
    await expect((svc as any).create(input())).rejects.toThrow(/weightStrategy/);
    // And the refusal must PREVENT the row. A validation that still writes the test is theatre.
    expect(created).toHaveLength(0);
  });

  it('ALLOWS a test whose arms differ in a field the pipeline actually reads', async () => {
    const { svc, created } = make(
      snap('snap-control', '1.0.1', { tradeThreshold: 10 }),
      snap('snap-variant', '1.0.2', { tradeThreshold: 20 }),
    );

    await (svc as any).create(input());
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe('draft');
  });

  it('ALLOWS a live difference even when an inert one rides along, but warns about the decoy', async () => {
    // A test that changes two fields, one live and one inert, IS valid. The inert difference must
    // not be silently present, because it can never contribute and must not later be credited with
    // a result that the live field produced.
    const { svc, created } = make(
      snap('snap-control', '1.0.1', { tradeThreshold: 10, weightStrategy: 'group-weighted' }),
      snap('snap-variant', '1.0.2', { tradeThreshold: 20, weightStrategy: 'maxscore-weighted' }),
    );

    await (svc as any).create(input());
    expect(created).toHaveLength(1);
    expect((svc as any).logger.warn).toHaveBeenCalledWith(expect.stringContaining('weightStrategy'));
  });

  it('REFUSES two snapshots with identical configs — there is nothing to compare', async () => {
    const { svc, created } = make(snap('snap-control', '1.0.1'), snap('snap-variant', '1.0.1'));

    await expect((svc as any).create(input())).rejects.toThrow(/IDENTICAL/i);
    expect(created).toHaveLength(0);
  });

  it('unmeasurable OUTRANKS insufficient-data in the verdict', async () => {
    // ⚠️ THE ORDERING IS THE FIX. Both blocks can be true at once, and if the sample-size branch
    // wins the operator is told to wait for trades that cannot help. Every count here is 0 —
    // identical to the real test's output — so the only difference is which verdict is chosen.
    const { svc } = make(snap('snap-control', '1.0.1'), snap('snap-variant', '1.0.1'));
    const empty = { closedTrades: 0, trades: 0, winRate: null, realizedPnl: 0, unrealizedPnl: 0 };

    const v = (svc as any).buildVerdict(empty, empty, 0, {
      changedFields: ['weightStrategy'],
      inertFields: ['weightStrategy'],
      measurable: false,
    });

    expect(v.verdict).toBe('unmeasurable');
    expect(v.note).toMatch(/CANNOT PRODUCE A RESULT/i);
    expect(v.note).toMatch(/MORE TRADES CANNOT CHANGE THAT/i);
    expect(v.inertFields).toEqual(['weightStrategy']);
  });

  it('still reports insufficient-data when the arms COULD differ but the sample is small', async () => {
    // The negative control. Without this, the new branch could swallow every small-sample verdict
    // and pass the test above while breaking the case it was meant to leave alone.
    const { svc } = make(snap('snap-control', '1.0.1'), snap('snap-variant', '1.0.1'));
    const empty = { closedTrades: 0, trades: 0, winRate: null, realizedPnl: 0, unrealizedPnl: 0 };

    const v = (svc as any).buildVerdict(empty, empty, 0, {
      changedFields: ['tradeThreshold'],
      inertFields: [],
      measurable: true,
    });

    expect(v.verdict).toBe('insufficient-data');
    expect(v.note).toMatch(/Refusing to name a winner/i);
  });

  it('attaches the arms diff to a COMPLETED test, which serves its STORED results', async () => {
    // ⚠️ THE TEST THAT NEEDS THIS MOST IS THE ONE THAT ALREADY FINISHED. `getResults` returns the
    // stored blob for a complete test rather than recomputing, so the real test in the database
    // reports "0 vs 0 closed trades (need >=30 per side)" — an instruction to WAIT — with nothing
    // saying the two arms could never have differed. The diff is therefore attached at read time
    // instead of only at compute time, and the stored verdict is left as the record it is.
    const { svc } = make(
      snap('snap-control', '1.0.1', { weightStrategy: 'group-weighted' }),
      snap('snap-variant', '1.0.2', { weightStrategy: 'maxscore-weighted' }),
    );

    const out = await svc.getResults('ab-complete');

    expect(out.arms).toEqual({
      changedFields: ['weightStrategy'],
      inertFields: ['weightStrategy'],
      measurable: false,
    });
    // And the stored verdict is untouched — a historical record is not back-filled.
    expect(out.results.verdict.verdict).toBe('insufficient-data');
  });
});
