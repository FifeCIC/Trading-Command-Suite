import {
  defaultParams,
  ParamValidationError,
  resolveParams,
  specProblems,
  validateSupplied,
  type BooleanParamSpec,
  type NumericParamSpec,
} from './parameters';

const period: NumericParamSpec = {
  key: 'rsiPeriod',
  label: 'RSI period',
  type: 'number',
  default: 14,
  min: 2,
  max: 60,
  step: 1,
  unit: 'bars',
  chart: 'series',
  why: 'Measured 2026-11-01: RSI-7 and RSI-14 shared 1 of 70 entry events on VIX 1h.',
  source: 'rsi-oversold.directive.ts:26',
};

const oversold: NumericParamSpec = {
  key: 'oversoldLevel',
  label: 'Oversold level',
  type: 'number',
  default: 30,
  min: 5,
  max: 50,
  step: 1,
  chart: 'threshold',
  why: 'Measured 2026-11-01: MFI-oversold fired 0 events on NVDA 1d over 9 months — the gate never trips.',
  source: 'rsi-oversold.directive.ts:99',
};

const flag: BooleanParamSpec = {
  key: 'requireCurl',
  label: 'Require curl',
  type: 'boolean',
  default: true,
  chart: 'none',
  why: 'Curl confirmation is a distinct regime and may not suit a mean-reverting index.',
  source: 'rsi-oversold.directive.ts:110',
};

const specs = [period, oversold, flag];

describe('resolveParams — the READ path, which must never throw', () => {
  it('returns the declared defaults when nothing is supplied', () => {
    const { values, warnings } = resolveParams('test', specs, undefined);
    expect(values).toEqual({ rsiPeriod: 14, oversoldLevel: 30, requireCurl: true });
    expect(warnings).toEqual([]);
  });

  it('treats null and undefined per key as absent rather than as zero or false', () => {
    const { values } = resolveParams('test', specs, { rsiPeriod: null, oversoldLevel: undefined });
    expect(values.rsiPeriod).toBe(14);
    expect(values.oversoldLevel).toBe(30);
  });

  it('applies a supplied value that is inside the declared range', () => {
    const { values, warnings } = resolveParams('test', specs, { rsiPeriod: 21, requireCurl: false });
    expect(values.rsiPeriod).toBe(21);
    expect(values.requireCurl).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('CLAMPS an out-of-range value and says so, rather than accepting it silently', () => {
    const { values, warnings } = resolveParams('test', specs, { rsiPeriod: 500 });
    expect(values.rsiPeriod).toBe(60);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('rsiPeriod');
    expect(warnings[0]).toContain('clamped');
  });

  it('falls back to the default on a wrong type and says so', () => {
    // @ts-expect-error deliberately wrong type, which is what a JSON body can actually carry
    const { values, warnings } = resolveParams('test', specs, { rsiPeriod: '21' });
    expect(values.rsiPeriod).toBe(14);
    expect(warnings[0]).toContain('expected a finite number');
  });

  it('rejects NaN rather than propagating it into the indicator', () => {
    const { values, warnings } = resolveParams('test', specs, { rsiPeriod: Number.NaN });
    expect(values.rsiPeriod).toBe(14);
    expect(warnings[0]).toContain('finite');
  });

  it('REPORTS an unknown key instead of dropping it — a silently ignored typo looks like a working knob', () => {
    const { values, warnings } = resolveParams('test', specs, { rsiPerod: 21 } as never);
    expect(values.rsiPeriod).toBe(14);
    expect(warnings.some((w) => w.includes('unknown parameter "rsiPerod"'))).toBe(true);
  });

  it('keeps every warning, so two problems are both visible', () => {
    const { warnings } = resolveParams('test', specs, { rsiPeriod: 999, nope: 1 } as never);
    expect(warnings.length).toBe(2);
  });
});

describe('validateSupplied — the WRITE path, which must be loud', () => {
  it('accepts a valid set', () => {
    expect(() => validateSupplied('test', specs, { rsiPeriod: 21 })).not.toThrow();
  });

  it('accepts null/undefined as "use the defaults"', () => {
    expect(() => validateSupplied('test', specs, null)).not.toThrow();
    expect(() => validateSupplied('test', specs, undefined)).not.toThrow();
  });

  it('THROWS on an unknown key — naming the known keys so the typo is obvious', () => {
    let err: unknown;
    try { validateSupplied('test', specs, { rsiPerod: 21 } as never); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ParamValidationError);
    expect((err as ParamValidationError).problems[0]).toContain('rsiPerod');
    expect((err as ParamValidationError).problems[0]).toContain('rsiPeriod');
  });

  it('THROWS on an out-of-range value instead of clamping — a stored number must be the number asked for', () => {
    expect(() => validateSupplied('test', specs, { rsiPeriod: 500 })).toThrow(ParamValidationError);
  });

  it('THROWS on a wrong type', () => {
    expect(() => validateSupplied('test', specs, { requireCurl: 1 as never })).toThrow(ParamValidationError);
  });

  it('reports EVERY problem at once, not just the first', () => {
    let err: ParamValidationError | undefined;
    try { validateSupplied('test', specs, { rsiPeriod: 500, oversoldLevel: 99, nope: 1 } as never); } catch (e) { err = e as ParamValidationError; }
    expect(err?.problems).toHaveLength(3);
  });
});

describe('specProblems — a spec must not be able to mislead a control', () => {
  it('accepts a well-formed spec', () => {
    expect(specProblems(specs)).toEqual([]);
  });

  it('catches a duplicate key, which would make one control shadow another', () => {
    expect(specProblems([period, { ...oversold, key: 'rsiPeriod' }]).join(' ')).toContain('duplicate');
  });

  it('catches a default outside its own range — the control would snap on first touch', () => {
    expect(specProblems([{ ...period, default: 999 }]).join(' ')).toContain('outside');
  });

  it('catches min > max', () => {
    expect(specProblems([{ ...period, min: 50, max: 10 }]).join(' ')).toContain('min 50 > max 10');
  });

  it('requires a chart role — a knob with no rendering path is a buried ability', () => {
    expect(specProblems([{ ...period, chart: undefined as never }]).join(' ')).toContain('chart');
  });

  it('rejects an unknown chart role', () => {
    expect(specProblems([{ ...period, chart: 'sparkline' as never }]).join(' ')).toContain('unknown chart role');
  });

  it('accepts `none` as a deliberate answer for a knob that cannot be charted', () => {
    expect(specProblems([{ ...period, chart: 'none' }])).toEqual([]);
  });

  it('requires a real `why` — a restated label is not a justification', () => {
    expect(specProblems([{ ...period, why: 'period' }]).join(' ')).toContain('why');
  });

  it('requires a file:line `source` for the constant being replaced', () => {
    expect(specProblems([{ ...period, source: 'rsi-oversold.directive.ts' }]).join(' ')).toContain('file:line');
  });
});

describe('defaultParams', () => {
  it('is exactly what an instance with no parameters resolves to', () => {
    expect(defaultParams(specs)).toEqual(resolveParams('test', specs, undefined).values);
  });
});
