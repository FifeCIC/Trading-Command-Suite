/**
 * #1224 — THE IDENTITY COVERAGE GUARD.
 *
 * ⚠️ WHY THIS EXISTS. `strategyKey` hashed protocol + role + market + broker + a hand-written list of
 * treatment fields. When the bot gained `takeProfitAmount`, `sizingModel`, `sizingRiskPct`, the
 * simulated trailing stop, exhaustion observation and hot-stock allocation, nobody added them — so
 * `DAX Five Pound Target Bot` and `DAX Index Tick Scalp Bot` hashed IDENTICALLY while differing in
 * their take profit (5 vs null). Two different exit policies, one identity, and the registry reported
 * a single strategy.
 *
 * The fix is the field list; the guard is this file. **A new bot column now fails the build until it
 * is classified** — either it is read by `buildTreatment` (and so hashed), or it is declared
 * deliberately unkeyed WITH A REASON. There is no third option, which is the point: "forgotten" is
 * not a classification.
 *
 * The classification function is pure and canaried in both directions below, because a guard that
 * cannot be made to fail is a decoration.
 */
import { Prisma } from '@prisma/client';
import {
  IDENTITY_TOP_LEVEL_COLUMNS,
  DECLARED_UNKEYED_FIELDS,
  TREATMENT_FIELD_NAMES,
  buildTreatment,
} from './strategy-derivation.service';

/** Columns on the bot table, from the generated client (so a schema change reaches this test). */
function botColumns(): string[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'TradingStrategy');
  if (!model) throw new Error('TradingStrategy model not found in the Prisma DMMF');
  return model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => f.name);
}

/** Columns nothing has classified. Pure, so it can be canaried without touching the schema. */
function unclassified(columns: string[]): string[] {
  const known = new Set<string>([
    ...IDENTITY_TOP_LEVEL_COLUMNS,
    ...TREATMENT_FIELD_NAMES,
    ...Object.keys(DECLARED_UNKEYED_FIELDS),
  ]);
  return columns.filter((c) => !known.has(c));
}

describe('strategy identity covers every bot column (#1224)', () => {
  it('every TradingStrategy column is either hashed or declared unkeyed with a reason', () => {
    const columns = botColumns();
    // Guard against the guard silently reading nothing — an empty list would otherwise "pass".
    expect(columns.length).toBeGreaterThan(30);
    expect(unclassified(columns)).toEqual([]);
  });

  it('CANARY — a new money field is reported until it is classified', () => {
    const columns = botColumns();
    // The exact shape of the #1224 defect: a behaviour field nobody added to the key.
    expect(unclassified([...columns, 'takeProfitAmountV2'])).toEqual(['takeProfitAmountV2']);
    expect(unclassified([...columns, 'sizingModelV2', 'trailingStopPct'])).toEqual([
      'sizingModelV2',
      'trailingStopPct',
    ]);
  });

  it('CANARY — a declared-unkeyed column is NOT reported, so the allowlist works', () => {
    expect(unclassified(['name', 'magic'])).toEqual([]);
  });

  it('the unkeyed declaration never claims a field the key actually hashes', () => {
    // The old `UNKEYED_FIELDS` listed `mode`, `maxHoldHours` and `maxSize` while the key hashed all
    // three — a message that lied about the thing it described. This asserts the two never overlap.
    const overlap = TREATMENT_FIELD_NAMES.filter((f) => f in DECLARED_UNKEYED_FIELDS);
    expect(overlap).toEqual([]);
  });

  it('every declared-unkeyed field carries a reason, not just a name', () => {
    const missing = Object.entries(DECLARED_UNKEYED_FIELDS)
      .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 5)
      .map(([field]) => field);
    expect(missing).toEqual([]);
  });

  it('the hashed field names are exactly the treatment fields', () => {
    const built = Object.keys(buildTreatment({})).sort();
    expect(built).toEqual([...TREATMENT_FIELD_NAMES].sort());
    // The treatment is the authority — `TREATMENT_FIELD_NAMES` is derived from it, so a field that
    // exists in one and not the other means the derivation was bypassed by hand.
    expect(built.length).toBe(TREATMENT_FIELD_NAMES.length);
  });

  it('the money fields that caused #1224 really do change the key', () => {
    const base = buildTreatment({ minComposite: 10, mode: 'auto', timeframe: '5m', cooldownMinutes: 5 });
    const withTp = buildTreatment({ minComposite: 10, mode: 'auto', timeframe: '5m', cooldownMinutes: 5, takeProfitAmount: 5 });
    expect(withTp.takeProfitAmount).toBe(5);
    expect(base.takeProfitAmount).toBeNull();
    // Re-imported here rather than at the top so the diff between the two calls is visible.
    const { computeStrategyKey } = jest.requireActual('./strategy-derivation.service') as typeof import('./strategy-derivation.service');
    const keyA = computeStrategyKey('dax-speed-v1-long', 'long', 'GER40', 'mt5', base);
    const keyB = computeStrategyKey('dax-speed-v1-long', 'long', 'GER40', 'mt5', withTp);
    expect(keyA).not.toBe(keyB);
    expect(keyA.startsWith('v2:')).toBe(true);
  });
});
