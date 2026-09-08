/** META.Stack score-unit helpers (2026-09-08).
 * Raw points are protocol-specific; normalized percentages are comparable.
 * Round only for presentation, never before an execution comparison. */
export function normalizeScorePercent(raw: number, maximum: number): number {
  if (!Number.isFinite(raw) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.max(0, Math.min(100, (raw / maximum) * 100));
}

export function selectDirectionalEvidence(
  mode: 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH',
  evidence: { bullishRaw: number; bullishMax: number; bearishRaw: number; bearishMax: number },
): { direction: 'bullish' | 'bearish' | 'none'; raw: number; maximum: number; percentage: number } {
  const bullishPct = normalizeScorePercent(evidence.bullishRaw, evidence.bullishMax);
  const bearishPct = normalizeScorePercent(evidence.bearishRaw, evidence.bearishMax);
  const direction = mode === 'LONG_ONLY'
    ? (evidence.bullishMax > 0 ? 'bullish' : 'none')
    : mode === 'SHORT_ONLY'
      ? (evidence.bearishMax > 0 ? 'bearish' : 'none')
      : bullishPct > bearishPct
        ? 'bullish'
        : bearishPct > bullishPct ? 'bearish' : 'none';
  const raw = direction === 'bullish' ? evidence.bullishRaw : direction === 'bearish' ? evidence.bearishRaw : 0;
  const maximum = direction === 'bullish' ? evidence.bullishMax : direction === 'bearish' ? evidence.bearishMax : 0;
  return { direction, raw, maximum, percentage: normalizeScorePercent(raw, maximum) };
}
