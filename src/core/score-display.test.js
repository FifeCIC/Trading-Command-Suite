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
import { stateLabel } from './score-card-view.js';

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
