/**
 * The SAMPLE BAR for naming a winner — ONE definition, two consumers (#965 item 1).
 * ==============================================================================
 *
 * ⚠️ WHY THIS EXISTS, with the measurement that produced it (2026-09-23):
 *
 *     xau-speed-m15   totalTrades: 3   winRate: 100   sharpeRatio: 42.31
 *     xau-speed-m5    totalTrades: 0   winRate: 0
 *     best: { id: <m15>, metric: "sharpeRatio", value: 42.31 }    POST /api/backtest/runs/compare
 *
 * The backtest comparison named a **winner on three trades**, presented identically to a result
 * from three hundred. `ab-test.service.ts` had already learned this lesson for the live snapshot
 * trial (`AB_MIN_TRADES_FOR_VERDICT`, added after the same shape appeared there) — **and the
 * backtest comparison had no such bar.** One place learned it; the second place did not inherit it.
 *
 * A winner named on three trades is worse than no winner, because it gets acted on.
 *
 * ⚠️ WHY ONE MODULE rather than a constant in each service: two private copies would agree today
 * and drift at the first tuning. This is a POLICY number — 30 matches the repo's n≥30 threshold
 * language (#805's edge controller) — and changing it here must move every verdict together.
 *
 * ⚠️ A BAR IS NOT A TEST. Clearing it means "big enough to speak about", never "significant".
 * Callers must not render a winner as a proven difference; the method and the sample go with it.
 */

/** The number of samples PER SIDE required before any winner may be named. */
export const MIN_SAMPLES_FOR_VERDICT = 30;

export interface SampleSide {
  /** Human label for the side — the caller's own naming, so no side is an anonymous index. */
  label: string;
  /**
   * The sample size. `null` means **UNKNOWN**, and that is deliberately not `0`:
   * "no samples exist" and "the sample was never recorded" are opposite conclusions and a
   * verdict must not be able to name a winner in either case.
   */
  n: number | null;
}

export interface VerdictAssessment {
  /** `ok` = every side cleared the bar. Anything else must NOT produce a winner. */
  outcome: 'ok' | 'insufficient-data' | 'sample-unknown';
  /** Per-side counts, keyed by label, with `null` preserved for unknown. */
  n: Record<string, number | null>;
  requiredPerSide: number;
  /** Ready to render: names the counts, the bar, and which side is short. */
  note: string;
}

/**
 * Assess whether the supplied sides may carry a verdict.
 *
 * Both failure modes are reported as ONE call so a caller cannot check the count and forget the
 * unknown case, which is the way this kind of guard usually gets half-implemented.
 */
export function assessSamples(
  sides: SampleSide[],
  opts: { what?: string; min?: number } = {},
): VerdictAssessment {
  const min = opts.min ?? MIN_SAMPLES_FOR_VERDICT;
  const what = opts.what ?? 'samples';
  const n: Record<string, number | null> = {};
  for (const s of sides) n[s.label] = s.n;

  const described = sides.map((s) => `${s.label}: ${s.n === null ? 'UNKNOWN' : s.n}`).join(' vs ');

  // ⚠️ Checked FIRST: an unknown sample must not fall through to the count comparison, where
  // `null < min` is a type error and `Number(null)` is 0 — either would silently decide it.
  const unknown = sides.filter((s) => s.n === null);
  if (unknown.length > 0) {
    return {
      outcome: 'sample-unknown',
      n,
      requiredPerSide: min,
      note:
        `Refusing to name a winner: the ${what} count is UNKNOWN for ` +
        `${unknown.map((s) => s.label).join(', ')} (${described}). ` +
        'A verdict cannot be given on a sample nobody recorded — this is not "no trades", it is ' +
        '"not measured", and the two must not read the same.',
    };
  }

  const short = sides.filter((s) => (s.n as number) < min);
  if (short.length > 0) {
    return {
      outcome: 'insufficient-data',
      n,
      requiredPerSide: min,
      note:
        `Refusing to name a winner: ${described} ${what} (need ≥${min} per side). ` +
        `${short.map((s) => s.label).join(', ')} below the bar. ` +
        "A verdict on a smaller sample is noise wearing a result's clothes (#929).",
    };
  }

  return {
    outcome: 'ok',
    n,
    requiredPerSide: min,
    note:
      `${described} ${what} — every side clears the ≥${min} bar. ` +
      '⚠️ Clearing the bar means "big enough to speak about", not "significant".',
  };
}
