/**
 * run-differences.spec.ts — canary for `describeRunDifferences()`.
 *
 * The guard has to fail in BOTH directions, because both failures are silent and produce a
 * confident page:
 *   • report a difference that is not there  → the reader chases a setting they never changed
 *   • report "same" where one side recorded nothing → an UNKNOWN is credited to both sides as a match
 *
 * The measured case behind it (2026-10-31): four VIX runs listed at +76,617 … +141,219 with identical
 * protocol, symbol, timeframe, trade count, win rate and profit factor. The only inputs that differed
 * were spread and slippage — one run costed a 0.01% spread, another 0.93%.
 */
import { describeRunDifferences, type RunSettingsRow } from './run-differences';

const base: RunSettingsRow = {
  id: 'a',
  symbol: 'VIX',
  protocolId: 'vix-spike-v1',
  timeframe: '5m',
  startDate: new Date('2026-09-09T00:00:00Z'),
  endDate: new Date('2026-10-20T00:00:00Z'),
  periodId: 'dev-window-v1',
  newsExclusion: 'none',
  directionMode: 'long',
  positionModel: 'fixedPercent',
  accountSize: 10_000,
  riskPct: 2,
  fixedAmount: null,
  slippage: 0.0004,
  spread: 0.0093,
  commission: 0,
  botId: null,
  botBaseSize: null,
  configVersion: 3,
  iteration: 1,
  maxLeverage: 1,
  windowSource: 'period:dev-window-v1',
  unitStep: null,
  fixedUnits: null,
};

const run = (over: Partial<RunSettingsRow> = {}): RunSettingsRow => ({ ...base, ...over });

