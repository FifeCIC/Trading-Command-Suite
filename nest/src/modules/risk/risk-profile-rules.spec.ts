import {
  RISK_CONSTANT_RULES,
  LIVE_RISK_CONSTANTS,
  NOT_LIVE_RISK_CONSTANTS,
  riskEnforcementCounts,
  buildRiskProfile,
} from './risk-profile-rules';
import { SETTINGS } from '../../common/settings/settings-registry';

/**
 * The risk-profile REGISTRY — the invariants the build gate cannot check, plus the ONE behavioural
 * check that matters.
 *
 * `nest/scripts/validate-risk-profile.cjs` proves every `PortfolioRisk` key is declared, that each
 * `enforcedBy` file exists and references the field, that a `live` cap names a setting, and that no
 * cap is re-hardcoded at a call site. That is a static analysis — it reads TEXT.
 *
 * What it CANNOT see is whether the builder wires the right setting to the right key:
 *
 *     buildRiskProfile({ maxOpenPositions, maxPerSymbol: maxDrawdown, maxDrawdown: maxPerSymbol })
 *
 * …type-checks, passes every static check, and silently swaps two risk caps. `buildRiskProfile`
 * is the only place a `PortfolioRisk` may be constructed, so a mix-up there is a mix-up everywhere.
 * That is the test at the bottom of this file, and it is the reason this file exists.
 */
