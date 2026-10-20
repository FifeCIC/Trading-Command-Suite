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
import { signalTone, signalArrow } from './signal-utils.js';

/**
 * Tradeability state — the ONE place "is this a live tradable signal right
 * now" is decided. Every page renders the same way for the same state.
 *
 * ⚠️ TWO AXES, ONE WORD EACH (#774). `marketOpen` (a calendar fact) and `dataFresh`
 * (is the feed keeping up) are INDEPENDENT questions, and this vocabulary keeps them apart:
 *
 *   LIVE       open + fresh          — a live tradable reading
 *   PAUSED     calendar closed       — BENIGN and expected: weekend, outside session. Data age
 *                                      while closed is ALSO expected and must NOT upgrade this
 *                                      to STALE — that was the defect: a closed card could read
 *                                      `STALE`, so a real feed failure looked like a quiet Sunday.
 *   STALE      OPEN + data behind    — an INCIDENT: investigate. Only an open market can be stale.
 *   UNSCORED   no reading at all     — never rendered as Live.
 *
 * ⚠️ FRESHNESS IS THE SERVER'S CALL. The old code re-derived staleness here from `asOf` and a
 * local 30-minute constant — a second owner for a number `computeMarketStatus()` already owns,
 * which drifts. The `stale` flag comes from the API; this file only maps it to a label.
 */
export const SCORE_STATES = {
  LIVE: 'live',
  PAUSED: 'paused',     // market closed → frozen at last close (benign, expected)
  STALE: 'stale',       // market OPEN but the feed is behind → investigate
  EXPIRED: 'expired',   // ⚠️ the SCORE itself stopped being replaced → see below
  UNSCORED: 'unscored', // no score produced at all
};