describe('describeRunDifferences', () => {
  it('names the ONE setting that moved — the four-run case', () => {
    const d = describeRunDifferences([
      run({ id: 'a', spread: 0.0001, slippage: 0.0001 }),
      run({ id: 'b', spread: 0.0093, slippage: 0.0004 }),
    ]);
    const fields = d.changed.map((c) => c.field);
    expect(fields).toContain('spread');
    expect(fields).toContain('slippage');
    // Everything else is genuinely identical and must not be listed as a change.
    expect(fields).not.toContain('protocolId');
    expect(fields).not.toContain('timeframe');
    expect(fields).not.toContain('accountSize');
    expect(d.changedCount).toBe(2);
    // The values are rendered with their unit and in run order.
    const spread = d.changed.find((c) => c.field === 'spread')!;
    expect(spread.values).toEqual(['0.01%', '0.93%']);
  });

  it('reports NOTHING changed when the settings are identical (the other direction)', () => {
    const d = describeRunDifferences([run({ id: 'a' }), run({ id: 'b' })]);
    expect(d.changedCount).toBe(0);
    expect(d.changed).toEqual([]);
    expect(d.sameCount).toBeGreaterThan(0);
  });

  it('never treats "not recorded" as equal to a value', () => {
    const d = describeRunDifferences([run({ id: 'a', spread: null }), run({ id: 'b', spread: 0.0093 })]);
    const spread = d.changed.find((c) => c.field === 'spread');
    expect(spread).toBeDefined();
    expect(spread!.unrecorded).toBe(true);
    expect(spread!.values).toEqual([null, '0.93%']);
  });

  it('reports two absences as a SHARED GAP, flagged, not as a shared setting', () => {
    const d = describeRunDifferences([run({ id: 'a', botBaseSize: null }), run({ id: 'b', botBaseSize: null })]);
    const lot = d.same.find((s) => s.field === 'botBaseSize');
    expect(lot).toBeDefined();
    expect(lot!.unrecorded).toBe(true);
    expect(lot!.value).toBe('not recorded');
  });

  it('returns an empty diff for one run rather than claiming everything matches', () => {
    const d = describeRunDifferences([run()]);
    // `order` still carries the single row it was given — that is how "one run" is told apart from
    // "no runs" by a consumer that only reads the payload.
    expect(d).toEqual({ changed: [], same: [], changedCount: 0, sameCount: 0, order: ['a'] });
  });

  it('distinguishes a bot-driven run from a hand-assembled one', () => {
    const d = describeRunDifferences([
      run({ id: 'a' }),
      run({ id: 'b', botId: '36562144-f07a-47d5-ac80-a693c9318c5a', botBaseSize: 0.1 }),
    ]);
    expect(d.changed.map((c) => c.field)).toEqual(expect.arrayContaining(['botId', 'botBaseSize']));
    expect(d.changed.find((c) => c.field === 'botId')!.values).toEqual(['not bot-driven', '36562144']);
  });

  it('keeps percent-as-fraction and percent-as-percent apart (#980)', () => {
    // `riskPct` is already a percent; `spread` is a fraction OF PRICE. 2 must read "2%", not "200%".
    const d = describeRunDifferences([run({ id: 'a' }), run({ id: 'b', riskPct: 5 })]);
    const risk = d.changed.find((c) => c.field === 'riskPct')!;
    expect(risk.values).toEqual(['2%', '5%']);
    const spread = describeRunDifferences([run({ id: 'a' }), run({ id: 'b' })]);
    expect(spread.changed).toEqual([]);
  });

  it('surfaces a window difference, which invalidates a like-for-like claim', () => {
    const d = describeRunDifferences([
      run({ id: 'a' }),
      run({ id: 'b', startDate: new Date('2026-01-01T00:00:00Z') }),
    ]);
    expect(d.changed.map((c) => c.field)).toContain('startDate');
    expect(d.changed.find((c) => c.field === 'startDate')!.values).toEqual(['2026-09-09', '2026-01-01']);
  });

  it('groups the rows so sizing and costs lead', () => {
    const d = describeRunDifferences([
      run({ id: 'a', spread: 0.01, riskPct: 1, timeframe: '15m' }),
      run({ id: 'b' }),
    ]);
    const groups = d.changed.map((c) => c.group);
    // Every group present in the diff is a declared one, and costs/sizing are represented.
    expect(groups.every((g) => ['scope', 'sizing', 'costs', 'provenance'].includes(g))).toBe(true);
    expect(groups).toContain('costs');
    expect(groups).toContain('sizing');
    expect(groups).toContain('scope');
  });

  /**
   * #1155 — A LONG RUN AND A SHORT RUN ARE NOT "THE SAME SETTINGS".
   *
   * This is the case that makes the field mandatory: if two runs are identical apart from the sides
   * they were allowed to open, the ONLY difference between them is direction, and a diff that omitted
   * it would report "no setting differs" over two opposite results.
   */
  it('reports a LONG-vs-SHORT pair as a difference, never as "everything the same"', () => {
    const d = describeRunDifferences([
      run({ id: 'a', directionMode: 'long' }),
      run({ id: 'b', directionMode: 'short' }),
    ]);
    const row = d.changed.find((c) => c.field === 'directionMode');
    expect(row).toBeDefined();
    expect(row!.values).toEqual(['long', 'short']);
    expect(row!.group).toBe('scope');
    expect(d.changedCount).toBe(1);
  });

  it('treats a pre-column row as long, because that is what it could only have been', () => {
    const d = describeRunDifferences([
      run({ id: 'a', directionMode: null }),
      run({ id: 'b', directionMode: 'long' }),
    ]);
    expect(d.changed.map((c) => c.field)).not.toContain('directionMode');
  });

  /**
   * #1141 — the notional cap and the window mechanism were persisted but never diffed, so two runs
   * sized 1× and 10× (or measured over a frozen period and a rolling day range) compared as equals.
   * `maxLeverage` belongs to `sizing` because it changes the money on every trade; `windowSource`
   * belongs to `scope` because it changes WHICH BARS were measured, not how big the position was.
   */
  it('surfaces a notional-cap difference, and renders it with its multiplier', () => {
    const d = describeRunDifferences([
      run({ id: 'a', maxLeverage: 1 }),
      run({ id: 'b', maxLeverage: 10 }),
    ]);
    const row = d.changed.find((c) => c.field === 'maxLeverage');
    expect(row).toBeDefined();
    expect(row!.values).toEqual(['1×', '10×']);
    expect(row!.group).toBe('sizing');
  });

  it('surfaces a window-mechanism difference even when the dates match', () => {
    // Two runs can cover the same dates by accident while one is reproducible (`period:<name>`) and
    // the other is a rolling range that will not be. The dates alone cannot show that.
    const d = describeRunDifferences([
      run({ id: 'a', windowSource: 'period:dev-window-v1' }),
      run({ id: 'b', windowSource: 'days-range' }),
    ]);
    const row = d.changed.find((c) => c.field === 'windowSource');
    expect(row).toBeDefined();
    expect(row!.values).toEqual(['period:dev-window-v1', 'days-range']);
    expect(row!.group).toBe('scope');
  });

  it('reports a pre-#1141 row as UNRECORDED rather than as matching 1x', () => {
    // The dangerous reading: `null` coerced to 1 would say "this row was unleveraged" — a claim the
    // row never made. It must land in `changed` with `unrecorded` set, not in `same`.
    const d = describeRunDifferences([
      run({ id: 'a', maxLeverage: null }),
      run({ id: 'b', maxLeverage: 1 }),
    ]);
    const row = d.changed.find((c) => c.field === 'maxLeverage');
    expect(row).toBeDefined();
    expect(row!.unrecorded).toBe(true);
  });

  /**
   * ⚠️ `order` EXISTS BECAUSE `values` IS POSITIONAL. The API re-sorts runs by `createdAt desc`, so a
   * consumer that assumes "first value = run A" prints A's settings under B's heading whenever A is
   * the newer run — plausible output, no error. The order must be stated, not inferred.
   */
  it('states the run order its positional values are aligned to', () => {
    const d = describeRunDifferences([
      run({ id: 'newer', maxLeverage: 4 }),
      run({ id: 'older', maxLeverage: 1 }),
    ]);
    expect(d.order).toEqual(['newer', 'older']);
    // …and the values follow that order exactly.
    expect(d.changed.find((c) => c.field === 'maxLeverage')!.values).toEqual(['4×', '1×']);
  });
});
