/**
 * score-card-entries.js — turn raw scoring runs into SCORE CARD entries.
 * ======================================================================
 * Extracted from `LadderPage.jsx` (2026-09-17) so the META.Stack Cockpit's Scores
 * column builds its cards from the SAME code, rather than a near-copy that would
 * drift. This is the "approach to getting records and forming cards" that both pages
 * must share — the card component is only half of it.
 *
 * INPUT (both from `useProtocolData()`, the existing shared hook):
 *   - `protocols` — GET /api/scoring/gated/protocols → each has `resolvedSymbols[]`
 *   - `runs`      — GET /api/scoring/runs?limit=200&groupBy=protocol → each has `scores[]`
 *
 * OUTPUT: a flat array of card entries, one per (protocol × resolved symbol). NOT
 * filtered or sorted — that stays page-specific, because the Ladder's age/market/search
 * rules are its own and the cockpit does not want them.
 *
 * ⚠️ WHY THERE ARE TWO MAPS (exact + family)
 * The gated-protocol registry and the run store name the same strategy slightly
 * differently: the registry uses `xau-speed-v1` while runs are emitted per timeframe as
 * `xau-speed-m5` / `-m15` / `-1h` / `-4h`. Deleting the `-v1` suffix reconciles them. Two
 * maps rather than one because a DIRECT hit must always beat a FAMILY hit: if a protocol
 * ever does emit its own run, that exact score wins and the fallback is inert.
 *
 * ⚠️ ORDERING IS LOAD-BEARING
 * `runs` is timestamp-descending, so the FIRST match per key is the latest. The family map
 * additionally compares timestamps, because first-wins is only correct when the input is
 * genuinely ordered — do not "simplify" either to a plain assignment.
 *
 * ⚠️ Every field here is consumed by `ScoreCard`. In particular `scoreId` is the persisted
 * Score row UUID: never displayed, but the ONLY handle that re-fetches this exact row
 * (see `buildCardRef`). Dropping it silently breaks the card's copy-reference button.
 */
import { buildScoreDisplay } from './score-display';
import { familyOf } from './score-card-view';

/**
 * DEFAULT SCORE-AGE LIMIT — a LIVENESS label, not a scoring rule.
 * ==============================================================
 * A card whose row has not been replaced for longer than this is marked `expired`, which sets
 * `frozen: true`. That single flag is enough: the Ladder's sorter already ranks
 * "actionable before score size", so an expired card stops outranking live ones with no new
 * ranking logic.
 *
 * ⚠️ WHY A CONSTANT IS ACCEPTABLE HERE, WHEN `score-display.js` REFUSES ONE FOR THE
 * ENTRY/STRONG THRESHOLDS. Those thresholds decide what a signal IS — a hand-copied number there
 * makes the UI disagree with the scorer. This one decides only whether a row is still being
 * replaced, and the row carries its own timestamp; the window is a display floor, and the chip
 * prints the real age beside it so nobody has to trust the number.
 *
 * The AUTHORITATIVE stall value already exists server-side: `stalledForMinutes` on
 * `/api/scoring/gated/protocols/status`. This payload does not carry it, so the age is computed
 * from timestamps the server sent. If the protocols payload gains that field, replace this
 * constant with it — do not add a third source.
 *
 * WHY 180 AS THE FALLBACK: every currently-active protocol is intraday (5m/15m/1h), and three
 * missed hourly bars is the point at which a card is genuinely not current. A protocol whose
 * cadence IS on the payload derives its own window above; one with an unusual horizon declares
 * `maxScoreAgeMinutes`.
 */
const DEFAULT_MAX_SCORE_AGE_MINUTES = 180;

/**
 * Cache window per CADENCE. A protocol's freshness window is a property of the horizon it trades,
 * not a global constant — a 5-minute scalp is dead after 30 minutes while a daily swing protocol is
 * perfectly current after two days. Owner, 2026-10-19: *"it should be depending on the protocol
 * because some are scoring based on different targeted trading periods."*
 *
 * Resolution order (first wins):
 *   1. `protocol.maxScoreAgeMinutes` — explicit declaration on the registry row. Use this when the
 *      horizon is unusual; it is the only value that is a decision rather than a derivation.
 *   2. 3 × the protocol's recommended cadence — the same "three missed bars" rule the rest of the
 *      pipeline uses.
 *   3. `DEFAULT_MAX_SCORE_AGE_MINUTES` when the cadence is not on the payload. Not a guess at the
 *      horizon: it is the fallback the card prints beside the real age, so the reader can see the
 *      window that was applied.
 */
const CADENCE_MINUTES = {
  '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '1d': 1440,
};

