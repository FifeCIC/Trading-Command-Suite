/**
 * Format Utilities — canonical timestamp, duration, and currency formatting.
 * ========================================================================
 * Every page that displays times, durations, or currency imports from here.
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
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}
