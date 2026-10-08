/**
 * signal-threshold-scale.spec.ts — PINS the 2026-09-15 threshold rescale (#761).
 * =============================================================================
 * WHY THIS FILE EXISTS
 * --------------------
 * The classification bands (ENTRY 40 → 6, STRONG 80 → 13, gate 65 → 10) were
 * silently invalidated by the ADR-011 denominator change (#758 — observed sum
 * → CONFIGURED capacity, a ~6.3x larger divisor). Against the stale bars,
 * `signal` was HOLD on every tick and live trading stopped for FIVE DAYS
 * (2026-09-10 → 09-15; zero executions and zero queue entries in between).
 *
 * ⚠️ This is the SECOND breakage of these same constants — the first was
 * 2026-08-12 ("absolute constants calibrated for an old 0-100 scale"), which is
 * exactly the defect #638 claimed to have closed 26 days before it recurred.
 * A checklist tick did not prevent it; a test will.
 *
 * To be clear about what is being pinned: these numbers are a UNITS MIGRATION
 * (old ÷ ~6.3, ordering preserved), not a tuning decision. Re-tuning them is
 * allowed and expected — from measured outcomes (#817) — but it must be a
 * DELIBERATE act that also updates this spec, not a silent edit. Maths-change
 * policy: `.github/instructions/maths-change-requires-ab.instructions.md`.
 *
 * ❌ If this spec fails: do NOT "fix the test" by pasting the new number in.
 *    Read `protocol-gating.service.ts` → "RESCALED 2026-09-15" first and
 *    establish whether the change was deliberate, recorded, and guarded.
 *
 * CANARY (observed, 2026-10-07):
 *   - protocol-gating ENTRY_THRESHOLD 6 → 40 (the pre-rescale value, i.e. the
 *     reintroduced defect): this file FAILS (bands + boundary tests).
 *   - style-thresholds swing 9 → 14 (breaks the preserved ordering): FAILS.
 *   Both restored and verified byte-for-byte.
 */
import { SIGNAL_THRESHOLDS, STRONG_PCT } from './protocol-gating.service';
import { normalizeScorePercent } from './score-units';
import {
  STYLE_THRESHOLDS,
  SIGNALS_GATE_DEFAULT,
  BOT_BAR_DEFAULT,
  resolveStyleThreshold,
} from '../../common/utils/style-thresholds';

describe('Threshold scale — the 2026-09-15 rescale is pinned (#761)', () => {
  it('classification bands are the rescaled values (was 40 / 80)', () => {
    expect(SIGNAL_THRESHOLDS.entry).toBe(6);
    expect(SIGNAL_THRESHOLDS.strong).toBe(13);
    // STRONG_PCT must be the same number the classifier branches on — it is
    // module scope precisely so callers (Settings) cannot hold a stale copy.
    expect(STRONG_PCT).toBe(SIGNAL_THRESHOLDS.strong);
  });

  it('the scale is declared as CONFIGURED capacity, never an observed sum', () => {
    // The denominator is the thing the rescale was calibrated against.
    // An observed-sum denominator here means ADR-011 / INV-STABLE-DENOMINATOR
    // has been reverted and EVERY percentage has silently changed meaning.
    expect(SIGNAL_THRESHOLDS.scale).toContain('CONFIGURED');
  });

  it('band ordering and reachability arithmetic (worked example: gold-macro-v1)', () => {
    expect(SIGNAL_THRESHOLDS.strong).toBeGreaterThan(SIGNAL_THRESHOLDS.entry);
    // gold-macro-v1's configured capacity is 795. A reading of 104 raw points
    // is 13.1% — it MUST classify STRONG (≥13), not merely BUY.
    const strongReading = normalizeScorePercent(104, 795);
    expect(strongReading).toBeGreaterThanOrEqual(SIGNAL_THRESHOLDS.strong);
    // 79/795 = 9.9% — inside the BUY band (≥6, <13). Under the pre-rescale 40
    // this was HOLD, which is why nothing traded for five days.
    const buyReading = normalizeScorePercent(79, 795);
    expect(buyReading).toBeGreaterThanOrEqual(SIGNAL_THRESHOLDS.entry);
    expect(buyReading).toBeLessThan(SIGNAL_THRESHOLDS.strong);
    // 31/795 = 3.9% — genuinely below entry: HOLD is the correct outcome here.
    expect(normalizeScorePercent(31, 795)).toBeLessThan(SIGNAL_THRESHOLDS.entry);
  });

  it('style bars are the rescaled table with ordering preserved', () => {
    expect(STYLE_THRESHOLDS).toEqual({
      scalp: 12,
      speed: 13,
      'day-trade': 10,
      swing: 9,
      position: 7,
    });
    // Ordering is part of the derivation (old ÷ ~6.3, order preserved):
    // speed is the strictest, position/tick the most permissive.
    const bars = STYLE_THRESHOLDS as Record<string, number>;
    expect(bars.speed).toBeGreaterThan(bars.scalp);
    expect(bars.scalp).toBeGreaterThan(bars['day-trade']);
    expect(bars['day-trade']).toBeGreaterThan(bars.swing);
    expect(bars.swing).toBeGreaterThan(bars.position);
    // Every bar must sit BELOW the measured protocol peaks (10–33 on the new
    // scale, 2026-09-15) or the rescale solved nothing.
    for (const bar of Object.values(bars)) {
      expect(bar).toBeLessThan(20);
    }
  });

  it('gate defaults are rescaled and style resolution still works end to end', () => {
    expect(SIGNALS_GATE_DEFAULT).toBe(10); // was 65
    expect(BOT_BAR_DEFAULT).toBe(10);      // was 60

    expect(resolveStyleThreshold('Tick Scalp')).toMatchObject({ threshold: 12, source: 'style' });
    expect(resolveStyleThreshold('Speed')).toMatchObject({ threshold: 13, source: 'style' });
    // The extended-vocabulary case that used to fall through to a mystery
    // default and stalled forex-session-v1 (see style-thresholds.ts header).
    expect(resolveStyleThreshold('Session / Mean Reversion')).toMatchObject({
      threshold: 10,
      source: 'style',
    });
    // Unclassifiable styles resolve to the caller's default with provenance,
    // never silently to a hardcoded number.
    expect(resolveStyleThreshold('Some Future Style')).toMatchObject({
      threshold: SIGNALS_GATE_DEFAULT,
      source: 'default',
    });
  });
});