describe('risk-profile-rules registry — the caps declared once', () => {
  const VALID_ENFORCEMENT = ['live', 'legacy-only', 'display-only', 'none'];

  it('declares each PortfolioRisk key exactly once', () => {
    const seen = new Map<string, number>();
    for (const r of RISK_CONSTANT_RULES) seen.set(r.field, (seen.get(r.field) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([f]) => f);
    expect(dupes).toEqual([]);
  });

  it('declares all six keys of PortfolioRisk — a missing one is an undeclared cap', () => {
    // ⚠️ Hardcoded on purpose: adding a key to `PortfolioRisk` SHOULD fail this test and the build
    // gate, forcing a deliberate declaration rather than an accidental omission.
    expect(RISK_CONSTANT_RULES.map((r) => r.field).sort()).toEqual(
      ['maxDrawdown', 'maxPerSymbol', 'maxPerTradeRisk', 'maxPortfolioRisk', 'maxPositions', 'trailingStopAtProfit'],
    );
  });

  it('gives every rule a valid enforcement value, a label, a default and a summary', () => {
    for (const r of RISK_CONSTANT_RULES) {
      expect(VALID_ENFORCEMENT).toContain(r.enforcement);
      expect(r.label.trim().length).toBeGreaterThan(0);
      expect(r.summary.trim().length).toBeGreaterThan(0);
      expect(typeof r.defaultValue).toBe('number');
    }
  });

  /**
   * REGRESSION GUARD — #865.
   *
   * This is the assertion that would have caught the defect on the day it was written. `maxPerSymbol`
   * could refuse a live order and had NO setting: it was `0.25` copied into five places across four
   * files. Measured 2026-09-17 it was the largest single entry blocker — 78 refusals in one day, all
   * reading `Allocation 62.7% exceeds max per symbol 25%`, and no operator could move the number.
   *
   * If someone makes a live cap unmovable again, this fails.
   */
  it('gives every LIVE cap a setting — a cap an operator cannot move is a cap that gets worked around', () => {
    expect(LIVE_RISK_CONSTANTS.length).toBeGreaterThan(0); // guards against the filter matching nothing
    for (const r of LIVE_RISK_CONSTANTS) {
      expect(`${r.field} -> ${r.settingKey}`).not.toBe(`${r.field} -> null`);
      expect(r.settingKey).toBeTruthy();
      expect(r.enforcedBy).toBeTruthy();
    }
  });

  it('points every settingKey at a setting that actually exists', () => {
    const byKey = new Map(SETTINGS.map((s) => [s.key, s]));
    const withSetting = RISK_CONSTANT_RULES.filter((r) => r.settingKey !== null);
    expect(withSetting.length).toBeGreaterThan(0);
    for (const r of withSetting) {
      const setting = byKey.get(r.settingKey!);
      // The build gate checks this too, but a missing setting is the failure that would silently
      // reintroduce a hardcoded cap, so it is asserted where it is cheapest to read.
      expect(setting).toBeDefined();
    }
  });

  it('keeps the registry default and the settings default in step — two copies of one number is the bug', () => {
    const byKey = new Map(SETTINGS.map((s) => [s.key, s]));
    for (const r of RISK_CONSTANT_RULES) {
      if (r.settingKey === null) continue;
      const setting = byKey.get(r.settingKey);
      if (!setting) continue; // covered by the test above
      expect(`${r.field}=${r.defaultValue}`).toBe(`${r.field}=${setting.defaultValue}`);
    }
  });

  it('warns the reader on every cap that could mislead — legacy-only and none', () => {
    // Same reasoning as bot-rules.spec.ts: `legacy-only` looks enforced (it is, elsewhere) and
    // `none` looks enforced but is not. Both mislead; a caveat is required. `display-only` may carry
    // one without being forced to.
    const mustWarn = RISK_CONSTANT_RULES.filter((r) => r.enforcement === 'legacy-only' || r.enforcement === 'none');
    expect(mustWarn.length).toBeGreaterThan(0);
    for (const r of mustWarn) {
      expect(`${r.field}: ${r.caveat ?? ''}`).not.toBe(`${r.field}: `);
      expect((r.caveat ?? '').trim().length).toBeGreaterThan(20);
    }
  });

  it('only names an enforcing file for rules that assert enforcement', () => {
    for (const r of RISK_CONSTANT_RULES) {
      if (r.enforcement === 'live' || r.enforcement === 'legacy-only') expect(r.enforcedBy).toBeTruthy();
      if (r.enforcement === 'none') {
        expect(r.enforcedBy).toBeNull();
        expect(r.settingKey).toBeNull();
      }
    }
  });

  it('keeps the live / not-live split consistent with the registry', () => {
    expect(LIVE_RISK_CONSTANTS.length + NOT_LIVE_RISK_CONSTANTS.length).toBe(RISK_CONSTANT_RULES.length);
    for (const r of NOT_LIVE_RISK_CONSTANTS) expect(r.enforcement).not.toBe('live');
  });

  it('counts match the registry', () => {
    const counts = riskEnforcementCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(RISK_CONSTANT_RULES.length);
    expect(counts['live']).toBe(LIVE_RISK_CONSTANTS.length);
  });

  /**
   * BEHAVIOURAL — the check the static gate cannot make.
   *
   * The gate reads text and cannot see a swapped argument. This asserts every value arrives at the
   * right key, in one shot, with values chosen so no two are interchangeable.
   */
  describe('buildRiskProfile — the values must land on the right keys', () => {
    const VALUES = { maxOpenPositions: 7, maxPerSymbol: 0.41, maxDrawdown: 0.13 };
    const profile = buildRiskProfile(VALUES);

    it('maps maxOpenPositions to the maxPositions key', () => {
      // ⚠️ The names DIFFER on purpose: the setting is `risk.maxOpenPositions`, the interface key is
      // `maxPositions`. That mismatch is exactly where a hand-written mapping goes wrong, and it is
      // why this assertion is written out rather than looped.
      expect(profile.maxPositions).toBe(7);
    });

    it('passes maxPerSymbol and maxDrawdown through unchanged', () => {
      expect(profile.maxPerSymbol).toBe(0.41);
      expect(profile.maxDrawdown).toBe(0.13);
    });

    it('does not substitute a default for any value it was given', () => {
      // Distinct non-default values: if any key falls back to `defaultValue` (0.25 / 0.25 / 5) this
      // catches it. A silent `??` fallback would restore the hardcoded cap this change removed.
      expect(profile.maxPerSymbol).not.toBe(RISK_CONSTANT_RULES.find((r) => r.field === 'maxPerSymbol')!.defaultValue);
      expect(profile.maxDrawdown).not.toBe(RISK_CONSTANT_RULES.find((r) => r.field === 'maxDrawdown')!.defaultValue);
      expect(profile.maxPositions).not.toBe(5);
    });

    it('carries the unread constants at their declared defaults', () => {
      const declared = (f: string) => RISK_CONSTANT_RULES.find((r) => r.field === f)!.defaultValue;
      expect(profile.maxPortfolioRisk).toBe(declared('maxPortfolioRisk'));
      expect(profile.maxPerTradeRisk).toBe(declared('maxPerTradeRisk'));
      expect(profile.trailingStopAtProfit).toBe(declared('trailingStopAtProfit'));
    });

    it('returns a complete PortfolioRisk — no key left undefined', () => {
      const keys = ['maxPortfolioRisk', 'maxPerTradeRisk', 'maxPerSymbol', 'maxPositions', 'maxDrawdown', 'trailingStopAtProfit'];
      for (const k of keys) {
        expect(`${k}=${typeof (profile as unknown as Record<string, unknown>)[k]}`).toBe(`${k}=number`);
      }
    });
  });
});
