import {
  RUNTIME_SETTINGS,
  SETTINGS,
  SETTING_FAMILIES,
  matchFamily,
  validateFamilyValue,
} from './settings-registry';
import {
  ensureDeclaredSettings,
  SettingsSeederPrisma,
} from './settings-seeder';

/**
 * settings-family.spec.ts — the KEY-FAMILY mechanism, and above all its safety property.
 *
 * WHY THIS FILE EXISTS (#849)
 * ---------------------------
 * The 2026-09-17 inventory measured 462 `global_setting` keys, 442 of which are
 * `directive:<id>:<field>` config. Declaring them individually would mean inventing 442 defaults, and
 * `maxScore` is a scoring WEIGHT — inventing it is the same class of mistake as declaring
 * `automation.tradingEnabled` as `true`.
 *
 * Families exist so those keys can have an owner, validation and provenance **without any default**.
 * That gives one property which everything else depends on:
 *
 *     A FAMILY MEMBER IS NEVER SEEDED.
 *
 * If that ever stops being true, `ensureDefaults()` would begin materialising scoring weights on every
 * boot — silently changing which protocols fire. It is asserted here directly rather than left implicit
 * in the seeder's loop, because that loop is the kind of code a later author simplifies.
 */

function stubPrisma(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const created: string[] = [];
  const prisma: SettingsSeederPrisma = {
    globalSetting: {
      create({
        data,
      }: {
        data: { key: string; value: string };
      }): Promise<unknown> {
        created.push(data.key);
        rows.set(data.key, data.value);
        return Promise.resolve(data);
      },
      findMany({
        where,
      }: {
        where: { key: { in: string[] } };
      }): Promise<Array<{ key: string }>> {
        return Promise.resolve(
          [...rows.keys()]
            .filter((k) => where.key.in.includes(k))
            .map((k) => ({ key: k })),
        );
      },
    },
  };
  return { prisma, rows, created };
}

