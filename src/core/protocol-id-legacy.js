/**
 * protocol-id-legacy.js — old protocol slugs → current ones, for CLIENT state only.
 *
 * ⚠️ WHY THIS EXISTS. On 2026-11-05/06 every protocol slug gained a direction token
 * (`xau-speed-v1` → `xau-speed-v1-long`) and the database was migrated. Protocol ids are stored in
 * the BROWSER too — the ladder's per-direction selection, `currentProtocolId`, bookmarks, view state
 * — and none of those were rewritten, because they live in the user's localStorage.
 *
 * Measured 2026-11-06: the ladder held 17 long-direction ids, ALL pre-rename, and rendered
 * **0 ticked checkboxes** against a list of 51 current protocols. The prune then correctly removed
 * them as non-existent and persisted the emptiness — the "losing checked boxes" symptom of #782,
 * caused this time by a rename rather than by a failed fetch.
 *
 * ⚠️ This is a MIGRATION, not a mapping to depend on. Delete it once no browser can hold an old id
 * — i.e. once the rename is old enough that a stale localStorage is not worth recovering. It is
 * deliberately a static table with no lookup logic: the rename is history, not a rule.
 *
 * ⚠️ It is derived from the same map that migrated the database (54 entries, 51 of them renames), so
 * the two cannot disagree about what a given old slug became.
 */
export const LEGACY_PROTOCOL_IDS = {
  '060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d': 'conviction-dip-accumulation-long',
  'btc-scalp-v1': 'btc-scalp-v1-long',
  'btc-speed-v1': 'btc-speed-v1-long',
  'cac-speed-v1': 'cac-speed-v1-long',
  'china-speed-v1': 'china-speed-v1-long',
  'commodity-pairs-v1': 'commodity-pairs-v1-long',
  'dax-speed-v1': 'dax-speed-v1-long',
  'divergence-suite-v1': 'divergence-suite-v1-long',
  'doge-speed-v1': 'doge-speed-v1-long',
  'dow-speed-v1': 'dow-speed-v1-long',
  'dxy-sensitivity-v1': 'dxy-sensitivity-v1-long',
  'earnings-momentum-v1': 'earnings-momentum-v1-long',
  'euro-stoxx-v1': 'euro-stoxx-v1-long',
  'eurusd-macro-v1': 'eurusd-macro-v1-long',
  'forex-session-v1': 'forex-session-v1-long',
  'ftse-speed-v1': 'ftse-speed-v1-long',
  'gap-scanner-v1': 'gap-scanner-v1-long',
  'gbpusd-news-v1': 'gbpusd-news-v1-long',
  'gold-macro-v1': 'gold-macro-v1-long',
  'hourly-3dir-v1': 'hourly-3dir-v1-long',
  'leverage-v2': 'leverage-v2-long',
  'momentum-stock-v1': 'momentum-stock-v1-long',
  'mt5-technical-core-v1': 'mt5-technical-core-v1-long',
  'mt5-technical-short': 'mt5-technical-core-v1-short',
  'mt5-technical-short-mfiob': 'mt5-technical-core-v1-short-mfiob',
  'mtf-conservative-v1': 'mtf-conservative-v1-long',
  'mtf-weighted-v1': 'mtf-weighted-v1-long',
  'nikkei-speed-v1': 'nikkei-speed-v1-long',
  'oil-speed-v1': 'oil-speed-v1-long',
  'oil-supply-v1': 'oil-supply-v1-long',
  'probe-1dir-rsi': 'probe-1dir-rsi-long',
  'probe-1dir-v1': 'probe-1dir-v1-long',
  'qqq-day-v1': 'qqq-day-v1-long',
  'qqq-speed-v1': 'qqq-speed-v1-long',
  'signals-workbench': 'signals-workbench-long',
  'spy-day-v1': 'spy-day-v1-long',
  'spy-speed-v1': 'spy-speed-v1-long',
  'tsla-speed-v1': 'tsla-speed-v1-long',
  'usdcad-oil-v1': 'usdcad-oil-v1-long',
  'usdjpy-risk-v1': 'usdjpy-risk-v1-long',
  'vix-short-v1': 'vix-spike-v1-short',
  'vix-spike-v1': 'vix-spike-v1-long',
  'vwap-bands-v1': 'vwap-bands-v1-long',
  'vwap-simple-v1': 'vwap-simple-v1-long',
  'xau-short-m15': 'xau-speed-m15-short',
  'xau-speed-1h': 'xau-speed-1h-long',
  'xau-speed-4h': 'xau-speed-4h-long',
  'xau-speed-m15': 'xau-speed-m15-long',
  'xau-speed-m5': 'xau-speed-m5-long',
  'xau-speed-v1': 'xau-speed-v1-long',
  'xau-speed-v1-copy': 'xau-speed-v1-copy-long',
};

/**
 * Return the current id for a possibly-legacy one, or the input unchanged.
 * ⚠️ A missing entry means "already current OR genuinely unknown" — this function must NOT guess,
 * because a wrong guess would point a selection at the wrong strategy.
 */
export function normaliseLegacyProtocolId(id) {
  if (typeof id !== 'string' || id.length === 0) return id;
  return LEGACY_PROTOCOL_IDS[id] ?? id;
}
