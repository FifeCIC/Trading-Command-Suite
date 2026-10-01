/**
 * tradeability.test.js — the #911 reconciliation rule, asserted rather than eyeballed.
 *
 * ⚠️ WHY A TEST FILE AND NOT A COMMENT. The bug this fixes is two correct numbers disagreeing on
 * one screen. That is a RULE ("is the bar met?"), and a rule kept inside JSX can only be checked by
 * looking at a card — which is exactly how the disagreement survived. `node --test` runs this in
 * `prebuild`, so the boundary cases below cannot drift.
 *
 * The boundary is the interesting part: `signalPct >= barPct` is INCLUSIVE, matching the API's own
 * reading of `minComposite` (a bot acts AT its bar, not above it). Asserted explicitly below so
 * nobody has to infer it from an operator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botTradeability, sameProtocolFamily } from './tradeability.js';

/** A bot row in the shape `GET /api/scoring/gated/thresholds` returns. */
const bot = (over) => ({
  name: 'B',
  protocolId: 'btc-scalp-v1',
  symbol: 'BTCUSD',
  active: true,
  barPct: 10,
  achievedPct: 20,
  samples: 100,
  clears: 'yes',
  ...over,
});

test('#911 — no reading means CANNOT JUDGE, not "refused"', () => {
  const r = botTradeability(null, [bot({ barPct: 10 })], 'btc-scalp-v1');
  assert.equal(r.state, 'unknown');
  assert.equal(r.shortfall, null);
  // The subscriber list is still reported — "we cannot judge" is not "we know nothing".
  assert.equal(r.subscribed.length, 1);
});

test('#911 — undefined signalPct behaves like null', () => {
  assert.equal(botTradeability(undefined, [bot()], 'btc-scalp-v1').state, 'unknown');
});

test('#911 — a BUY that nothing listens to is a FINDING, not silence', () => {
  const r = botTradeability(8, [], 'btc-scalp-v1');
  assert.equal(r.state, 'unsubscribed');
  assert.match(r.reason, /No ACTIVE bot subscribes/);
});

test('#911 — a bot on a DIFFERENT protocol is not a subscriber', () => {
  const r = botTradeability(8, [bot({ protocolId: 'xau-speed-v1' })], 'btc-scalp-v1');
  assert.equal(r.state, 'unsubscribed');
});

test('#911 — an INACTIVE bot is not a subscriber (it cannot trade)', () => {
  const r = botTradeability(8, [bot({ active: false })], 'btc-scalp-v1');
  assert.equal(r.state, 'unsubscribed');
});

test('#911 — the reported case: 8% reading against a 10% bar is REFUSED with a shortfall', () => {
  const r = botTradeability(8, [bot({ barPct: 10 })], 'btc-scalp-v1');
  assert.equal(r.state, 'refused');
  assert.equal(r.shortfall, 2);
  assert.equal(r.blocked, 1);
  assert.match(r.reason, /shortfall of 2 points/);
});

test('#911 — clearing ONE bot is enough to be actionable, even if others refuse', () => {
  const r = botTradeability(9, [bot({ barPct: 8 }), bot({ barPct: 10 }), bot({ barPct: 12 })], 'btc-scalp-v1');
  assert.equal(r.state, 'clear');
  assert.equal(r.clearing, 1);
  assert.equal(r.blocked, 2);
});

test('#911 — BOUNDARY: a reading exactly equal to the bar CLEARS (inclusive)', () => {
  assert.equal(botTradeability(10, [bot({ barPct: 10 })], 'btc-scalp-v1').state, 'clear');
  // …and one hundredth under it does not.
  assert.equal(botTradeability(9.99, [bot({ barPct: 10 })], 'btc-scalp-v1').state, 'refused');
});

test('#911 — the shortfall is measured against the LOWEST bar, the one worth naming', () => {
  const r = botTradeability(6, [bot({ barPct: 13 }), bot({ barPct: 9 }), bot({ barPct: 11 })], 'btc-scalp-v1');
  assert.equal(r.bestBarPct, 9);
  assert.equal(r.shortfall, 3);
});

test('#911 — a bot with no declared bar is neither clearing nor blocking', () => {
  const r = botTradeability(8, [bot({ barPct: null })], 'btc-scalp-v1');
  assert.equal(r.subscribed.length, 1);
  assert.equal(r.subscribed[0].clears, null);
  assert.equal(r.state, 'refused'); // none cleared
});

test('family matching: the -v1 card matches the timeframe-variant bot', () => {
  assert.equal(sameProtocolFamily('xau-speed-v1', 'xau-speed-m5'), true);
  assert.equal(sameProtocolFamily('xau-speed-m5', 'xau-speed-v1'), true);
  assert.equal(sameProtocolFamily('xau-speed-v1', 'xau-speed-v1'), true);
});

test('family matching does NOT join unrelated protocols', () => {
  assert.equal(sameProtocolFamily('xau-speed-v1', 'btc-scalp-v1'), false);
  assert.equal(sameProtocolFamily('spy-speed-v1', 'spy-day-v1'), false);
  assert.equal(sameProtocolFamily('', 'btc-scalp-v1'), false);
  assert.equal(sameProtocolFamily(null, null), false);
});

test('the subscription list is ordered by bar, lowest first', () => {
  const r = botTradeability(5, [bot({ name: 'hi', barPct: 12 }), bot({ name: 'lo', barPct: 8 })], 'btc-scalp-v1');
  assert.deepEqual(r.subscribed.map((b) => b.name), ['lo', 'hi']);
});
