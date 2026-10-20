/**
 * score-display.test.js — the four tradeability states, run without a browser (#774).
 * ===================================================================================
 * Run with: `node --test src/core/score-display.test.js` (and in `prebuild`).
 *
 * ⚠️ THE DEFECT THESE TESTS PIN (measured 2026-09-10 on /scoring/live-ordering-stack):
 * `spy-day-v1` / `qqq-day-v1` cards read MARKET CLOSED while `xau-speed-*` read STALE — all with
 * `open:false`. The label came from DATA FRESHNESS folded into the market question, so:
 *   1. a closed market could render as `STALE` — making a genuine feed failure (open + behind)
 *      look like a quiet Sunday;
 *   2. the same card flipped between two words as `asOf` crossed a boundary;
 *   3. the client re-derived freshness from its own 30-minute constant — a second owner for a
 *      number the server already decides.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoreDisplay, SCORE_STATES } from './score-display.js';
import { stateLabel, stateTitle } from './score-card-view.js';

/** A scored row with a given marketStatus. */
const row = (marketStatus) => ({ signal: 'BUY', rawComposite: 10, rawMax: 100, marketStatus });
const vm = (marketStatus) => buildScoreDisplay(row(marketStatus));

test('closed market is PAUSED even when the data is old — never STALE (#774)', () => {
  // The exact combination that used to collapse: closed + stale flag → STALE.
  assert.equal(vm({ open: false, stale: true, reason: 'calendar closed' }).state, SCORE_STATES.PAUSED);
  assert.equal(vm({ open: false, stale: false }).state, SCORE_STATES.PAUSED);
  // And a closed market never asks for attention.
  assert.equal(vm({ open: false, stale: true }).needsAttention, false);
});

test('open + behind is STALE, and it is the ONE state that asks for attention', () => {
  const stale = vm({ open: true, stale: true });
  assert.equal(stale.state, SCORE_STATES.STALE);
  assert.equal(stale.needsAttention, true);
  const live = vm({ open: true, stale: false });
  assert.equal(live.state, SCORE_STATES.LIVE);
  assert.equal(live.needsAttention, false);
});

test('freshness is the SERVER’s flag — an old asOf alone must not produce STALE', () => {
  // The retired client check: Date.now() - asOf > 30min → STALE. asOf is deliberately years old;
  // the server says the feed is fine, so the label must follow the server.
  const out = vm({ open: true, stale: false, asOf: '2020-01-01T00:00:00Z' });
  assert.equal(out.state, SCORE_STATES.LIVE);
});

test('an absent stale flag is not a claim of staleness', () => {
  assert.equal(vm({ open: true }).state, SCORE_STATES.LIVE);
});

test('the four states are mutually exclusive, and the labels never collide', () => {
  const states = [
    vm({ open: true, stale: false }).state,
    vm({ open: true, stale: true }).state,
    vm({ open: false }).state,
    buildScoreDisplay({}).state,
  ];
  assert.deepEqual(states, ['live', 'stale', 'paused', 'unscored']);
  assert.equal(new Set(states).size, 4);

  // The WORD a user reads must be unique per state too — this is what the issue is about.
  const labels = [
    stateLabel({ state: 'live', frozen: false }),
    stateLabel({ state: 'stale', frozen: true }),
    stateLabel({ state: 'paused', frozen: true }),
    stateLabel({ state: 'unscored' }),
  ];
  assert.deepEqual(labels, ['Live', 'Data stale', 'Market closed', 'Not scored']);
  assert.equal(new Set(labels).size, 4);
});

test('legacy rows with no marketStatus stay Live — unchanged behaviour', () => {
  assert.equal(buildScoreDisplay({ signal: 'BUY', rawComposite: 5, rawMax: 100 }).state, SCORE_STATES.LIVE);
});

test('the tooltip surfaces the SERVER’s reason, and names the alarming state plainly', () => {
  const closed = vm({ open: false, reason: 'weekend' });
  assert.match(closed.frozenTitle, /Market closed \(weekend\)/);
  const stale = vm({ open: true, stale: true, reason: 'cadence indeterminate' });
  assert.match(stale.frozenTitle, /Market OPEN but data stale \(cadence indeterminate\)/);
});

// ── EXPIRED — the third axis: is this row still being REPLACED? ──────────────────────────────
//
// ⚠️ THE DEFECT THESE PIN (measured 2026-10-19 on /scoring/live-ordering-stack):
// EURUSD / `probe-1dir-v1` held a `STRONG_BUY` 60/100 dated 16 Oct and rendered **Live** for two
// days while ranked ABOVE every live score. The protocol was being run every 2 minutes on fresh
// bars; its single directive returned 29/100 and classified itself `neutral`, and a neutral tick
// writes no row. So the newest row stayed 2 days old, still carrying the
// `marketStatus: { open: true, stale: false }` stamped into it at the time — which is all the
// state model looked at. Age was not an input, so `frozen` was `false` and the ladder's
// "a frozen scan must never outrank a live signal" rule never fired.

