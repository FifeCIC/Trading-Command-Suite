/**
 * Multiple configured instances of ONE directive (#1165) — the guard that the collapse cannot return.
 * ========================================================================================================
 * The feature is "run several configurations of one directive inside one protocol and compare them on
 * the same bars". Two things made it impossible, and BOTH must stay fixed:
 *
 *   1. `protocol_directive_entry` carried `UNIQUE (groupId, directiveId)`, so a second row could not
 *      exist. Widened to `UNIQUE (groupId, directiveId, instanceLabel)` — canaried in SQL, not here.
 *   2. The scorer collapsed by directive id: a `Set<string>` of ids, and results `Map` keyed by
 *      directive id. A duplicated id was READ TWICE AND RESOLVED TO ONE RESULT, so it would have
 *      scored once and looked like it worked.
 *
 * ## The aggregation rule these tests pin (register row 122)
 *
 * Instances are AVERAGED into ONE directive slot. That is not a preference — it is what keeps
 * `INV-STABLE-DENOMINATOR` true:
 *
 *   - `capacityMax += maxScore` runs once per result in the scorer's group list, and `directiveIds`
 *     now holds each directive once. A second instance therefore CANNOT add configured capacity.
 *   - Keying by instance instead would make "add a comparison" silently shrink every percentage in the
 *     protocol, because the denominator would grow while the numerator usually would not.
 *   - Summing would make adding an instance of a directional directive a weight multiplier wearing a
 *     comparison's clothes.
 *
 * ⚠️ CANARY THIS FILE BEFORE TRUSTING IT. Make `runAll` key results by entry id instead of directive id
 * and the first test must fail; make it return the first instance instead of the mean and the second
 * must fail. A guard observed only in the passing direction proves nothing.
 */
import { DirectivesService } from './directives.service';
import type { DirectiveInput, IDirective } from './interfaces/directive.interface';
import type { NumericParamSpec } from './parameters';

const conditionVector = {
  regime: 'trending', regimeStrength: 1,
  regimeComponents: { hurst: 1, adx: 1, volatilityPercentile: 1 },
  hurstExponent: 1, volatility: 'normal', activeSession: 'US', adx: 50,
  atrPercentile: 0.5, preEvent: false, timestamp: new Date(0),
};

const SPEC: NumericParamSpec = {
  key: 'level',
  label: 'Level',
  type: 'number',
  default: 30,
  min: 10,
  max: 60,
  chart: 'threshold',
  why: 'used only by this spec; the score IS the level, so the aggregation is directly observable',
  source: 'directive-instances.spec.ts:1',
};

/**
 * A directive whose score and signalClass are driven by `params`, so an instance's contribution is
 * visible in the aggregate. `direction` lets a test make the instances DISAGREE.
 */
function instanceDirective(seen: DirectiveInput[]): IDirective {
  return {
    id: 'multi',
    name: 'multi',
    description: 'multi',
    readiness: 'ready',
    directionBias: 'neutral',
    maxScore: 100,
    version: '1.0.0',
    params: [SPEC],
    calculate: (input: DirectiveInput) => {
      seen.push(input);
      const level = input.params?.level;
      const score = typeof level === 'number' ? level : SPEC.default;
      const direction = input.params?.direction as string | undefined;
      return {
        score,
        confidence: 0.5,
        reason: `level=${String(level ?? 'default')}`,
        signalClass: (direction as any) ?? 'neutral',
      };
    },
  } as IDirective;
}

function barsInput(): DirectiveInput {
  return {
    symbol: 'TEST',
    asOf: new Date('2026-01-01T00:00:00Z'),
    bars: [{ timestamp: new Date('2026-01-01T00:00:00Z'), open: 1, high: 10, low: 1, close: 10, volume: 10 }],
  };
}

function service(): DirectivesService {
  return new DirectivesService({ detect: () => conditionVector } as any, {} as any, {} as any);
}

