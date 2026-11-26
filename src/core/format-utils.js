/**
 * Format Utilities — canonical timestamp, duration, and currency formatting.
 * ========================================================================
 * Every page that displays times, durations, or currency imports from here.
 *
 * ── DECISION (2026-11-17, primary) ──
 * WHAT:      this file is the ONE owner of every formatter, and a gate now enforces it.
 * WHY:       measured — 13 files declared formatters of their own and four collided with a canonical
 *            export: `fmtCurrency` that rendered no currency, `fmtDuration` that said "2d 0h" where
 *            `formatDuration` says "2d", two different `fmtPrice` rules under one name, and three
 *            meanings for `num2`. The call site cannot tell which copy it got, and the shorter-lived
 *            copy is the one that gets the next fix.
 * INSTEAD OF: Leaving them as declared duplication on the assumption that a page-local helper is
 *            harmless. `src/features/movers-strategy/format.js` carried a docblock saying "do not
 *            unify" — on a false premise (`formatPct` does sign positives), protecting two functions
 *            that had become byte-identical.
 * REVERSE BY: Delete `scripts/validate-formatters.cjs`, remove it from `prebuild` and from
 *            `src/data/standards.js`, and the local copies can return.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 296
 * GUARD:     scripts/validate-formatters.cjs (F1 shadow · F2 duplicate), `--self-test` in 7 cases
 *
 * @file src/core/format-utils.js
 */

/** "X time ago" relative timestamp */
export function timeAgo(iso, { short = false } = {}) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return short ? `${sec}s` : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return short ? `${min}m` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return short ? `${hr}h` : `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return short ? `${days}d` : `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * relativeAge — "42m ago" / "3h ago" / "11d ago", with the caller's word for "no timestamp".
 *
 * ⚠️ THIS IS NOT A SECOND OPINION ABOUT `timeAgo`, and the distinction is why it exists rather than a
 * flag on that function. `timeAgo` collapses anything past 7 days into a DATE ("12/11/2026") because
 * it answers *when did this happen*; this keeps counting days because it answers *how stale is this*
 * — the question a "last synced" column is actually asking. Two page files each carried their own
 * copy of this with the same name and different rules (`fmtWhen` also meant a forward-looking
 * "in 3d" in a third), so it now has one owner. Register row 296.
 */
export function relativeAge(iso, { empty = '—' } = {}) {
  if (!iso) return empty;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return empty;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/** Format ISO timestamp to locale time */
export function formatTime(iso, { seconds = false } = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], seconds ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
}

/** Format ISO timestamp to full locale datetime */
export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

/** Format millisecond duration to human-readable */
export function formatDuration(ms, { showMs = false } = {}) {
  if (ms == null || ms < 0) return '—';
  if (ms < 1000) return showMs ? `${ms}ms` : '<1s';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  if (min < 60) return remainSec > 0 ? `${min}m ${remainSec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remainMin = min % 60;
  if (hr < 24) return remainMin > 0 ? `${hr}h ${remainMin}m` : `${hr}h`;
  const days = Math.floor(hr / 24);
  const remainHr = hr % 24;
  return remainHr > 0 ? `${days}d ${remainHr}h` : `${days}d`;
}

/** Format currency with sign and locale */
export function formatCurrency(n, { showZero = false, abs = false, currency = 'USD' } = {}) {
  if (n == null) return '—';
  const v = abs ? Math.abs(n) : n;
  if (v === 0 && !showZero) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 2 });
}

/** Format a number with locale (commas for thousands) */
export function formatNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}

/** Format percentage */
export function formatPct(n, decimals = 1) {
  if (n == null) return '—';
  const v = Number(n);
  // ⚠️ A NaN or an Infinity is "present but not a number" — the state the broker posts as a value
  // rather than omitting (see PositionsMonitorPage's fmtUsd2 docblock). `${NaN.toFixed(1)}%` used to
  // render "+NaN%", which reads as a number. "Cannot judge" must render as "—", never as a figure.
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

/**
 * Format a price for display — 4 decimals below 1, otherwise 2.
 *
 * ⚠️ The rule is not cosmetic. The movers strategy trades sub-$10 names, and at 2dp a $0.1234 price
 * renders "0.12" — a 3% error in the one number the whole page is about. Two panels each carried
 * their own `fmtPrice`; one had this rule and one did not, under the same name. Register row 296.
 */
export function formatPrice(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(Math.abs(v) < 1 ? 4 : 2);
}

/**
 * Format a grouped amount — fixed decimals, thousands separators, NO currency symbol.
 * Distinct from `formatDecimals` (no separators) and from `formatCurrency` (which adds a symbol and
 * renders zero as an em dash).
 */
export function formatAmount(n, decimals = 2) {
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Format a plain number to a fixed number of decimals — no sign, no currency, no thousands
 * separators. The ONE owner of this: five pages and panels each carried a copy (`fmtNum`, `fmtDec2`,
 * `fmt`) and two of them skipped the NaN guard, so a NaN rendered as "NaN" in one panel and "—" in
 * the next. Anything needing a currency symbol, a sign, or a separator uses one of the functions
 * above instead — those are different outputs, not different spellings of this one.
 */
export function formatDecimals(n, decimals = 2) {
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(decimals);
}

/** Format P&L value with sign */
export function formatPnl(v) {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${Number(v).toFixed(2)}`;
}

/** Format byte size to human-readable (B / KB / MB) */
export function formatSize(bytes, { short = false } = {}) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}${short ? 'KB' : ' KB'}`;
  return `${bytes}${short ? 'B' : ' B'}`;
}

/** Format milliseconds to a short string: "120ms" or "1.2s" */
export function formatMs(ms) {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Format megabytes to a short string: "512.0 MB" or "1.2 GB" */
export function formatMb(mb) {
  if (mb == null) return '—';
  return mb < 1000 ? `${mb.toFixed(1)} MB` : `${(mb / 1000).toFixed(1)} GB`;
}

/** Format a large count to a short string: "1.2M", "3.4K", or the raw number */
export function formatCount(n) {
  if (n == null) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/** Format an ISO timestamp as UTC date+time: "2026-08-16 14:23:01 UTC" */
export function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
}
