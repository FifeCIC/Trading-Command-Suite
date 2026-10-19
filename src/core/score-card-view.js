/**
 * score-card-view.js — pure helpers for rendering / copying a SCORE card.
 * ======================================================================
 * Extracted from `LadderPage.jsx` (2026-09-17) so the META.Stack Cockpit can
 * re-display the same score cards without a second copy of this logic.
 *
 * WHY THESE MOVED (not just the JSX):
 * Every function here encodes a DECISION that two pages must agree on. If the
 * cockpit grew its own copy, the two would drift and only one would receive the
 * next fix — the failure mode `shared-core.instructions.md` calls "the most
 * expensive kind of technical debt".
 *
 *   - STATE_CLASS / stateLabel / stateClass — the state vocabulary. A chip that
 *     said "Live" on one page and "Live" on another but with a different colour
 *     would be worse than either alone.
 *   - familyOf — decides WHICH score a card shows (see its own comment).
 *   - buildCardRef — the investigating tool. Its whole value is that two people
 *     pasting a card reference paste the SAME fields.
 *   - matchesSearch — deliberately matches the words the chips RENDER, via
 *     stateLabel(), so search cannot drift from the labels.
 *
 * No React, no DOM reads beyond `window.location` — pure so it is trivially
 * testable and safe to call from any page.
 */

/**
 * State vocabulary, keyed by `vm.state`.
 *
 * `vm.state` falls back to the unscored style rather than emitting a
 * `lad-state--undefined` class that would silently render unstyled.
 */
export const STATE_CLASS = {
  live: 'lad-state--live',
  paused: 'lad-state--paused',
  stale: 'lad-state--stale',
  unscored: 'lad-state--unscored',
  closed: 'lad-state--closed',
};

/**
 * Human label for a card's state chip. See STATE_CLASS for the vocabulary.
 *
 * ⚠️ "Not scored" is a distinct value, never "Live". An unscored row claiming
 * "Live" reads as a live tradable signal sitting next to a blank score.
 */
export function stateLabel(vm) {
  if (vm.state === 'unscored') return 'Not scored';
  if (vm.state === 'expired') return 'No new score';
  if (vm.state === 'stale') return 'Data stale';
  if (vm.frozen) return 'Market closed';
  return 'Live';
}

/**
 * Tooltip for the state chip — carries the SERVER's reason rather than a re-derivation (#774).
 * A closed market should say WHY it is closed (weekend / outside session) when the API knows.
 */
export function stateTitle(vm) {
  if (vm.frozenTitle) return vm.frozenTitle;
  if (vm.state === 'unscored') return 'No score has been produced for this row.';
  const ms = vm.marketStatus;
  return ms?.reason ? `Live — ${ms.reason}` : undefined;
}

/** CSS modifier for a card's state chip — the label/colour pair in one place. */
export function stateClass(vm) {
  if (vm.state === 'unscored') return STATE_CLASS.unscored;
  // An expired score is an INCIDENT, not a quiet market: the protocol is running and has stopped
  // producing readings. It gets the attention styling, never the benign closed styling.
  if (vm.state === 'expired') return STATE_CLASS.stale;
  if (!vm.frozen) return STATE_CLASS[vm.state] || STATE_CLASS.live;
  return vm.state === 'stale' ? STATE_CLASS.stale : STATE_CLASS.closed;
}

/**
 * familyOf(protocolId) — the protocol identity with its VARIANT stripped.
 *
 * A scoring run records the protocol that produced it (`xau-speed-v1`,
 * `xau-speed-m5`, …) but a card is labelled with the protocol the user selected,
 * which may be the family name. Matching on the raw id would leave the card
 * blank whenever a variant ran but the family was selected; stripping the
 * version and timeframe suffix means the card can find its score whichever name
 * produced it.
 */
export function familyOf(protocolId) {
  return String(protocolId || '')
    .toLowerCase()
    .replace(/-v\d+$/, '')                    // xau-speed-v1   -> xau-speed
    .replace(/-(m1|m5|m15|m30|h1|h4|d1|w1|mn1|\d+[mhd])$/, ''); // xau-speed-m5 -> xau-speed
}

