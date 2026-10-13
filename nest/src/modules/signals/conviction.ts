import { normalizeScorePercent } from '../scoring/score-units';

/**
 * convictionPercent() — the SECOND reading of one signal: "how strongly did the directives that
 * actually read directionally agree?"
 *
 * ── THE TWO QUESTIONS, AND WHY BOTH ARE SHOWN (#915, Option C) ───────────────────────────────
 *
 * `signalPct` divides by the protocol's CONFIGURED directional capacity — every eligible
 * directive, including the ones that read neutral this tick. It answers "how much of the WHOLE
 * protocol agrees?" Measured 2026-10-12: a median 46.5% of that capacity never records a
 * direction (worst case `gold-macro-v1` at 76.7%), so a protocol with one genuinely strong
 * directive still displays ~6-17%. The owner read that, correctly, as "a whole bunch of
 * directives score low, always, as if the market data never shows a good opportunity".
 *
 * This function answers the other question — of the directives that DID speak, how much did they
 * agree? Same numerator, observed denominator. It separates "the market offered nothing" from
 * "the denominator is diluted by silence", which one percentage cannot do.
 *
 * ⚠️ ADR-011 IS UNTOUCHED, AND THIS MUST NEVER FEED A DECISION.
 * `INV-STABLE-DENOMINATOR` forbids the observed sum as the SCORING denominator, and rightly so:
 * it shrinks when a directive goes quiet, so a quiet tick RAISES this number. Classification
 * (`signal` → BUY/HOLD/SELL), the pre-trade gate, `trading_strategy.minComposite` and everything
 * persisted still read `signalPct`. Nothing may branch on `convictionPercent()` — read it as
 * "of the directives that spoke", never as "how good this is".
 *
 * ⚠️ WHY IT LIVES IN `modules/signals`, NOT `modules/scoring`.
 * ADR-014 is one implementation per concept, and the scoring module's denominator IS the
 * configured one. A second, observed denominator placed beside it would read as a sanctioned
 * alternative and would sit inside `validate-pipeline-contracts.cjs`'s `no-observed-denominator`
 * scope — the guard whose whole job is to stop that. This is a DISPLAY derivation for the
 * envelope, so it lives with its only consumer.
 *
 * ⚠️ Returns `null` — never 0 — when nothing read directionally.
 * `normalizeScorePercent(raw, 0)` returns 0, which would render "no directive had an opinion" as
 * "the directives that spoke agreed on nothing". `[]` is information and `null` is the absence of
 * it; they must not look the same (the header rule in `score-display.js`).
 *
 * @param raw         the selected direction's earned points (`gated.signalRaw`)
 * @param observedMax the selected direction's observed capacity (`meta.observedSignalMax`)
 */
// ── DECISION (2026-10-13, primary) ──
// WHAT:      A signal carries TWO percentages and the envelope reports both: `signalPct` (share of
//            the protocol's CONFIGURED directional capacity) and `convictionPct` (share of the
//            capacity that actually READ). Conviction is DISPLAY ONLY.
// WHY:       The owner read `11%` on a Signal card as "the market never shows a good opportunity"
//            (#915). The breadth figure divides by every direction-eligible directive, including
//            the silent ones — a median 46.5% of that capacity never records a direction — so one
//            strong directive among many silent ones still reads 6-17%. The second reading
//            separates "the market offered nothing" from "the denominator is diluted by silence".
// INSTEAD OF: Changing `signalPct`'s denominator to the observed sum. That is a maths change, and
//            ADR-011 forbids the observed sum for CLASSIFICATION precisely because it shrinks when
//            a directive goes quiet — a quiet tick would INFLATE the reading, which is the
//            `STRONG_BUY 17%` card that #758 fixed.
// REVERSE BY: Deleting `convictionPct` / `observedSignalMax` from `SignalEnvelope` and the chip
//            from `SignalCard.jsx`. Nothing else reads them, and no gate may.
// REGISTER:  docs/SETTLED-DECISIONS.md row 83
// GUARD:     nest/src/modules/signals/conviction.spec.ts
export function convictionPercent(
  raw: number,
  observedMax: number | null | undefined,
): number | null {
  if (typeof observedMax !== 'number' || !Number.isFinite(observedMax) || observedMax <= 0) {
    return null;
  }
  if (!Number.isFinite(raw)) return null;
  return normalizeScorePercent(raw, observedMax);
}
