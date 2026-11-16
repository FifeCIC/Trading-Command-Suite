/**
 * max-hold.ts — the bot's own TIME STOP, as one pure function (#1136).
 *
 * ── THE DEFECT THIS CLOSES, measured 2026-11-16 ────────────────────────────────────────────────
 * `trading_strategy.maxHoldHours` is set on **42 of 64 active bots** (12h × 21, 24h × 11, 4h × 7,
 * 120h × 2, 72h × 1) and the backtester had **zero references** to it. The live path closes a position
 * once it has been held longer than that limit (`position-time-stop.service.ts`, reason
 * `SYSTEM_TIME_STOP`). A run without it therefore let a trade continue until its stop, its target, or
 * the end of the data — potentially DAYS past the point the bot would actually have closed it.
 *
 * That makes the two statistics a backtest exists to produce wrong in the same direction:
 * **hold time is inflated** (the trade is held longer than the bot holds), and **the exit reason is a
 * guess** (the level that fired belongs to a period the bot would no longer have been in the market).
 * A `+2%` booked 6 days later is not the bot's trade; it is a different trade that happened to start
 * the same way.
 *
 * ⚠️ WHY THIS IS THE CLEAN ONE OF THE INERT KNOBS. Each simulated trade in a run is INDEPENDENT — the
 * engine walks forward from one entry and books one exit — so a time limit applies to each trade
 * separately and does not interact with any other. `cooldownMinutes` (set on 76 of 76 bots) does NOT
 * have that property: with overlapping hypothetical trades, "no new entry within N minutes of the last
 * close" has more than one defensible reading, and picking one without a decision would be the
 * plausible-numbers-no-error shape this repo keeps paying for. So it is deliberately NOT implemented
 * here; it needs a modelling decision first.
 *
 * ── UNITS AND THE BOUNDARY ─────────────────────────────────────────────────────────────────────
 * `maxHoldHours` is HOURS. The comparison is `held >= limit`, i.e. **inclusive**: a bar whose timestamp
 * is exactly `limit` hours after entry counts as expired. That mirrors the live service, which closes
 * when the held duration has reached the limit rather than only after exceeding it. The boundary is
 * asserted explicitly in `max-hold.spec.ts` so it cannot drift silently.
 *
 * ⚠️ `null`, `undefined`, `0` and negative values all mean NO LIMIT — never "expire immediately".
 * The live `parseMaxHoldHours()` treats unparseable input as no limit for the same reason: a missing
 * setting must not become a zero-length hold, which would close every trade on the bar after entry and
 * look like a catastrophic strategy rather than a mis-read field.
 */

/** Hours → milliseconds. */
const HOUR_MS = 3_600_000;

/**
 * Has a position held since `entryAtMs` passed the bot's maximum hold at `barAtMs`?
 *
 * @param entryAtMs  Entry instant, epoch milliseconds.
 * @param barAtMs    The bar being tested, epoch milliseconds.
 * @param maxHoldHours The bot's limit in HOURS. `null`/`undefined`/`0`/negative = no limit.
 * @returns TRUE only when a real limit exists AND the held duration has reached it.
 */
export function maxHoldExpired(
  entryAtMs: number,
  barAtMs: number,
  maxHoldHours?: number | null,
): boolean {
  if (maxHoldHours == null) return false;
  const limit = Number(maxHoldHours);
  // Non-finite, zero or negative is "no limit" — never a zero-length hold.
  if (!Number.isFinite(limit) || limit <= 0) return false;
  if (!Number.isFinite(entryAtMs) || !Number.isFinite(barAtMs)) return false;
  // A bar BEFORE entry cannot have expired — guards a reversed series rather than returning true.
  if (barAtMs < entryAtMs) return false;

  return barAtMs - entryAtMs >= limit * HOUR_MS;
}