describe('multiple instances of one directive (#1165)', () => {
  it('TWO INSTANCES ARE BOTH EVALUATED — the second is not collapsed away', async () => {
    const seen: DirectiveInput[] = [];
    const svc = service();
    svc.register(instanceDirective(seen));

    const results = await svc.runAll(barsInput(), new Set(['multi']), [
      { entryId: 'e-primary', directiveId: 'multi', label: '', params: { level: 20 } },
      { entryId: 'e-fast', directiveId: 'multi', label: 'fast', params: { level: 40 } },
    ]);

    // The old code keyed a Set of ids and ran the directive once. Two calls prove both ran.
    expect(seen.length).toBe(2);
    expect(results.get('multi')).toBeDefined();
  });

  it('RESULT IS KEYED BY DIRECTIVE ID — so one directive can never occupy two capacity slots', async () => {
    const svc = service();
    svc.register(instanceDirective([]));

    const results = await svc.runAll(barsInput(), new Set(['multi']), [
      { entryId: 'e-primary', directiveId: 'multi', label: '', params: { level: 20 } },
      { entryId: 'e-fast', directiveId: 'multi', label: 'fast', params: { level: 40 } },
    ]);

    // ⚠️ THIS IS THE INV-STABLE-DENOMINATOR GUARANTEE, structurally: one key means the scorer's
    // `capacityMax += maxScore` runs once. Asserting the key set (not a count) fails if anyone
    // re-keys results by entry id, which would silently shrink every percentage in the protocol.
    expect([...results.keys()]).toEqual(['multi']);
  });

  it('AGGREGATION IS THE MEAN, not the first or the largest', async () => {
    const svc = service();
    svc.register(instanceDirective([]));

    const results = await svc.runAll(barsInput(), new Set(['multi']), [
      { entryId: 'e-primary', directiveId: 'multi', label: '', params: { level: 20 } },
      { entryId: 'e-fast', directiveId: 'multi', label: 'fast', params: { level: 40 } },
    ]);

    const r = results.get('multi')!;
    expect(r.score).toBe(30); // (20 + 40) / 2 — NOT 20 (first) and NOT 60 (sum)
    expect(r.metadata?.instanceCount).toBe(2);
    expect(r.metadata?.aggregation).toBe('mean');
    // The comparison must be VISIBLE, not averaged away: both readings are reported.
    expect((r.metadata?.instances as any[]).map((i) => i.score)).toEqual([20, 40]);
  });

  it('A MIXED READING IS NEUTRAL — no consensus is not a weaker direction, and is never invented', async () => {
    const svc = service();
    svc.register(instanceDirective([]));

    const results = await svc.runAll(barsInput(), new Set(['multi']), [
      { entryId: 'e-primary', directiveId: 'multi', label: '', params: { level: 50, direction: 'bullish' } },
      { entryId: 'e-fast', directiveId: 'multi', label: 'fast', params: { level: 10, direction: 'neutral' } },
    ]);

    const r = results.get('multi')!;
    expect(r.signalClass).toBe('neutral');
    expect(r.metadata?.agreement).toBe('mixed');
  });

  it('UNANIMOUS DIRECTION SURVIVES AVERAGING — the consensus is reported, not flattened', async () => {
    const svc = service();
    svc.register(instanceDirective([]));

    const results = await svc.runAll(barsInput(), new Set(['multi']), [
      { entryId: 'e-primary', directiveId: 'multi', label: '', params: { level: 50, direction: 'bullish' } },
      { entryId: 'e-fast', directiveId: 'multi', label: 'fast', params: { level: 30, direction: 'bullish' } },
    ]);

    const r = results.get('multi')!;
    expect(r.signalClass).toBe('bullish');
    expect(r.metadata?.agreement).toBe('unanimous');
    expect(r.score).toBe(40);
  });

  it('ONE INSTANCE IS BYTE-IDENTICAL — adding the feature cannot change any existing score', async () => {
    const withoutInstances = service();
    withoutInstances.register(instanceDirective([]));
    const plain = await withoutInstances.runAll(barsInput(), new Set(['multi']));

    const withOne = service();
    withOne.register(instanceDirective([]));
    const oneInstance = await withOne.runAll(barsInput(), new Set(['multi']), [
      { entryId: 'e-primary', directiveId: 'multi', label: '', params: null },
    ]);

    // Every protocol that has one entry per directive — i.e. all of them before #1165 — must score
    // exactly as before, INCLUDING the absence of aggregation metadata.
    expect(oneInstance.get('multi')).toEqual(plain.get('multi'));
    expect(plain.get('multi')!.metadata).toBeUndefined();
  });

  it('CACHED CORRECTLY: adding a second instance cannot be served the single-instance result', async () => {
    const seen: DirectiveInput[] = [];
    const svc = service();
    svc.register(instanceDirective(seen));

    const instances = [
      { entryId: 'e-primary', directiveId: 'multi', label: '', params: { level: 20 } },
      { entryId: 'e-fast', directiveId: 'multi', label: 'fast', params: { level: 40 } },
    ] as const;

    const single = await svc.runAll(barsInput(), new Set(['multi']), [instances[0]]);
    const both = await svc.runAll(barsInput(), new Set(['multi']), [...instances]);

    expect(single.get('multi')!.score).toBe(20);
    // If the fingerprint ignored the instance list this would still read 20 — the knob would look
    // inert, which is the exact failure the params half of #1165 already paid for.
    expect(both.get('multi')!.score).toBe(30);
    expect(seen.length).toBe(3); // primary, then primary+fast re-evaluated
  });

  it('ABSENT PARAMS STAY ABSENT on every instance — an unconfigured entry is unchanged', async () => {
    const seen: DirectiveInput[] = [];
    const svc = service();
    svc.register(instanceDirective(seen));

    await svc.runAll(barsInput(), new Set(['multi']), [
      { entryId: 'e-primary', directiveId: 'multi', label: '', params: null },
      { entryId: 'e-fast', directiveId: 'multi', label: 'fast', params: {} },
    ]);

    for (const input of seen) {
      expect(Object.prototype.hasOwnProperty.call(input, 'params')).toBe(false);
    }
  });

  it('IDENTICAL INSTANCES ARE NOT A NO-OP ON WEIGHT — the arithmetic behind the refusal', async () => {
    const svc = service();
    svc.register(instanceDirective([]));

    const same = await svc.runAll(barsInput(), new Set(['multi']), [
      { entryId: 'e-primary', directiveId: 'multi', label: '', params: { level: 40 } },
      { entryId: 'e-dup', directiveId: 'multi', label: 'dup', params: { level: 40 } },
    ]);
    // Two identical readings average to the same number — so the DUPLICATE itself looks harmless.
    expect(same.get('multi')!.score).toBe(40);

    const diluted = await svc.runAll(barsInput(), new Set(['multi']), [
      { entryId: 'e-primary', directiveId: 'multi', label: '', params: { level: 80 } },
      { entryId: 'e-dup', directiveId: 'multi', label: 'dup', params: null },
    ]);
    // 80 configured, plus one instance at the declared default (30) → 55. That is a "comparison"
    // that HALVES a directive's weight, which is why the endpoint refuses an identical instance.
    expect(diluted.get('multi')!.score).toBe(55);
  });
});
