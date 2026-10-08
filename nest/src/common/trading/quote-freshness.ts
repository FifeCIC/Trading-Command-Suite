/**
 * quote-freshness.ts — can this quote be TRUSTED to price an order? (#1085)
 * =========================================================================
 *
 * ── DECISION (2026-10-08, primary) ──
 * WHAT:      A STALE quote REFUSES sizing (kind `stale`), distinctly from an absent one. The bridge
 *            contract carries `tickTime` (the broker's own last tick, offset-corrected); the
 *            allowance is the declared setting `trading.maxQuoteAgeSeconds` (default 300, 0 disables).
 * WHY:       The old failure direction was the dangerous one — absent refused, FROZEN was trusted and
 *            sized the position. See below.
 * INSTEAD OF: A client-side threshold on `timestamp`. It would ALWAYS pass (that field is the
 *            response time — a check that inspects nothing), which #1085 states and this marker
 *            repeats so it is not re-proposed.
 * REVERSE BY: Stop consuming `tickTime` (extras are ignored by every other consumer), or set the
 *            allowance to 0 — no deploy needed for the latter.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 71
 * GUARD:     nest/src/common/trading/quote-freshness.spec.ts (in the prebuild jest list) — the CHECK
 *            is gated; its CALL SITE in the sizing path is not (🟡, stated on the row).
 *
 * ⚠️ WHY THIS EXISTS — THE FAILURE DIRECTION IS THE DANGEROUS ONE
 * --------------------------------------------------------------
 * `estimatePositionMargin()` validates the price it is given:
 *
 *     if (!Number.isFinite(price) || price <= 0) → 'unavailable'
 *
 * So an ABSENT quote refuses — correct — but a FROZEN quote (any positive price) was trusted, and
 * **sized the position on a stale price**. A missing quote refused; a frozen one sliced risk on a
 * number that is no longer the market: plausible value, no error — this repo's most expensive
 * signature.
 *
 * It could not be fixed with what the bridge used to send: `timestamp` is the RESPONSE time
 * (machine clock), so a quote that had not moved in an hour reported itself as one second old.
 * #1085's bridge contract adds `tickTime` — the broker's own last-tick time — and THIS file is
 * the check that consumes it.
 *
 * ⚠️ WHY NOT A CLIENT-SIDE HEURISTIC ON `timestamp` (the issue states it; repeated here so nobody
 * "simplifies" it back): a threshold applied to a self-reported timestamp always passes. It would
 * be a check that inspects nothing and reports OK — worse than no check. Only the broker's tick
 * time carries the information.
 *
 * ⚠️ SERVER-OFFSET INTERACTION (read before changing the allowance): `tickTime` is converted from
 * MT5 server-time epochs through the bridge's measured offset (`utc_iso()`, the file's rule). That
 * measurement is ROUNDED to 900s steps with a 450s tolerance guard, so in the worst case — a probe
 * taken when every probe symbol's freshest tick was old — the corrected time can read up to
 * ~7.5 minutes EARLIER than truth (an OVER-stated age). In the normal case the probe tick is
 * seconds old and the correction is exact. The declared allowance (default 300s) is chosen well
 * above the typical error; if false 'stale' refusals ever appear on liquid symbols, check the
 * bridge's offset-probe log lines BEFORE raising the allowance.
 *
 * "CANNOT JUDGE" IS A REFUSAL, NOT A PASS. A quote whose tick time is absent (`undefined` — an old
 * bridge) or unreported (`null` — terminal has no tick) refuses with the condition NAMED; the sizing
 * path may not proceed on a freshness it could not establish.
 */

export type QuoteFreshnessKind = 'fresh' | 'stale' | 'no-quote' | 'no-tick-time' | 'future' | 'disabled';

export interface QuoteFreshness {
  ok: boolean;
  kind: QuoteFreshnessKind;
  ageSeconds: number | null;
  reason: string;
}

/**
 * How far AHEAD of the local clock a tick time may be before the conversion is called suspect.
 * The bridge's rounded offset correction errs EARLY (under-measured offset ⇒ corrected time
 * earlier than truth), so a grossly FUTURE tick time means the correction itself is wrong (the
 * class that sent bar timestamps ~3h into the future, #625/#845) — worth refusing, not absorbing.
 */
export const FUTURE_TOLERANCE_SECONDS = 120;

/**
 * Check whether a quote may price/size an order. Pure — the caller passes `now`.
 *
 * Boundary: `ageSeconds === allowanceSeconds` PASSES (inclusive). Named here so the operator does
 * not have to infer it from the operator.
 */
export function checkQuoteFreshness(
  quote: { symbol?: string; tickTime?: Date | null } | null | undefined,
  allowanceSeconds: number,
  now: Date = new Date(),
): QuoteFreshness {
  const symbol = quote?.symbol ?? 'the symbol';
  if (!quote) {
    return { ok: false, kind: 'no-quote', ageSeconds: null, reason: `no quote returned for ${symbol}` };
  }
  if (!(allowanceSeconds > 0)) {
    return {
      ok: true,
      kind: 'disabled',
      ageSeconds: null,
      reason: `quote staleness check disabled (allowance ${allowanceSeconds}s)`,
    };
  }
  const t = quote.tickTime;
  if (t === undefined) {
    return {
      ok: false,
      kind: 'no-tick-time',
      ageSeconds: null,
      reason: `${symbol}: quote carries no tick time — the bridge predates the #1085 contract; restart it`,
    };
  }
  if (t === null || Number.isNaN(t.getTime())) {
    return {
      ok: false,
      kind: 'no-tick-time',
      ageSeconds: null,
      reason: `${symbol}: the terminal reported no tick time for this quote`,
    };
  }
  const ageSeconds = Math.round((now.getTime() - t.getTime()) / 1000);
  if (ageSeconds < -FUTURE_TOLERANCE_SECONDS) {
    return {
      ok: false,
      kind: 'future',
      ageSeconds,
      reason: `${symbol}: tick time ${t.toISOString()} is ${-ageSeconds}s AHEAD of the clock — server-offset conversion suspect`,
    };
  }
  if (ageSeconds > allowanceSeconds) {
    return {
      ok: false,
      kind: 'stale',
      ageSeconds,
      reason: `${symbol}: last broker tick ${t.toISOString()} is ${ageSeconds}s old — over the ${allowanceSeconds}s allowance`,
    };
  }
  return { ok: true, kind: 'fresh', ageSeconds, reason: `${symbol}: tick is ${ageSeconds}s old` };
}
