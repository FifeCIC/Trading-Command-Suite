/**
 * overfit-verdict.ts — "did this survive OUT of sample, or did it only fit the window it was tuned on?"
 *
 * ── WHY THIS EXISTS (#1201, 2026-11-06) ─────────────────────────────────────────────────────
 * `POST /api/backtest/walk-forward` already optimises on a train window and measures a test window,
 * and returns `outOfSampleWinRate`. So the hardest part exists. What did not exist anywhere was the
 * COMPARISON: a run scoring 61% in-sample and 12% out-of-sample rendered identically to one scoring
 * 40%/38%, because both are just two numbers. The repo's most repeated defect shape — **plausible
 * numbers, no error** — and the owner's own words: *"no surface says which strategies SURVIVED."*
 *
 * ── THE RULE, STATED ONCE (and this is the only place it is stated) ──────────────────────────
 * Retention = out-of-sample win rate ÷ in-sample win rate.
 *
 *   ≥ 0.75  → **survived**  — three quarters of the tuned performance held up on data it never saw
 *   ≥ 0.50  → **decayed**   — real but materially weaker; usable, not what the tuning promised
 *   < 0.50  → **overfit**   — most of the performance was the window, not the rule
 *
 * A **ratio**, not an absolute gap, because a 5-point fall from 80% is a different event from a
 * 5-point fall from 12%. The thresholds are POLICY numbers, chosen here and nowhere else — the same
 * discipline `verdict-bar.ts` applies to the sample bar. Changing them moves every verdict together.
 *
 * ⚠️ THE SAMPLE BAR IS NOT REDECLARED. `assessSamples()` owns "is this big enough to speak at all"
 * (#965's one-definition rule); a second copy would agree today and drift at the first tuning. A
 * verdict on 6 trades is noise wearing a result's clothes, however clean the ratio looks.
 *
 * ⚠️ RETENTION IS UNDEFINED, NOT 1.0, WHEN THE IN-SAMPLE RATE IS ZERO. A run that won nothing
 * in-sample cannot retain a fraction of nothing; treating 0/0 as "perfect retention" would report a
 * broken result as `survived`. That case is `sample-unknown` here, deliberately.
 */

import { assessSamples, MIN_SAMPLES_FOR_VERDICT } from './verdict-bar';

export const OVERFIT_RULES = {
  /** At or above this retention the strategy SURVIVED. */
  surviveRetention: 0.75,
  /** Below this retention it is called overfit; between the two it has decayed. */
  overfitRetention: 0.5,
} as const;

export type OverfitVerdict = 'survived' | 'decayed' | 'overfit' | 'insufficient-data' | 'sample-unknown';

export interface OverfitFacts {
  /** Win rate as a FRACTION (0.61), never a percentage — the unit the stats field already uses. */
  inSampleWinRate: number | null;
  outOfSampleWinRate: number | null;
  inSampleTrades: number | null;
  outOfSampleTrades: number | null;
  /** Frontmatter for the note, e.g. "XAUUSD 1h". Never used in the arithmetic. */
  label?: string;
}

export interface OverfitAssessment {
  verdict: OverfitVerdict;
  /** OOS ÷ in-sample, or null when it cannot be computed. */
  retention: number | null;
  inSampleWinRate: number | null;
  outOfSampleWinRate: number | null;
  /** Ready to render: names both figures, the ratio and the bar. */
  note: string;
  requiredPerSample: number;
}

export function assessOverfit(facts: OverfitFacts): OverfitAssessment {
  const label = facts.label ? `${facts.label} — ` : '';
  const pct = (v: number | null) => (v === null ? 'UNKNOWN' : `${(v * 100).toFixed(1)}%`);

  const sample = assessSamples(
    [
      { label: 'in-sample', n: facts.inSampleTrades },
      { label: 'out-of-sample', n: facts.outOfSampleTrades },
    ],
    { what: 'trades' },
  );

  const base = {
    inSampleWinRate: facts.inSampleWinRate,
    outOfSampleWinRate: facts.outOfSampleWinRate,
    retention: null as number | null,
    requiredPerSample: MIN_SAMPLES_FOR_VERDICT,
  };

  // A missing win rate is not a zero win rate. Checked before the sample bar so the note names the
  // real problem rather than blaming the count.
  if (facts.inSampleWinRate === null || facts.outOfSampleWinRate === null) {
    return {
      ...base,
      verdict: 'sample-unknown',
      note: `${label}in-sample ${pct(facts.inSampleWinRate)} vs out-of-sample ${pct(facts.outOfSampleWinRate)} — one side was never recorded, so no retention can be computed.`,
    };
  }

  if (sample.outcome !== 'ok') {
    // ⚠️ THE TWO FAILURE MODES STAY DISTINCT. `assessSamples` distinguishes "count too small" from
    // "count never recorded", and collapsing both into `insufficient-data` would report missing data
    // as a small sample — the same conflation this repo keeps paying for.
    return {
      ...base,
      verdict: sample.outcome === 'sample-unknown' ? 'sample-unknown' : 'insufficient-data',
      note: `${label}${sample.note}`,
    };
  }

  if (facts.inSampleWinRate <= 0) {
    return {
      ...base,
      verdict: 'sample-unknown',
      note: `${label}in-sample win rate is 0%, so retention (a fraction OF it) is undefined — not 100%. The tuning found nothing to retain.`,
    };
  }

  // ⚠️ ROUNDED BEFORE COMPARING, and that is not cosmetic: 0.3 / 0.4 is 0.7499999999999999 in IEEE
  // 754, so an exact-rate strategy scoring 40% in and 30% out would be reported as DECAYED at a
  // 0.75 bar. A threshold that cannot recognise the case it names is worse than no threshold.
  const retention = Math.round((facts.outOfSampleWinRate / facts.inSampleWinRate) * 1e4) / 1e4;
  const r = retention.toFixed(2);
  const summary = `${label}in-sample ${pct(facts.inSampleWinRate)} → out-of-sample ${pct(facts.outOfSampleWinRate)} (retention ${r}×)`;

  if (retention >= OVERFIT_RULES.surviveRetention) {
    return { ...base, retention, verdict: 'survived', note: `${summary} — SURVIVED: it kept ≥${OVERFIT_RULES.surviveRetention}× of its tuned performance on data it never saw.` };
  }
  if (retention >= OVERFIT_RULES.overfitRetention) {
    return { ...base, retention, verdict: 'decayed', note: `${summary} — DECAYED: real, but materially weaker than the tuning promised (≥${OVERFIT_RULES.overfitRetention}× and <${OVERFIT_RULES.surviveRetention}×).` };
  }
  return { ...base, retention, verdict: 'overfit', note: `${summary} — OVERFIT: fewer than ${OVERFIT_RULES.overfitRetention}× of the tuned performance survived unseeing data. Most of it was the window.` };
}