/**
 * ⚠️ `EXPIRED` — the state that was missing, and it is NOT the same question as the other three.
 * =============================================================================================
 * PAUSED and STALE describe the MARKET at the moment the row was written. Neither can describe
 * the row itself, because both are stamped into the row and then frozen with it.
 *
 * Measured 2026-10-19, `probe-1dir-v1` / EURUSD:
 *
 *   • the automation loop ran the protocol every 2 minutes — `lastTickAt` was 81 seconds old
 *   • the single directive returned a real 29/100 measurement and classified itself `neutral`
 *   • a `neutral` tick writes NO row (`noData → continue`), so the newest row stayed 16 Oct
 *   • that row carried `marketStatus: { open: true, stale: false }` — written when the market was
 *     open and the feed was fresh — so this file returned `LIVE`, `frozen: false`
 *
 * Result: a **2-day-old `STRONG_BUY` 60/100** rendered with a `Live` chip, ranked ABOVE every live
 * score on the ladder, because the ladder's sorter demotes only `frozen` cards and this one was
 * not frozen. `stalledForMinutes` (4,146) was already being computed by the API and read by
 * nothing.
 *
 * So age is a THIRD axis: not "is the market open", not "is the feed behind", but **"is this row
 * still being replaced?"**. An open market with an ancient score is precisely the dangerous case —
 * it is the shape of a protocol that has gone silent while showing its last confident reading.
 *
 * Precedence: **PAUSED first, then EXPIRED.** A closed market is *expected* to write nothing, so
 * age over a weekend is the normal case and must stay benign — otherwise every FX card alarms from
 * Friday close to Monday open. EXPIRED therefore applies only while the market is open (or when the
 * row carries no market status at all): an open market with an ancient score is precisely the shape
 * of a protocol that has gone silent while still displaying its last confident reading.
 *
 * ⚠️ `maxAgeMinutes` is supplied by the CALLER, not held here as a constant, because the honest
 * window depends on the protocol's cadence — a daily protocol is not stale after three hours.
 * `score-card-entries.js` owns the default and documents it.
 */

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
 * standingClass() — map a `thresholdGeometry().standing` onto the shared score CSS classes.
 *
 * ⚠️ WHY THIS EXISTS, AND WHY IT IS NOT `scoreClass()` (measured 2026-09-16, #847)
 * --------------------------------------------------------------------------------
 * `scoreClass(v)` (in signal-utils) classifies a value against the 0-100 display scale (65/40).
 * It was being called with PERCENT-OF-CAPACITY values — measured live on `strategy_signal_queue`:
 *
 *     compositePct   n=16   min 7    max 17     -> 0 rows >= 40, 0 rows >= 65
 *     signalPct      n=16   min 7    max 17     -> 0 rows >= 40, 0 rows >= 65
 *
 * Against a bar of 40 a value of 7-17 can NEVER classify as anything but "low". So **100% of
 * queued signals rendered as poor** while the server was calling some of them BUY/STRONG. That is
 * #839's defect shape one layer up: plausible numbers, no error, nothing throws.
 *
 * A percentage must be classified against the scale it was measured on, and that scale is
 * `thresholdGeometry()`'s job — it knows entry/strong and already returns a null `standing` when
 * the thresholds could not be read.
 *
 * ⚠️ `null` standing renders MUTED, never "low". "We cannot judge" and "this is poor" are
 * different claims and must never look the same — the rule stated in this file's header.
 *
 * @param {'strong'|'entry'|'below'|null|undefined} standing From `thresholdGeometry().standing`.
 * @returns {string} a CSS class name.
 */
export function standingClass(standing) {
  if (standing === 'strong') return 'pl-score-high';
  if (standing === 'entry') return 'pl-score-med';
  if (standing === 'below') return 'pl-score-low';
  return 'pl-muted';
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
export function buildScoreDisplay(raw = {}, options = {}) {
  const ms = raw.marketStatus ?? null;
  // Score age — the third axis (see SCORE_STATES.EXPIRED). Both numbers come from the caller:
  // this file compares them, it does not own the window.
  const ageMinutes = Number.isFinite(options.ageMinutes) ? options.ageMinutes : null;
  const maxAgeMinutes = Number.isFinite(options.maxAgeMinutes) ? options.maxAgeMinutes : null;
  const ageExpired = ageMinutes != null && maxAgeMinutes != null && ageMinutes > maxAgeMinutes;

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

  // Tradeability state — decided ONCE here, never in a page (#774).
  //
  // The four states are MUTUALLY EXCLUSIVE by construction: `open === false` short-circuits to
  // PAUSED, so a closed market can never also be STALE, and only an open market consults the
  // freshness flag. That is what stops the chip flipping between two words for one situation.
  let state = SCORE_STATES.UNSCORED;
  if (score != null) {
    if (ms && ms.open === false) {
      // CALENDAR SAYS CLOSED → PAUSED, always, and it OUTRANKS age.
      // A closed market is EXPECTED to write nothing, so an old row over a weekend is the normal
      // case, not an incident — the same reasoning that stops data age upgrading this to STALE.
      // Age-expiring while closed would alarm every FX card from Friday close to Monday open.
      state = SCORE_STATES.PAUSED;
    } else if (ageExpired) {
      // ⚠️ OPEN (or age-known but market unstated) and the row has not been replaced → EXPIRED.
      // This is the 2-day-old `Live` card: open market, ancient score, `frozen` false.
      state = SCORE_STATES.EXPIRED;
    } else if (!ms) {
      // No marketStatus (legacy rows) — classification still shown. Unchanged behaviour.
      state = SCORE_STATES.LIVE;
    } else {
      // Open (or open unstated) → freshness is the SERVER's flag, never a local clock comparison.
      state = ms.stale === true ? SCORE_STATES.STALE : SCORE_STATES.LIVE;
    }
  }

  // ── REFUSED EVIDENCE — say what was measured and not counted ────────────────
  //
  // ⚠️ MEASURED, XAUUSD / `xau-speed-m15`, 2026-10-19 22:41Z: eleven directives ran, two returned
  // `bearish`, the engine recorded `0 / 910`, and the card read `SIGNAL 0`. The direction split it
  // refused was 80/240 bearish (33%).
  //
  // That zero is arithmetically correct and semantically useless: `rawComposite` counts only the
  // PERMITTED direction while `rawMax` keeps the capacity of BOTH. So a clear short case renders as
  // a flat nothing, indistinguishable from "no data" — the exact confusion this repo keeps paying
  // for. This does not change any score; it names the evidence the score excludes.
  const de = raw.directionalEvidence ?? null;
  const directionMode = raw.directionMode ?? null;
  let refusedNote = null;
  if (de && score === 0) {
    const refused = [
      { side: 'bearish', raw: Number(de.bearishRaw) || 0, max: Number(de.bearishMax) || 0 },
      { side: 'bullish', raw: Number(de.bullishRaw) || 0, max: Number(de.bullishMax) || 0 },
    ].filter((s) => s.raw > 0 && de.selected !== s.side)[0];
    if (refused) {
      const share = refused.max > 0 ? ` (${Math.round((refused.raw / refused.max) * 100)}%)` : '';
      refusedNote =
        `Measured ${refused.side} evidence ${refused.raw}/${refused.max}${share}, but ` +
        `${directionMode ?? 'this protocol'} cannot act on it — the Signal score counts only the ` +
        `permitted direction, so a real reading is showing as zero.`;
    }
  }

  const frozen =
    state === SCORE_STATES.PAUSED ||
    state === SCORE_STATES.STALE ||
    state === SCORE_STATES.EXPIRED;

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
    /**
     * True when the state is worth the operator's attention (open + feed behind). Benign states
     * (closed market) are false — only one of the four is an incident, and the UI styles it apart.
     */
    needsAttention: state === SCORE_STATES.STALE || state === SCORE_STATES.EXPIRED,
    ageMinutes,
    /** Non-null when the engine measured evidence it was not allowed to count — see above. */
    refusedNote,
    // Human copy for frozen/closed rows — built once, reused everywhere. The SERVER's reason is
    // surfaced when present ("calendar closed" vs "cadence indeterminate") rather than re-derived.
    frozenTitle: frozen
      ? `${
          state === SCORE_STATES.EXPIRED
            ? `NO NEW SCORE for ${ageMinutes != null ? `${Math.round(ageMinutes)} min` : 'too long'} (limit ${maxAgeMinutes} min) — the protocol is still being run on live data but has not written a reading, so this is the last one it produced`
            : state === SCORE_STATES.STALE
              ? 'Market OPEN but data stale'
              : 'Market closed'
        }${ms?.reason ? ` (${ms.reason})` : ''} — ${signal ?? 'signal'} (${score ?? '—'}/${scoreMax ?? '—'}) is NOT a live tradable signal.`
      : undefined,
  };
}
