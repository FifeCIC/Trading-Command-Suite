/**
 * Symbols Browser — shared column registry.
 *
 * Used by BOTH the Symbols Browser page and the Screen Options overlay so the
 * optional-column checkboxes and the table rendering can never drift apart.
 *
 * Visibility is stored per-column in localStorage under `sb-col-<key>` as
 * 'true' / 'false'. Unset columns fall back to their `def` (default) value.
 * `always` columns are rendered unconditionally and never appear in options.
 */

export const SB_COLUMNS = [
  { key: 'star', label: '⭐', always: true },
  { key: 'ticker', label: 'Ticker', always: true, desc: 'Ticker symbol — always shown.' },
  { key: 'name', label: 'Name', def: true, desc: 'Company or asset name.' },
  { key: 'exchange', label: 'Exchange', def: true, desc: 'Trading venue the symbol is listed on.' },
  { key: 'type', label: 'Type', def: true, desc: 'Asset class — stock, crypto or forex.' },
  { key: 'active', label: 'Active', desc: 'Whether the symbol is marked active in the database.' },
  { key: 'tags', label: 'Tags', desc: 'Tag list stored on the symbol record.' },
  { key: 'aliases', label: 'Aliases', desc: 'Alternative ticker/name mappings stored on the symbol.' },
  { key: 'position', label: 'Position', def: true, desc: 'Whether you currently hold the symbol (Held / —).' },
  { key: 'provider', label: 'Provider', desc: 'Broker or provider the position is held with.' },
  { key: 'quantity', label: 'Quantity', desc: 'Number of units currently held.' },
  { key: 'avgPrice', label: 'Avg Cost', desc: 'Average entry cost per unit.' },
  { key: 'currentPrice', label: 'Current Price', desc: 'Latest price recorded for the position.' },
  { key: 'pnl', label: 'P&L', def: true, desc: 'Unrealised profit/loss on the position.' },
  { key: 'pnlPct', label: 'P&L %', desc: 'Unrealised P&L as a percentage of cost.' },
  { key: 'fresh', label: 'Freshness', def: true, desc: 'Market data freshness status (fresh / stale).' },
  { key: 'freshAge', label: 'Data Age', desc: 'Minutes since the latest stored bar.' },
  { key: 'freshTimeframe', label: 'Timeframe', desc: 'Timeframe of the freshest stored bar.' },
  { key: 'freshLatest', label: 'Latest Bar', desc: 'Timestamp of the latest stored bar.' },
  { key: 'created', label: 'Created', desc: 'When the symbol was first added to the database.' },
  { key: 'updated', label: 'Updated', desc: 'When the symbol record last changed.' },
  { key: 'id', label: 'Symbol ID', desc: 'Internal database identifier for the symbol.' },
]

/** localStorage key for a column's visibility toggle. */
export function sbColumnKey(col) {
  return 'sb-col-' + col.key
}

/** Optional columns (not `always`) — the set surfaced in Screen Options. */
export const SB_OPTIONAL_COLUMNS = SB_COLUMNS.filter((col) => !col.always)

/** Read the full column-visibility map from localStorage (defaults applied). */
export function readSBColumnVisibility() {
  const visible = {}
  for (const col of SB_COLUMNS) {
    if (col.always) { visible[col.key] = true; continue }
    try {
      const stored = localStorage.getItem(sbColumnKey(col))
      visible[col.key] = stored == null ? !!col.def : stored === 'true'
    } catch (e) {
      visible[col.key] = !!col.def
    }
  }
  return visible
}
