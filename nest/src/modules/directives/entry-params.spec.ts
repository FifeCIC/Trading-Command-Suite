/**
 * Per-entry directive parameters (#1165) — the contract that makes a stored `params` value REAL.
 * =================================================================================================
 * #761 is the reason this file exists. A DECLARATION that a knob exists was once trusted, and it was
 * wrong — `macd-crossover` declared `directionBias: 'neutral'` and emitted a direction 5,252 times.
 * `protocol_directive_entry.params` is the same shape of claim: a column that stores a number nobody
 * reads is worse than no column, because a user will tune it and believe the result.
 *
 * So these tests pin the three properties that make the column real:
 *
 *   1. HONOURED   — a configured entry's value REACHES `directive.calculate()` and moves the score.
 *   2. ABSENT IS BYTE-IDENTICAL — an entry with no params passes an input with no `params` key at
 *      all, so every unconfigured protocol scores exactly as it did before #1165.
 *   3. CACHED CORRECTLY — the tick cache is keyed on the params, so changing one cannot be served
 *      the previous tick's score (which reads as "the knob does nothing").
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
  why: 'used only by this spec; proves the stored value reaches calculate()',
  source: 'entry-params.spec.ts:1',
};

/** A directive whose score IS its resolved `level`, so the parameter is directly observable. */
function tunableDirective(id: string, seen: DirectiveInput[]): IDirective {
  return {
    id,
    name: id,
    description: id,
    readiness: 'ready',
    directionBias: 'neutral',
    maxScore: 100,
    version: '1.0.0',
    params: [SPEC],
    calculate: (input: DirectiveInput) => {
      seen.push(input);
      const level = input.params?.level;
      return {
        score: typeof level === 'number' ? level : SPEC.default,
        confidence: 0.5,
        reason: `level=${String(level ?? 'default')}`,
        signalClass: 'neutral',
      };
    },
  } as IDirective;
}

function barsInput(close = 10): DirectiveInput {
  return {
    symbol: 'TEST',
    asOf: new Date('2026-01-01T00:00:00Z'),
    bars: [{ timestamp: new Date('2026-01-01T00:00:00Z'), open: 1, high: close, low: 1, close, volume: 10 }],
  };
}

function service(): DirectivesService {
  return new DirectivesService({ detect: () => conditionVector } as any, {} as any, {} as any);
}

describe('per-entry directive parameters (#1165)', () => {
  it('HONOURED: a configured entry moves the score', async () => {
    const seen: DirectiveInput[] = [];
    const svc = service();
    svc.register(tunableDirective('tunable', seen));

    const plain = await svc.runAll(barsInput(), new Set(['tunable']));
    const configured = await svc.runAll(
      barsInput(),
      new Set(['tunable']),
      [{ entryId: 'e1', directiveId: 'tunable', label: '', params: { level: 55 } }],
    );

    expect(plain.get('tunable')!.score).toBe(30);      // the declared default
    expect(configured.get('tunable')!.score).toBe(55); // the stored value
  });

  it('ABSENT IS BYTE-IDENTICAL: an unconfigured entry passes an input with NO params key', async () => {
    const seen: DirectiveInput[] = [];
    const svc = service();
    svc.register(tunableDirective('tunable', seen));

    await svc.runAll(barsInput(), new Set(['tunable']));

    // Not `params: undefined` — the key must be absent, which is what every directive saw pre-#1165.
    expect(Object.prototype.hasOwnProperty.call(seen[0], 'params')).toBe(false);
  });

  it('ABSENT IS BYTE-IDENTICAL: params for a DIFFERENT directive do not leak in', async () => {
    const seen: DirectiveInput[] = [];
    const svc = service();
    svc.register(tunableDirective('tunable', seen));

    await svc.runAll(barsInput(), new Set(['tunable']), [{ entryId: 'e2', directiveId: 'someone-else', label: '', params: { level: 55 } }]);

    expect(Object.prototype.hasOwnProperty.call(seen[0], 'params')).toBe(false);
  });

  it('CACHED CORRECTLY: two different parameter values do not share a cache entry', async () => {
    const seen: DirectiveInput[] = [];
    const svc = service();
    svc.register(tunableDirective('tunable', seen));

    const a = await svc.runAll(barsInput(), new Set(['tunable']), [{ entryId: 'e1', directiveId: 'tunable', label: '', params: { level: 40 } }]);
    const b = await svc.runAll(barsInput(), new Set(['tunable']), [{ entryId: 'e1', directiveId: 'tunable', label: '', params: { level: 45 } }]);

    expect(a.get('tunable')!.score).toBe(40);
    expect(b.get('tunable')!.score).toBe(45);
    // The second call must have re-evaluated, not returned the first result from cache.
    expect(seen.length).toBe(2);
  });

  it('CACHED CORRECTLY: the same parameters DO hit the cache', async () => {
    const seen: DirectiveInput[] = [];
    const svc = service();
    svc.register(tunableDirective('tunable', seen));

    const params = [{ entryId: 'e1', directiveId: 'tunable', label: '', params: { level: 40 } }];
    await svc.runAll(barsInput(), new Set(['tunable']), params);
    await svc.runAll(barsInput(), new Set(['tunable']), params);

    expect(seen.length).toBe(1);
  });
});
