/**
 * threshold-ceiling.test.js — pins the above-ceiling rule (#840).
 *
 * Run: `npm run test:threshold-ceiling` (or `node --test src/core/threshold-ceiling.test.js`).
 *
 * The measured values below are REAL — the same ones the live endpoint returned on 2026-09-16 — so
 * a regression here means the create form would start warning (or stop warning) on data that
 * actually exists, not on a fixture invented to make the test pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { barAboveCeiling, ceilingKnown, MIN_CEILING_SAMPLES } from './threshold-ceiling.js';

// Live values from GET /api/scoring/gated/thresholds on 2026-09-16.
const FOREX = { ceilingPct: 15.2, samples: 1359 };   // forex-session-v1 — well measured
const BTC = { ceilingPct: 11.2, samples: 7 };        // btc-scalp-v1 — 7 readings, below the floor

test('a bar above the ceiling is reported, naming both numbers', () => {
  const r = barAboveCeiling(FOREX, 65);
  assert.deepEqual(r, { bar: 65, ceiling: 15.2, samples: 1359 });
});

test('the boundary is EXCLUSIVE — equal to the ceiling is not above it', () => {
  // 15 <= 15.2, so no warning. Verified live in the browser at 15 (no warn) and 16 (warn).
  assert.equal(barAboveCeiling(FOREX, 15), null);
  assert.equal(barAboveCeiling(FOREX, 15.2), null);
  assert.notEqual(barAboveCeiling(FOREX, 16), null);
});

test('a bar below the ceiling is not reported', () => {
  assert.equal(barAboveCeiling(FOREX, 10), null);
  assert.equal(barAboveCeiling(FOREX, 0), null);
});

test('⚠️ the samples floor suppresses the warning on a barely-measured protocol', () => {
  // btc-scalp-v1: 11.2% from only 7 readings. 65 is far above it, but 7 readings is not evidence,
  // so the form stays quiet. Without this the warning fires on every new protocol.
  assert.equal(barAboveCeiling(BTC, 65), null);
  assert.equal(ceilingKnown(BTC), false);
  assert.equal(MIN_CEILING_SAMPLES, 10);
});

test('exactly at the samples floor the ceiling IS trusted', () => {
  const atFloor = { ceilingPct: 12, samples: MIN_CEILING_SAMPLES };
  assert.equal(ceilingKnown(atFloor), true);
  assert.notEqual(barAboveCeiling(atFloor, 13), null);
});

test('an empty field is NOT a zero bar', () => {
  // `Number('')` is 0. Treating that as a real value would let the form claim the bar is checked
  // when the user has cleared it — a control that lies about its own state.
  assert.equal(barAboveCeiling(FOREX, ''), null);
  assert.equal(barAboveCeiling(FOREX, null), null);
  assert.equal(barAboveCeiling(FOREX, undefined), null);
  assert.equal(barAboveCeiling(FOREX, 'abc'), null);
});

test('a string bar is accepted, because form inputs give strings', () => {
  assert.ok(barAboveCeiling(FOREX, '65'));
  assert.equal(barAboveCeiling(FOREX, '10'), null);
});

test('a missing or malformed ceiling yields no warning rather than a false one', () => {
  assert.equal(barAboveCeiling(null, 65), null);
  assert.equal(barAboveCeiling(undefined, 65), null);
  assert.equal(barAboveCeiling({ ceilingPct: null, samples: 100 }, 65), null);
  assert.equal(barAboveCeiling({ ceilingPct: 'nonsense', samples: 100 }, 65), null);
  assert.equal(barAboveCeiling({ ceilingPct: 10, samples: 0 }, 65), null);
});

test('⚠️ "no warning" and "cannot judge" are DISTINGUISHABLE', () => {
  // Both return null from barAboveCeiling, but they must render differently: an unmeasured
  // protocol whose bar looks fine must NOT present as a healthy one.
  const unmeasured = { ceilingPct: 11.2, samples: 7 };
  const fine = { ceilingPct: 30, samples: 500 };
  assert.equal(barAboveCeiling(unmeasured, 10), null);
  assert.equal(barAboveCeiling(fine, 10), null);
  // ...and these differ, which is the point.
  assert.equal(ceilingKnown(unmeasured), false);
  assert.equal(ceilingKnown(fine), true);
});

test('the #839 case — the old 65 default against every real ceiling warns', () => {
  // The whole reason #840 exists: 65 is above EVERY protocol's measured maximum. Live ceilings
  // ranged 11.2-31%, so a 65 default is unclearable on all of them.
  const live = [
    { ceilingPct: 15.2, samples: 1358 },  // forex-session-v1
    { ceilingPct: 14.2, samples: 101 },   // ftse-speed-v1
    { ceilingPct: 31.0, samples: 14 },    // earnings-momentum-v1 — the highest measured
    { ceilingPct: 24.2, samples: 129 },   // gold-macro-v1
  ];
  for (const c of live) {
    assert.notEqual(barAboveCeiling(c, 65), null, `65 should warn against a ${c.ceilingPct}% ceiling`);
  }
});
