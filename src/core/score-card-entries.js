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
        vm: buildScoreDisplay(raw ?? {}),
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
