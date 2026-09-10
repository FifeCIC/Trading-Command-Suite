/**
 * Timeframe helpers — the ONE mapping from free-text protocol guidance to a cadence.
 * =================================================================================
 * ⚠️ CONTRACT FILE — `selectBaseTimeframe()` is the ONE mapping from a protocol's free-text
 * `recommendedTimeframe` to a cadence that exists in `marketbar`. It was previously
 * module-private in `signal-envelope.service.ts`; that privacy is why two other callers
 * hand-rolled bar queries and lost the filter (INV-SINGLE-CADENCE). If you need a cadence,
 * import this — do not add a second parser anywhere. Guarded at build time by
 * `nest/scripts/validate-pipeline-contracts.cjs` (canary INV-SINGLE-CADENCE).
 *
 * WHY THIS IS SHARED (#751, 2026-09-10)
 * -------------------------------------
 * Protocols declare `recommendedTimeframe` as **free text** — real examples from the
 * seed data: `'5s–30s'`, `'5m–1h'`, `'15m–1d'`, `'1d–4h'`, `'1d (signal), 1h/15m'`,
 * `'1m–5m'`, and `null`. Everything that loads bars, however, needs a single cadence
 * that actually exists in the `marketbar.timeframe` column.
 *
 * This mapping started life as a module-private function in
 * `signals/signal-envelope.service.ts`. Two callers (the Arena and the scoring path)
 * did not have access to it, so they hand-rolled their own bar queries — and both lost
 * the `timeframe` filter entirely, splicing mixed cadences into one array. A mixed
 * array silently changes what every window means: RSI(14) is 70 minutes on 5m bars but
 * 14 days on daily bars, and `computeMarketStatus` derives its staleness threshold from
 * the array's own cadence. No error, just plausible wrong numbers.
 *
 * So: resolve the cadence here, then load with `MarketDataService.getBars(symbolId,
 * cadence, count)` — the canonical loader that also guarantees oldest → newest order.
 *
 * PRE-EXISTING BEHAVIOUR IS PRESERVED VERBATIM — the regex order below decides the
 * result for overlapping strings (finest cadence mentioned wins, so `'5m–1h'` → `5m`),
 * and `timeframe.spec.ts` pins the whole table. If you change a rule, change the test
 * with it.
 */

/** Map free-text protocol guidance to the finest supported primary cadence. */
export function selectBaseTimeframe(recommended?: string | null): string {
  const value = (recommended ?? '').toLowerCase();
  if (/\b(5s|30s|1m)\b/.test(value)) return '1m';
  if (/\b5m\b/.test(value)) return '5m';
  if (/\b15m\b/.test(value)) return '15m';
  if (/\b1h\b/.test(value)) return '1h';
  if (/\b4h\b/.test(value)) return '4h';
  return '1d';
}

/**
 * The cadence used when a symbol has no bars at the requested cadence and is not
 * covered by a protocol recommendation — the application's live base cadence
 * (`automation-loop.service.ts` scores on 5m).
 *
 * Callers should still fall back to the cadence the symbol actually HAS before giving
 * up: equity symbols are daily-only in `marketbar`, so asking for 5m returns nothing.
 */
export const DEFAULT_LIVE_TIMEFRAME = '5m';
