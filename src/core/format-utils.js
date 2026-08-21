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
