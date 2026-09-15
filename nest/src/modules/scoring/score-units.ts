/** META.Stack score-unit helpers (2026-09-08).
 * Raw points are protocol-specific; normalized percentages are comparable.
 * Round only for presentation, never before an execution comparison. */
export function normalizeScorePercent(raw: number, maximum: number): number {
  if (!Number.isFinite(raw) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.max(0, Math.min(100, (raw / maximum) * 100));
}

/**
 * Which side of the evidence to report.
 *
 * ⚠️ `BOTH` WAS REMOVED 2026-09-15 (#818). DO NOT RE-ADD IT.
 *
 * A BOTH protocol decided its direction at RUNTIME, by comparing two percentages:
 *
 *     bullishPct > bearishPct ? 'bullish' : bearishPct > bullishPct ? 'bearish' : 'none'
 *
 * Each of those percentages is normalised by a DIFFERENT, MOVING denominator
 * (`bullishMax`/`bearishMax` accumulate only the directives that happened to read that way
 * this tick). So the comparison was between two ratios on different scales, and the chosen
 * side could flip on **participation** rather than strength — the #758 defect at a layer
 * ADR-011's guard does not reach. That was #813.
 *
 * Measured 2026-09-15: BOTH had produced **51 ticks ever** (0.5%), all from INACTIVE
 * protocols, against 8,837 LONG_ONLY. **0 of 19 active protocols used it.** So it was
 * removed by deletion rather than patched — a smaller change with no behaviour risk, and it
 * closes #813 outright instead of shipping a second definition of "which side".
 *
 * Direction is now a property of the PROTOCOL, not a runtime decision, which also makes
 * every stored percentage directly comparable. LONG/SHORT pairing is the intended A/B
 * mechanism: identical thesis both ways, measured independently.
 */
export type DirectionMode = 'LONG_ONLY' | 'SHORT_ONLY';

/** The only modes. Kept as a runtime list so seeds and validators share one source. */
export const DIRECTION_MODES: readonly DirectionMode[] = ['LONG_ONLY', 'SHORT_ONLY'];

export function selectDirectionalEvidence(
  mode: DirectionMode,
  evidence: { bullishRaw: number; bullishMax: number; bearishRaw: number; bearishMax: number },
): { direction: 'bullish' | 'bearish' | 'none'; raw: number; maximum: number; percentage: number } {
  // A presence test, NOT a magnitude comparison — the side is fixed by the protocol's own
  // mode, so the denominator cannot influence which direction is reported.
  const direction = mode === 'LONG_ONLY'
    ? (evidence.bullishMax > 0 ? 'bullish' : 'none')
    : (evidence.bearishMax > 0 ? 'bearish' : 'none');
  const raw = direction === 'bullish' ? evidence.bullishRaw : direction === 'bearish' ? evidence.bearishRaw : 0;
  const maximum = direction === 'bullish' ? evidence.bullishMax : direction === 'bearish' ? evidence.bearishMax : 0;
  return { direction, raw, maximum, percentage: normalizeScorePercent(raw, maximum) };
}
