/**
 * score-card-filters.js — the Ladder family's shared filter constants and rules.
 * ===============================================================================
 * Extracted 2026-09-22 when the A/B Ladder was built. The new page had copied
 * `AGE_OPTIONS` / `MARKET_OPTIONS` / `marketMatches()` / `readScoreDisplay()` from
 * `LadderPage.jsx`, and `validate-duplication.cjs` counted 32 shared blocks across the
 * two pages — the exact "second implementation" the repo keeps paying for. One owner:
 * both ladders import from here.
 *
 * Kept OUT of `score-card-view.js` deliberately: that file is the presentation model
 * (labels, tones, refs). These are the CONTROLS that decide WHICH cards are visible —
 * a different concern, and mixing them would make the view model open the Screen
 * Options store it has no business reading.
 */

/** Score-age filter options, in minutes. `all` is the unfiltered value. */
export const AGE_OPTIONS = ['1', '2', '3', '4', '5', '10', '15', '20', '30', '60'];

/** Market filter options as [value, label] — order is the dropdown order. */
export const MARKET_OPTIONS = [
  ['open', 'Open'],
  ['all', 'All'],
  ['closed', 'Closed'],
];

/**
 * Does a card's market state match the market filter?
 * - 'open' (default): only symbols backed by an open market (marketStatus.open === true)
 * - 'closed': only symbols with a confirmed closed market
 * - 'all': everything (incl. unknown-market / unscored rows)
 *
 * Accepts a card ENTRY (anything with a `.vm`), which is what both ladders hold.
 */
export function marketMatches(entry, filter) {
  const open = entry?.vm?.marketStatus?.open;
  if (filter === 'open') return open === true;
  if (filter === 'closed') return open === false;
  return true;
}

/** The localStorage key the Screen Options control writes ("raw" | "percent" | "both"). */
export const SCORE_DISPLAY_STORAGE_KEY = 'lad-score-display';

/**
 * Read the Screen Options "Score Display" preference (raw | percent | both).
 * Falls back to 'both' — the historical default — when storage is unavailable.
 */
export function readScoreDisplay() {
  try { return localStorage.getItem(SCORE_DISPLAY_STORAGE_KEY) || 'both'; }
  catch { return 'both'; }
}
