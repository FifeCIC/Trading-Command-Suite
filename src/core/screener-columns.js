/**
 * Screener — shared column registry (epic #682 Phase 4.3).
 *
 * Mirrors `symbols-browser-columns.js`: the table rendering in ScreenerPage
 * and the column-toggle checkboxes in Screen Options both read this list, so
 * they can never drift apart.
 *
 * Visibility is stored per-column in localStorage under `scr-col-<key>` as
 * 'true' / 'false'. Unset columns fall back to their `def` (default) value.
 * `always` columns are rendered unconditionally and never appear in options.
 */

export const SCR_COLUMNS = [
  { key: 'pick', label: '🎯', always: true },
  { key: 'ticker', label: 'Ticker', always: true, desc: 'Ticker symbol — always shown.' },
  { key: 'catalyst', label: 'Catalyst', def: true, desc: 'Catalyst type(s) that surfaced this symbol.' },
  { key: 'source', label: 'Source', def: true, desc: 'Where the catalyst came from — news or earnings.' },
  { key: 'lean', label: 'Lean', def: true, desc: 'Aggregate news lean — LONG / SHORT / NEUTRAL.' },
  { key: 'action', label: 'Action', always: true, desc: 'Promote-to-watchlist button / state — always shown.' },
  { key: 'strength', label: 'Strength', def: true, desc: 'Catalyst strength from the source feed.' },
  { key: 'reliability', label: 'Reliab.', def: true, desc: 'Source reliability weight.' },
  { key: 'attention', label: 'Attention', always: true, desc: 'Relative attention weight (0–100 vs the strongest current catalyst).' },
  { key: 'when', label: 'When', def: true, desc: 'Next event date or age of the latest catalyst.' },
  { key: 'hits', label: 'Hits', def: true, desc: 'Number of catalyst hits behind this row.' },
]

/** localStorage key for a column's visibility toggle. */
export function scrColumnKey(col) {
  return 'scr-col-' + col.key
}

/** Optional columns (not `always`) — the set surfaced in Screen Options. */
export const SCR_OPTIONAL_COLUMNS = SCR_COLUMNS.filter((col) => !col.always)

/** Read the full column-visibility map from localStorage (defaults applied). */
export function readSCRColumnVisibility() {
  const visible = {}
  for (const col of SCR_COLUMNS) {
    if (col.always) { visible[col.key] = true; continue }
    try {
      const stored = localStorage.getItem(scrColumnKey(col))
      visible[col.key] = stored == null ? !!col.def : stored === 'true'
    } catch (e) {
      visible[col.key] = !!col.def
    }
  }
  return visible
}