/**
 * matchesSearch(entry, query) — does a score card match the free-text search?
 *
 * Covers the three things a user actually looks for:
 *   - SYMBOL        — "xau" finds XAUUSD and XAGUSD
 *   - PROTOCOL      — the display name OR the id, so "gold" and "xau-speed" both work
 *   - STATE/SIGNAL  — "live", "stale", "closed", "not scored" and the signal word
 *                     (BUY / HOLD / SELL), which is what the badge renders.
 *
 * The state words are matched against the SAME helper the chip renders with
 * (`stateLabel`), not a re-typed list — otherwise the search would drift from the
 * labels the moment a chip is renamed. `signalClass` is deliberately not searched:
 * the badge shows the direction word, so matching the class would accept queries
 * the user cannot see on screen.
 *
 * Space-separated terms are ANDed, so "gold live" narrows to live Gold cards.
 */
export function matchesSearch(e, query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    e.symbol,
    e.protocolName,
    e.protocolId,
    e.runId,
    e.scoreFrom,
    stateLabel(e.vm),
    e.hasScore ? (e.vm.signal || '') : 'not scored',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

/**
 * buildCardRef(entry, opts) — the text a score card copies to the clipboard.
 * ========================================================================
 * WHY THIS EXISTS (2026-09-16, user request): investigating a card meant reading the
 * numbers off the screen and retyping them into chat. Every value on the card is
 * DERIVED (the percentage is a ratio of two other numbers), so a transcription slip
 * sends the investigation after a value the app never produced — and the mistake is
 * invisible, because the wrong number still looks plausible.
 *
 * So this emits the card's own INPUTS, not a description of them. `scoreId` matters
 * most: it is the persisted Score row UUID (`score.id` from /api/scoring/runs) and
 * the ONLY handle that re-fetches this exact row — `GET /api/scoring/breakdown/:symbol
 * ?protocol=…&runId=<scoreId>`. Ages and percentages cannot be looked up; an id can.
 *
 * Deliberately `key: value` lines, not prose: an agent can grep a single line, and the
 * same string stays readable when a human pastes it into a message.
 *
 * ⚠️ An absent value prints `—`, never blank. A blank after `scoreId:` reads as a broken
 * copy; an explicit dash reads as "this card has none" (unscored), which is the
 * difference between a bug report and a correct absence.
 *
 * @param {object} e             the card entry
 * @param {string} [opts.label]  first line, e.g. 'TCS ladder card' — lets the cockpit
 *                               name itself so a pasted reference says WHERE it came from
 */
export function buildCardRef(e, opts = {}) {
  const label = opts.label || 'TCS score card';
  const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);
  const ratio = (v, max) => (v == null ? '—' : `${v}${max ? ` / ${max}` : ''}`);
  const pct = (p) => (p == null ? '—' : `${p}%`);

  const lines = [
    label,
    `scoreId:        ${dash(e.scoreId)}`,
    `symbol:         ${e.symbol}`,
    `protocol:       ${e.protocolName}`,
    `protocolId:     ${e.protocolId}`,
    `runProtocolId:  ${dash(e.runId)}`,
    `scoredAt:       ${dash(e.time)}`,
    `state:          ${stateLabel(e.vm)}`,
    `signal:         ${dash(e.hasScore ? e.vm.signal : null)}`,
    `signalScore:    ${ratio(e.vm.score, e.vm.scoreMax)} (${pct(e.vm.pct)})`,
    `oppScore:       ${ratio(e.vm.opportunityScore, e.vm.opportunityMax)} (${pct(e.vm.opportunityPct)})`,
    `source:         ${typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/'}`,
  ];

  // Only present on the cards that have them, so a normal card's block stays short.
  if (e.scoreFrom) lines.push(`borrowedFrom:   ${e.scoreFrom}`);
  if (e.adaptiveTargetActive) {
    lines.push(`adaptiveTarget: ${dash(e.adaptiveTargetMax)} (observed peak, NOT configured capacity)`);
  }

  return lines.join('\n');
}

/** Numeric helpers for the facts strip (#667/#668). */
export function fmtVal(v, d = 2) { return v == null ? '—' : Number(v).toFixed(d); }
export function fmtSigned(v) {
  if (v == null) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}
