/**
 * Score Display — the canonical "output establishment" layer.
 * ============================================================
 * ONE function decides what a score row MEANS for the UI, so pages stop
 * re-deriving signal, tone, tradeability state, and percentage locally.
 *
 * Design principle: "stop deciding in the page, decide in one function."
 *
 * Pages hand a raw score payload to buildScoreDisplay() and render the
 * resulting view model. They never compute tone, arrow, state, or pct
 * themselves — and they NEVER re-derive BUY/HOLD/SELL from a number.
 * Classification is server-owned (breakdown.signal).
 *
 * @file src/core/score-display.js
 */
import { signalTone, signalArrow } from './signal-utils';

/**
 * Tradeability state — the ONE place "is this a live tradable signal right
 * now" is decided. Every page renders the same way for the same state.
 */
export const SCORE_STATES = {
  LIVE: 'live',
  PAUSED: 'paused',     // market closed → frozen at last close
  STALE: 'stale',       // market open but data older than the freshness window
  UNSCORED: 'unscored', // no score produced at all
};

/** Age (ms) beyond which an "open" market's data is treated as stale. */
const STALE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Build the canonical display model for a single score row.
 *
 * @param {object} raw Raw fields from /api/scoring/runs or /api/scoring/breakdown.
 *   {
 *     signal,             // server-owned: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL'
 *     value,              // gated composite (0 when market closed)
 *     rawComposite,       // pre-gate signal strength (preferred when present)
 *     rawMax,             // directional denominator
 *     opportunityScore,
 *     opportunityMax,
 *     marketStatus,       // { open, asOf, reason }
 *   }
 * @returns {object} resolved view model — the ONLY thing pages should render.
 */
export function buildScoreDisplay(raw = {}) {
  const ms = raw.marketStatus ?? null;

  // Prefer the pre-gate raw composite (server-verified signal strength).
  // Fall back to the gated `value` for rows written before rawComposite existed.
  const score = raw.rawComposite ?? raw.value ?? null;
  const scoreMax = raw.rawMax ?? null;
  const pct = score != null && scoreMax ? Math.round((score / scoreMax) * 100) : null;

  const opportunityScore = raw.opportunityScore ?? null;
  const opportunityMax = raw.opportunityMax ?? null;
  const opportunityPct =
    opportunityScore != null && opportunityMax
      ? Math.round((opportunityScore / opportunityMax) * 100)
      : null;

  // Tradeability state — decided ONCE here, never in a page.
  let state = SCORE_STATES.UNSCORED;
  if (score != null) {
    if (ms && ms.open === false) {
      // `stale` distinguishes "market open but data stale" from "market closed"
      // (#732) — the server sets it from the calendar + bar freshness.
      state = ms.stale === true ? SCORE_STATES.STALE : SCORE_STATES.PAUSED;
    } else if (ms && ms.open === true) {
      const asOf = ms.asOf ? Date.parse(ms.asOf) : NaN;
      state =
        Number.isNaN(asOf) || Date.now() - asOf > STALE_MS
          ? SCORE_STATES.STALE
          : SCORE_STATES.LIVE;
    } else {
      // No marketStatus (legacy rows) — treat as live; classification still shown.
      state = SCORE_STATES.LIVE;
    }
  }

  const frozen = state === SCORE_STATES.PAUSED || state === SCORE_STATES.STALE;

  // Signal is server-owned. The client NEVER re-derives BUY/HOLD/SELL from pct.
  const signal = raw.signal && raw.signal !== '—' ? raw.signal : null;
  const tone = signal ? signalTone(signal) : 'neutral';
  const arrow = signal ? signalArrow(signal) : '—';

  return {
    signal,            // 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' | null
    tone,              // 'buy' | 'sell' | 'hold' | 'neutral'
    arrow,             // '▲' | '▼' | '—'
    state,             // SCORE_STATES.LIVE | PAUSED | STALE | UNSCORED
    frozen,            // true when the score is NOT a live tradable signal
    score,             // displayed signal strength (pre-gate)
    scoreMax,          // directional denominator (may be null for legacy rows)
    pct,               // rounded % of scoreMax (may be null)
    opportunityScore,
    opportunityMax,
    opportunityPct,
    marketStatus: ms,  // { open, asOf, reason } | null
    // Human copy for frozen/closed rows — built once, reused everywhere.
    frozenTitle: frozen
      ? `Market ${state === SCORE_STATES.STALE ? 'stale' : 'closed'} — ${signal ?? 'signal'} (${score ?? '—'}/${scoreMax ?? '—'}) frozen at last close, not a live tradable signal.`
      : undefined,
  };
}