describe('key families', () => {
  it('matches a directive field key and separates subject from field', () => {
    const m = matchFamily('directive:adx:maxScore');
    expect(m).not.toBeNull();
    expect(m.family.id).toBe('directive');
    expect(m.subject).toBe('adx');
    expect(m.field).toBe('maxScore');
  });

  it('matches a real directive slug containing a dot-free hyphenated name', () => {
    // Slugs measured in the live database: bollinger-band-squeeze, cad-usd-oil-correlation, doji-pattern
    const m = matchFamily('directive:bollinger-band-squeeze:minScore');
    expect(m?.subject).toBe('bollinger-band-squeeze');
    expect(m?.field).toBe('minScore');
  });

  it('matches the per-broker trading flag (fieldless key)', () => {
    const m = matchFamily('automation.brokerTrading.mt5');
    expect(m).not.toBeNull();
    expect(m.family.id).toBe('brokerTrading');
    expect(m.subject).toBe('mt5');
    expect(m.field).toBe('__value');
  });

  it('returns null for a key no family covers — that is the "undeclared" signal', () => {
    expect(matchFamily('earnings_import_last')).toBeNull();
    expect(matchFamily('signal.buy_threshold')).toBeNull();
    expect(matchFamily('directive:adx:notAField')).toBeNull();
    // A protocol-scoped directive key is a different shape and must NOT be swallowed by the family.
    expect(matchFamily('directive:adx:maxScore:extra')).toBeNull();
  });

  // ── THE SAFETY PROPERTY ─────────────────────────────────────────────────────

  it('a family member is NEVER seeded, even when the store is empty', async () => {
    const { prisma, created } = stubPrisma();

    const report = await ensureDeclaredSettings(prisma);

    expect(report.created).toEqual(RUNTIME_SETTINGS.map((s) => s.key));
    // No seeded key may match a family pattern.
    for (const key of created) {
      expect(matchFamily(key)).toBeNull();
    }
  });

  it('a family member present in the store is left alone and never reported as created', async () => {
    const { prisma, rows } = stubPrisma({ 'directive:adx:maxScore': '120' });

    const report = await ensureDeclaredSettings(prisma);

    expect(report.created).not.toContain('directive:adx:maxScore');
    expect(rows.get('directive:adx:maxScore')).toBe('120');
  });

  it('no family field carries a default — the structural reason seeding cannot touch it', () => {
    // This is the guard on the guard. If a `default` ever appears on a family field, someone has turned
    // a family into a seeded setting without noticing, and the property above would be one refactor away
    // from breaking. Asserted structurally rather than behaviourally so it fails at the source.
    for (const family of SETTING_FAMILIES) {
      for (const [name, field] of Object.entries(family.fields)) {
        expect(Object.keys(field)).not.toContain('default');
        expect(Object.keys(field)).not.toContain('defaultValue');
        // …and the family itself must not be seedable.
        expect(family).not.toHaveProperty('defaultValue');
        void name;
      }
    }
  });

  it('RUNTIME_SETTINGS (the seeding list) contains no family-matched key', () => {
    for (const def of RUNTIME_SETTINGS) {
      expect(matchFamily(def.key)).toBeNull();
    }
    // And every individually-declared key is still individually declared.
    expect(SETTINGS.length).toBeGreaterThanOrEqual(RUNTIME_SETTINGS.length);
  });

  // ── VALIDATION ──────────────────────────────────────────────────────────────

  it('accepts a plausible maxScore and rejects values outside the declared bounds', () => {
    const field = SETTING_FAMILIES.find((f) => f.id === 'directive').fields
      .maxScore;
    expect(validateFamilyValue(field, '120').ok).toBe(true);
    expect(validateFamilyValue(field, 200).ok).toBe(true);
    // 0 and negatives are meaningless for a weight, and 5000 would dwarf every other directive.
    expect(validateFamilyValue(field, '0').ok).toBe(false);
    expect(validateFamilyValue(field, '-5').ok).toBe(false);
    expect(validateFamilyValue(field, '5000').ok).toBe(false);
    expect(validateFamilyValue(field, 'abc').ok).toBe(false);
  });

  it('accepts any non-empty string for directionBias — allowed values are documented, not enforced', () => {
    const field = SETTING_FAMILIES.find((f) => f.id === 'directive').fields
      .directionBias;
    expect(validateFamilyValue(field, 'LONG_ONLY').ok).toBe(true);
    // ⚠️ Not enforced on purpose: an over-tight validator that rejects a valid value makes the row
    // unreadable, which looks like data corruption rather than like a limit.
    expect(validateFamilyValue(field, 'OPPORTUNISTIC').ok).toBe(true);
    expect(field.allowed).toContain('LONG_ONLY');
  });

  it('the per-broker flag validates as a boolean', () => {
    const field = SETTING_FAMILIES.find((f) => f.id === 'brokerTrading').fields
      .__value;
    expect(validateFamilyValue(field, 'true').ok).toBe(true);
    expect(validateFamilyValue(field, false).ok).toBe(true);
    expect(validateFamilyValue(field, 'yes').ok).toBe(false);
  });

  it('documented families cover the open-ended shapes measured in the database', () => {
    // Measured 2026-09-17: 442 directive keys across 101 directives, one brokerTrading key, and
    // ZERO `protocol:` keys.
    //
    // ⚠️ This test did its job: it FAILED when `protocol` was added, which is exactly what it is
    // for — "If a third open-ended shape appears, this test is where its absence becomes visible."
    // The failure was reviewed and the family is a deliberate declaration (complete pattern,
    // prefix, subjectGroup/fieldGroup and fields), so the expectation is updated rather than the
    // family removed. It is declared so the WRITE path has an owner, not because anything reads it.
    //
    // If a FOURTH family is added, this test fails again — update it only after confirming the
    // new family is intentional.
    expect(SETTING_FAMILIES.map((f) => f.id).sort()).toEqual([
      'brokerTrading',
      'directive',
      'protocol',
    ]);
  });
});