const maxAgeMinutesFor = (protocol) => {
  if (Number.isFinite(protocol?.maxScoreAgeMinutes)) return protocol.maxScoreAgeMinutes;
  const cadence = CADENCE_MINUTES[protocol?.recommendedTimeframe ?? protocol?.timeframe];
  if (Number.isFinite(cadence)) return Math.max(60, cadence * 3);
  return DEFAULT_MAX_SCORE_AGE_MINUTES;
};

/** Age of a score row in minutes, or `null` when the timestamp cannot be read — never 0. */
const ageMinutesOf = (timestamp) => {
  const at = Date.parse(timestamp);
  return Number.isFinite(at) ? (Date.now() - at) / 60_000 : null;
};

/**
 * @param {Array} protocols  gated protocols, each with `id`, `name`, `resolvedSymbols[]`
 * @param {Array} runs       scoring runs, timestamp-descending, each with `protocolId` + `scores[]`
 * @returns {Array} card entries shaped for `ScoreCard` / `buildCardRef`
 */
export function buildScoreEntries(protocols = [], runs = []) {
  // ── 1. Index every run row by symbol, exactly and by family ──
  const exact = {};
  const family = {};
  for (const run of runs) {
    const proto = run.protocolId || run.strategyId;
    for (const s of run.scores || []) {
      const ticker = (s.ticker || s.symbol || '').toUpperCase();
      if (!ticker) continue;
      // Runs are timestamp-desc, so the first match per key is the latest.
      const row = {
        value: s.value,
        signal: s.signal ?? null,
        rawComposite: s.rawComposite ?? s.value,
        rawMax: s.rawMax ?? null,
        opportunityScore: s.opportunityScore ?? null,
        opportunityMax: s.opportunityMax ?? null,
        marketStatus: s.marketStatus ?? null,
        // The pre-filter direction split — needed so a `0` can be told apart from "nothing
        // measured". See the REFUSED EVIDENCE note in score-display.js.
        directionalEvidence: s.directionalEvidence ?? null,
        directionMode: s.directionMode ?? null,
        timestamp: run.timestamp,
        // Which protocol emitted this row — the card footer always names it.
        protocolId: proto,
        // The persisted Score row UUID. Never displayed, but it is the ONE value on
        // this row that can be looked up again — see buildCardRef().
        scoreId: s.id ?? null,
      };
      const key = `${ticker}::${proto}`;
      if (!exact[key]) exact[key] = row;

      // Family key: drop the version suffix and the trailing timeframe.
      // `xau-speed-m5` and `xau-speed-v1` both become `xau-speed`.
      const fam = `${ticker}::${familyOf(proto)}`;
      const prev = family[fam];
      if (!prev || Date.parse(run.timestamp) > Date.parse(prev.timestamp)) {
        family[fam] = { ...row, sourceProtocolId: proto };
      }
    }
  }

  // ── 2. One entry per protocol × resolved symbol ──
  const entries = [];
  for (const p of protocols) {
    for (const sym of p.resolvedSymbols || []) {
      const ticker = sym.toUpperCase();
      // Exact run for this protocol id first; otherwise the family fallback.
      // `borrowed` marks the fallback so the card can say which timeframe the
      // number actually came from.
      const hit = exact[`${ticker}::${p.id}`] || null;
      const borrowed = hit ? null : (family[`${ticker}::${familyOf(p.id)}`] || null);
      const raw = hit || borrowed;
      entries.push({
        symbol: ticker,
        protocolId: p.id,
        protocolName: p.name || p.id,
        raw,
        vm: buildScoreDisplay(raw ?? {}, {
          ageMinutes: ageMinutesOf(raw?.timestamp),
          maxAgeMinutes: maxAgeMinutesFor(p),
        }),
        hasScore: !!raw,
        time: raw?.timestamp ?? null,
        // The persisted Score row UUID for this symbol+protocol — copied by the
        // card's ⧉ button so an investigation starts from the real id.
        scoreId: raw?.scoreId ?? null,
        // The protocol id that actually produced the number. Equal to this
        // card's protocolId for an exact match; the sibling's id when borrowed.
        runId: raw?.protocolId ?? null,
        // Only a genuine cross-timeframe borrow gets the "via" chip. When the
        // family fallback resolves back to this card's own protocol id there is
        // nothing borrowed, and chipping it would just duplicate the run id.
        scoreFrom: borrowed && borrowed.sourceProtocolId !== p.id ? borrowed.sourceProtocolId : null,
        // Adaptive Target (2026-09-10). `adaptiveTargetActive` is true only when the
        // target is enabled AND rests on enough observations to actually move the
        // denominator — a flag-on-but-inactive protocol is NOT badged, because its
        // scores are still on the configured scale and a badge would mislead.
        adaptiveTargetActive: !!p.adaptiveTargetActive,
        adaptiveTargetMax: p.adaptiveTargetMax ?? null,
      });
    }
  }

  return entries;
}
