/**
 * Scoring mode helper — demo/live gating.
 *
 * "demo" = relaxed: regime mismatch → −30% instead of MUTE.
 * "live" = strict:  regime mismatch MUTES the directive.
 *
 * Controlled by SCORING_MODE in .env.
 *
 * ⚠️ MEASURED 2026-10-17 — THIS FLAG CURRENTLY CHANGES NO SCORE, AND THE DOC HERE USED TO SAY IT
 * DID. The two lines above describe code that is COMMENTED OUT. `evaluateGate` in
 * `directives.service.ts` (~L317) is the only scoring-side reader, and it is disabled by a settled
 * decision: *"regime/volatility/session gating belongs in Scoring Strategies (Phase 2), not at the
 * directive level. Directives should score based on data alone."* (#610). That block says so
 * itself: *"Weight multiplier is always 1.0 — no reduction."*
 *
 * Proof, not inference: the same VIX 1h window replayed BYTE-IDENTICALLY under both values —
 * 144 steps, 44 signals, max 20.83% (100/480). A flag documented as controlling the gates, that no
 * caller reads, is the "a declaration is not validated by being well-formed" defect with a config
 * file in front of it. Do not flip this expecting a behaviour change; see the note in `nest/.env`.
 *
 * The reader that DOES run is `ConditionDetectorService.classifyRegime` (relaxed thresholds in
 * demo), and nothing currently gates on its result either. The lever that actually decides signals
 * is the ENTRY/STRONG percentage pair in `protocol-gating.service.ts` (6 / 13 as of 2026-10-17,
 * rescaled from 40 / 80 on 2026-09-15).
 */
export function isScoringDemo(): boolean {
  return (process.env.SCORING_MODE || 'demo') === 'demo';
}
