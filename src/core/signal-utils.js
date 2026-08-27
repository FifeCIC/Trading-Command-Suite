/**
 * Signal Utilities — canonical thresholds, colors, and badge rendering.
 * =====================================================================
 * SINGLE SOURCE OF TRUTH for signal classification and display.
 * Every page that displays scores/signals imports from here.
 *
 * THRESHOLDS: Stored in global_setting DB table, fetched at runtime.
 *             Fallback constants used when API is unavailable.
 *
 * @file src/core/signal-utils.js
 */
import { createElement } from 'react';

/** Fallback thresholds — overridden by API response when available */
let _buyThreshold = 65;
let _holdThreshold = 40;

/** Call once at app startup with API response from GET /api/settings/signals */
export function setSignalThresholds({ buy, hold }) {
  if (typeof buy === 'number' && buy > 0) _buyThreshold = buy;
  if (typeof hold === 'number' && hold > 0) _holdThreshold = hold;
}

/** Current thresholds (read-only) */
export function getThresholds() {
  return { BUY: _buyThreshold, HOLD: _holdThreshold };
}

// Legacy named exports for backward compat — these update when setSignalThresholds is called.
export const SIGNAL = { get BUY() { return _buyThreshold; }, get HOLD() { return _holdThreshold; } };

/**
 * Strip a leading warning glyph (⚠ / ⚠️ / 🚫) from risk-gate warning text.
 * Warning strings arrive pre-embellished from the engine; cards that prefix
 * their own icon call this to avoid doubled glyphs (#687).
 */
export function stripWarningGlyph(text) {
  return String(text ?? '').replace(/^\s*(?:⚠️?|🚫|❌)\s*/, '');
}

// ── Canonical colors ──────────────────────────────────────
export const SIGNAL_COLORS = {
  BUY:  '#22c55e',
  SELL: '#ef4444',
  HOLD: '#f59e0b',
  MUTED: '#64748b',
};

export const CHART_COLORS = {
  upColor: '#22c55e',
  downColor: '#ef4444',
  borderUpColor: '#22c55e',
  borderDownColor: '#ef4444',
  wickUpColor: '#22c55e',
  wickDownColor: '#ef4444',
};

export const PNL_COLORS = {
  profit: '#22c55e',
  loss: '#ef4444',
  neutral: '#64748b',
};

// ── Signal classification ─────────────────────────────────

export function getSignal(score) {
  if (score == null) return null;
  if (score >= _buyThreshold) return 'BUY';
  if (score >= _holdThreshold) return 'HOLD';
  return 'SELL';
}

export function scoreClass(score) {
  if (score == null) return 'pl-muted';
  if (score >= _buyThreshold) return 'pl-score-high';
  if (score >= _holdThreshold) return 'pl-score-med';
  return 'pl-score-low';
}

export function signalBadge(score) {
  if (score == null) return null;
  if (score >= _buyThreshold) return createElement('span', { className: 'pl-badge pl-badge-buy' }, 'BUY');
  if (score >= _holdThreshold) return createElement('span', { className: 'pl-badge pl-badge-hold' }, 'HOLD');
  return createElement('span', { className: 'pl-badge pl-badge-sell' }, 'SELL');
}

// ── Color helpers ─────────────────────────────────────────

/** Hex color for a score value */
export function scoreColor(score) {
  if (score == null) return SIGNAL_COLORS.MUTED;
  if (score >= _buyThreshold) return SIGNAL_COLORS.BUY;
  if (score >= _holdThreshold) return SIGNAL_COLORS.HOLD;
  return SIGNAL_COLORS.SELL;
}

/** Hex color for a signal string */
export function signalColor(signal) {
  return SIGNAL_COLORS[signal] || SIGNAL_COLORS.MUTED;
}

/** Map a signal string to a badge tone: 'buy' | 'sell' | 'hold' | 'neutral'. */
export function signalTone(signal) {
  if (signal === 'STRONG_BUY' || signal === 'BUY') return 'buy';
  if (signal === 'STRONG_SELL' || signal === 'SELL') return 'sell';
  if (signal === 'HOLD') return 'hold';
  return 'neutral';
}

/** Human-readable labels for protocol directionMode values (LONG_ONLY → 'Long Only'). */
export const DIRECTION_MODE_LABELS = {
  LONG_ONLY: 'Long Only',
  SHORT_ONLY: 'Short Only',
  BOTH: 'Both',
};

/** Convert a directionMode enum value to its human-readable label. */
export function directionModeLabel(mode) {
  return DIRECTION_MODE_LABELS[mode] || mode || '';
}

/** Directional arrow glyph for a signal string: ▲ buy, ▼ sell, — hold/neutral. */
export function signalArrow(signal) {
  if (signal === 'STRONG_BUY' || signal === 'BUY') return '▲';
  if (signal === 'STRONG_SELL' || signal === 'SELL') return '▼';
  return '—';
}

/** Score bar width + color for inline bar display */
export function scoreBar(score, max = 100) {
  if (score == null) return { width: 0, background: SIGNAL_COLORS.MUTED };
  const w = Math.max(2, Math.min(100, (score / max) * 100));
  return { width: `${w}%`, background: scoreColor(score) };
}

// ── P&L helpers ───────────────────────────────────────────

export function pnlClass(value) {
  if (value === null || value === undefined) return 'pl-muted';
  if (value > 0) return 'pl-score-high';
  if (value < 0) return 'pl-score-low';
  return 'pl-muted';
}

export function pnlSign(value) {
  if (value == null) return '—';
  if (value > 0) return `+$${value.toFixed(2)}`;
  return `$${value.toFixed(2)}`;
}

export function pnlColor(value) {
  if (value == null) return PNL_COLORS.neutral;
  if (value > 0) return PNL_COLORS.profit;
  if (value < 0) return PNL_COLORS.loss;
  return PNL_COLORS.neutral;
}
