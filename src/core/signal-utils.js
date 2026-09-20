/**
 * Signal Utilities — canonical thresholds, colors, and badge rendering.
 * =====================================================================
 * SINGLE SOURCE OF TRUTH for signal classification and display.
 * Every page that displays scores/signals imports from here.
 *
 * ⚠️ TWO SCALES LIVE IN THIS APP. Read this before using anything below (#847).
 * --------------------------------------------------------------------------------
 *   1. THE 0-100 SCORE SCALE — what the helpers in THIS file classify against (65/40).
 *      Correct input: a genuine 0-100 score, e.g. `signal_rank_snapshot.combinedStrength`
 *      (measured live 2026-09-16: 18-74).
 *
 *   2. THE PERCENT-OF-CAPACITY SCALE (ADR-011, rescaled 2026-09-15 to entry 6 / strong 13).
 *      Correct input: a percentage of configured directional capacity, e.g.
 *      `strategy_signal_queue.compositePct` (measured live: 7-17) or `signalPct` (7-17).
 *      These are classified by `thresholdGeometry()` in `score-display.js`, NOT here.
 *
 * ⚠️ PASSING A SCALE-2 VALUE TO A SCALE-1 HELPER IS SILENT AND WRONG. Measured 2026-09-16: 0 of
 * 16 `compositePct` rows reach 40, so `scoreClass(compositePct)` returned "low" for **100%** of
 * queued signals while the server called some of them BUY/STRONG. Same defect shape as #839 — a
 * plausible wrong answer with no error.
 *
 * ⚠️ THE 65/40 FALLBACK BELOW HAS NO SERVER-SIDE OWNER. It is a legacy 0-100 display scale. The
 * comment that used to sit here claimed these come from `GET /api/settings/signals` — that endpoint
 * does NOT exist and never did, so `setSignalThresholds()` has never been called and these values
 * have never been anything but the literal 65/40. Do not add a second memory site (see
 * `broker-utils.js`, which documents the same rule for the style bars); if these need to become
 * server-driven, wire them to `GET /api/scoring/gated/thresholds` like every other live threshold.
 *
 * ✅ 2026-09-20 — THE CLASS IS CLOSED (measured). The 2026-09-16 pass migrated the FIRST percent
 * call sites (StrategyMonitorPage queues, `score-display.standingClass`). Measurement then found
 * four survivors still passing values that are NOT on this file's scale into `scoreClass` /
 * `scoreColor`:
 *
 *     Protocols Performance  scoreClass(e.vm.pct)      vm.pct = rawComposite/rawMax = 58/1295 = 4.5
 *     Symbols Ladder         scoreClass(pct)           the same value, Signal AND Opportunity cells
 *     Protocols Ladder       scoreClass(p.topScore)    a symbol's display score (0-100 observed)
 *     Hot Picks widget       scoreColor(pick.score)    ranked score (29-57 today, not a percent)
 *
 * Against 65/40 the first two painted **100% of rows "low"** while the server called some of them
 * BUY/STRONG — the #847 defect surviving one layer deeper. All four now classify on their real
 * scale: percent-of-capacity → `thresholdGeometry()` + `standingClass()` against the LIVE server
 * bars; server-classified → `signalClass()` below. `scoreClass` is now only for genuine 0-100
 * display values, and `nest/scripts/validate-threshold-sources.cjs` fails the build if a `*pct` /
 * `composite` identifier reaches it.
 *
 * @file src/core/signal-utils.js
 */
import { createElement } from 'react';

/**
 * Legacy 0-100 display-scale thresholds. NOT the ADR-011 percent scale — see the header.
 * ⚠️ Unreferenced by any server endpoint; `setSignalThresholds()` currently has no caller.
 */
let _buyThreshold = 65;
let _holdThreshold = 40;

/**
 * Inject the 0-100 display thresholds.
 *
 * ⚠️ NOT wired to anything, and deliberately left that way rather than pointed at a made-up
 * endpoint. To make these live, call this from an app-level `useQuery(fetchScoringThresholds)` in
 * `App.jsx` — but note the endpoint returns the ADR-011 percent scale (entry/strong), which is a
 * DIFFERENT scale from this one. Deciding whether these two scales should merge is a design
 * question, not a wiring question (#657).
 */
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

/**
 * CSS class for a GENUINE 0-100 display value (e.g. `signal_rank_snapshot.combinedStrength`,
 * measured 18-74). This is the legacy display scale owned by this file.
 *
 * ⚠️ NOT for percent-of-capacity (`compositePct`, `signalPct`, `normalizedScore` — 4-17 after the
 * 2026-09-15 rescale) and NOT for raw composites or `*pct` fields. Measured 2026-09-20:
 * `vm.pct` for BTC is 58/1295 = 4.5, so this function painted 100% of rows "low" while the server
 * called some of them BUY/STRONG — plausible output, no error (#839/#847 shape).
 *
 *   - percent-of-capacity  →  thresholdGeometry(pct, thresholds) + standingClass(standing)
 *   - server-classified    →  signalClass(signal)
 *
 * `nest/scripts/validate-threshold-sources.cjs` fails the build when a `*pct` / `composite`
 * identifier is passed here.
 */
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

/**
 * CSS class for a SERVER-CLASSIFIED value — colour comes from the signal, not a remembered bar.
 *
 * Use this wherever the row already carries the server's own classification (`signal`,
 * `topSignal`, `lastSignal`, `vm.signal`): the repo's rule is that the client NEVER re-derives
 * BUY/HOLD/SELL from a number, so it must not grade the number against a local scale either.
 *
 * Unknown/absent signal resolves to `pl-muted` — "cannot judge" must never render as "good"
 * or "poor" (see `score-display.js`: `null` standing renders muted for the same reason).
 */
export function signalClass(signal) {
  const tone = signalTone(signal);
  if (tone === 'buy') return 'pl-score-high';
  if (tone === 'hold') return 'pl-score-med';
  if (tone === 'sell') return 'pl-score-low';
  return 'pl-muted';
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
