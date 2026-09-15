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
 * ⚠️ THERE ARE DELIBERATELY NO FALLBACK THRESHOLD CONSTANTS HERE.
 *
 * An earlier version of this file carried `DEFAULT_ENTRY_PCT = 6` / `DEFAULT_STRONG_PCT = 13`
 * so a bar could be drawn while the thresholds request was in flight. That was wrong, and this
 * repo has already paid for the same mistake: `protocol-gating.service.ts` warns that a
 * hand-copied threshold is "a second place to drift, and an invisible threshold is exactly how
 * the app sat unable to trade for five days".
 *
 * The thresholds are SINGLE-SOURCED in the backend (`ENTRY_THRESHOLD` / `STRONG_PCT`). If the
 * UI cannot read them, the honest thing is to say so — not to classify against a remembered
 * number that may no longer be the one the server is using. A stale duplicate here would show
 * `STRONG` for a reading the server had already stopped calling strong, which is worse than
 * showing nothing.
 *
 * So when thresholds are unavailable: no chip, no tick, and the bar falls back to the RAW
 * percentage. That is visibly "we don't know the scale", and it cannot be mistaken for a
 * judgement.
 */

/**
 * thresholdGeometry() — map a raw percentage onto the bars that actually gate a trade.
 *
 * ⚠️ WHY THIS EXISTS (2026-09-15) — this fixes a display that made good signals look worthless.
 *
 * The Signal bar used to be filled to the RAW percentage of configured capacity:
 *
 *     width: `${signalPct}%`          // signalPct ≈ 8–18 in practice
 *
 * That was correct arithmetic and useless as a picture. ADR-011 (#758) changed the percentage
 * denominator from the OBSERVED directional sum (~130) to the CONFIGURED capacity (~725), which
 * divided every percentage by ~6.3. So the practical ceiling became ~15–33%, and a bar drawn
 * against an unreachable 100% can never look more than a fifth full. The owner's words:
 *
 *     "it looks like nothing could ever be worth trading"
 *
 * The number was never wrong. The BAR was normalised against a target nothing can hit.
 *
 * The fix: normalise the bar so the STRONG bar fills it, and mark where ENTRY sits. A reading at
 * the peak now renders a FULL bar — because at the peak it IS full, and that is the truth the
 * display was hiding.
 *
 * ⚠️ THIS DOES NOT CLASSIFY. `signal` stays server-owned — see the "client NEVER re-derives
 * BUY/HOLD/SELL" rule in the file header. `standing` describes where a NUMBER sits on a scale
 * the SERVER defined; it is not a label and must never override the server's `signal`.
 *
 * ⚠️ AND IT IS NOT A QUALITY JUDGEMENT. "STRONG" means "cleared the STRONG bar", and that bar is
 * a configurable constant that was deliberately rescaled on 2026-09-15 to let the pipeline trade
 * at all. A reading can be `strong` and the strategy still be unprofitable — measured directional
 * accuracy is 39–48%, at or below chance. The chip reports position on a scale; it does not
 * claim edge.
 *
 * @param {number|null} pct Raw percentage of capacity (e.g. 18).
 * @param {{entry?: number, strong?: number}|null} thresholds Live thresholds from the server.
 * @returns {{
 *   fillPct: number,           // 0-100 — bar width; STRONG = 100 when thresholds are known
 *   entryMarkPct: number|null, // 0-100 — ENTRY position on that scale; null when unknown
 *   pct: number|null,          // the raw percentage, clamped 0-100 for width safety
 *   standing: 'strong'|'entry'|'below'|null,
 *   scaleKnown: boolean,       // false => thresholds unavailable; chip/tick suppressed
 * }}
 */
export function thresholdGeometry(pct, thresholds) {
  const strong = Number(thresholds?.strong);
  const entry = Number(thresholds?.entry);

  // A zero/absent STRONG bar would divide by zero and produce Infinity widths, which React
  // renders as `width: Infinity%` and the browser silently drops — the bar would vanish
  // entirely rather than fail loudly. Treat any non-positive value as "unknown".
  const scaleKnown =
    Number.isFinite(strong) && strong > 0 && Number.isFinite(entry) && entry >= 0;

  if (!Number.isFinite(Number(pct))) {
    return {
      fillPct: 0,
      entryMarkPct: scaleKnown ? Math.min(100, (entry / strong) * 100) : null,
      pct: null,
      standing: null,
      scaleKnown,
    };
  }

  const raw = Number(pct);

  // Scale unknown => no normalisation, no chip, no tick. Show the raw number honestly.
  if (!scaleKnown) {
    return {
      fillPct: Math.min(100, Math.max(0, raw)),
      entryMarkPct: null,
      pct: Math.min(100, Math.max(0, raw)),
      standing: null,
      scaleKnown: false,
    };
  }

  // ⚠️ Normalise against STRONG, not 100. This is the whole fix. `Math.min` clamps a reading
  // above the strong bar to a full bar rather than overflowing the track, which is accurate:
  // once past STRONG, more strength has no further bar left to fill.
  const fillPct = Math.min(100, Math.max(0, (raw / strong) * 100));

  const standing = raw >= strong ? 'strong' : raw >= entry ? 'entry' : 'below';

  return {
    fillPct,
    entryMarkPct: Math.min(100, (entry / strong) * 100),
    pct: Math.min(100, Math.max(0, raw)),
    standing,
    scaleKnown: true,
  };
}

/**
 * The threshold ladder for a bar, in words — for tooltips and small labels.
 *
 * Kept separate from the geometry so a page can explain the scale WITHOUT re-deriving it.
 */
export function describeThresholdScale(thresholds) {
  const strong = Number(thresholds?.strong);
  const entry = Number(thresholds?.entry);
  const scaleKnown =
    Number.isFinite(strong) && strong > 0 && Number.isFinite(entry) && entry >= 0;

  if (!scaleKnown) {
    return (
      'The classification thresholds could not be read from the server, so this reading is ' +
      'shown as a plain percentage against configured directional capacity. The bar is NOT ' +
      'normalised and no STRONG/ENTRY label is claimed — the scale is unknown, and guessing ' +
      'it would be worse than showing nothing.'
    );
  }

  return (
    `Measured against configured directional capacity — NOT out of 100. ` +
    `This bar fills at ${strong}% (STRONG); ${entry}% is the entry bar. ` +
    `A full bar means the setup has reached STRONG — a reading of ${strong}% or more is the top of the scale, not a low score. ` +
    `⚠️ These thresholds are adjustable constants, not fixed truths: they were rescaled on 2026-09-15 (40→6, 80→13) so the pipeline would trade at all. ` +
    `STRONG reports position on that scale — it is not a claim of edge.`
  );
}


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