const aged = (marketStatus, ageMinutes, maxAgeMinutes = 180) =>
  buildScoreDisplay(
    { signal: 'STRONG_BUY', rawComposite: 60, rawMax: 100, marketStatus },
    { ageMinutes, maxAgeMinutes },
  );

test('a row that stopped being replaced is EXPIRED, never Live — the 2-day-old card', () => {
  const out = aged({ open: true, stale: false }, 4_146);
  assert.equal(out.state, SCORE_STATES.EXPIRED);
  // frozen is the load-bearing part: the Ladder sorter demotes frozen cards, so this alone
  // takes the dead row out of the top rank without any new ranking rule.
  assert.equal(out.frozen, true);
  assert.equal(out.needsAttention, true);
  assert.equal(stateLabel(out), 'No new score');
  assert.match(out.frozenTitle, /NO NEW SCORE for 4146 min/);
});

test('a CLOSED market stays PAUSED even when the row is old — weekend is not an incident', () => {
  // The opposite direction of the rule above, and the one that would have produced noise: FX is
  // shut from Friday close to Monday open, so EVERY FX card is hours old over the weekend. Age
  // must not upgrade those to EXPIRED — same reasoning that keeps data age out of STALE.
  assert.equal(aged({ open: false }, 10_000).state, SCORE_STATES.PAUSED);
  assert.equal(aged({ open: false }, 10_000).needsAttention, false);
});

test('CANARY — identical age, only the market flag decides PAUSED vs EXPIRED', () => {
  // Proves the pair above is separated by `open` alone. Both calls pass the SAME age.
  assert.equal(aged({ open: false }, 4_146).state, SCORE_STATES.PAUSED);
  assert.equal(aged({ open: true, stale: false }, 4_146).state, SCORE_STATES.EXPIRED);
});

test('a fresh row is untouched by the age rule — no false expiry', () => {
  const out = aged({ open: true, stale: false }, 2);
  assert.equal(out.state, SCORE_STATES.LIVE);
  assert.equal(out.frozen, false);
});

test('CANARY — the SAME row flips Live ⇄ EXPIRED on the age input alone', () => {
  // Proves the test above is driven by age and not by marketStatus. Both calls pass the SAME row.
  const ms = { open: true, stale: false };
  assert.equal(aged(ms, 179).state, SCORE_STATES.LIVE);
  assert.equal(aged(ms, 181).state, SCORE_STATES.EXPIRED);
});

test('no age supplied means NO AGE RULE — legacy callers are unchanged', () => {
  assert.equal(buildScoreDisplay(row({ open: true, stale: false })).state, SCORE_STATES.LIVE);
  // A missing age must be `null`, not 0 — 0 would silently mean "brand new".
  assert.equal(buildScoreDisplay(row({ open: true })).ageMinutes, null);
});

// ── REFUSED EVIDENCE — a zero that excludes a real measurement must say so ───────────────────
//
// ⚠️ MEASURED, XAUUSD / `xau-speed-m15`, 2026-10-19 22:41Z, directionMode LONG_ONLY:
//   eleven directives ran · `gold-round-numbers` 15/25 bearish · `support-resistance-levels` 8/95
//   bearish · nine neutral · persisted as `signal NO_READING, rawComposite 0, rawMax 910`
// A live re-score reported the refused split as `bearishRaw 80, bearishMax 240` (33%).
// The card showed `SIGNAL 0` with nothing to distinguish it from "nothing was measured".

const xau = (over = {}) => buildScoreDisplay({
  signal: 'NO_READING',
  rawComposite: 0,
  rawMax: 910,
  marketStatus: { open: true, stale: false },
  directionMode: 'LONG_ONLY',
  directionalEvidence: { bullishRaw: 0, bullishMax: 0, bearishRaw: 80, bearishMax: 240, selected: 'none' },
  ...over,
});

test('a zero with refused bearish evidence names the evidence and the mode', () => {
  const out = xau();
  assert.match(out.refusedNote, /bearish evidence 80\/240 \(33%\)/);
  assert.match(out.refusedNote, /LONG_ONLY/);
  // It must be reachable from the tooltip, which is the only surface the card offers.
  assert.match(stateTitle(out), /Live — Measured bearish/);
});

test('direction is respected — bearish evidence is NOT "refused" when it was selected', () => {
  const out = xau({
    signal: 'SELL',
    rawComposite: 80,
    directionalEvidence: { bullishRaw: 0, bullishMax: 0, bearishRaw: 80, bearishMax: 240, selected: 'bearish' },
  });
  assert.equal(out.refusedNote, null);
});

test('a non-zero score never claims refused evidence — the note is for zeros only', () => {
  assert.equal(xau({ rawComposite: 300 }).refusedNote, null);
});

test('no directionalEvidence means no note — absent is not zero', () => {
  assert.equal(xau({ directionalEvidence: null }).refusedNote, null);
});
