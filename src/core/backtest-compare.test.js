import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareMetric, compareMetrics, verdictClass, noComparisonReason,
  TRADE_METRICS, LOWER_IS_BETTER, HIGHER_IS_BETTER,
} from './backtest-compare.js';

/**
 * backtest-compare.test.js — the border colour that says "the change helped".
 *
 * Every case here is one the panel renders. The ones that matter most are the three ways a comparison
 * can be ABSENT, because the defect this guards against is an uncoloured box reading as "no change"
 * when nothing was compared at all.
 */

test('higher-is-better: an increase is better, a decrease is worse', () => {
  assert.equal(compareMetric(-12, -5, HIGHER_IS_BETTER).verdict, 'better');
  assert.equal(compareMetric(-5, -12, HIGHER_IS_BETTER).verdict, 'worse');
});

test('lower-is-better inverts the verdict', () => {
  assert.equal(compareMetric(40, 24, LOWER_IS_BETTER).verdict, 'better');
  assert.equal(compareMetric(24, 40, LOWER_IS_BETTER).verdict, 'worse');
});

test('the same number is "same", not an improvement', () => {
  assert.equal(compareMetric(22.9, 22.9).verdict, 'same');
});

test('float noise is "same" — relative tolerance, so precision cannot fake a move', () => {
  // The same figure stored at two precisions. An absolute epsilon would pass on one run and fail on
  // the next depending on rounding.
  assert.equal(compareMetric(22.9, 22.9000000001).verdict, 'same');
  assert.equal(compareMetric(0.229, 0.2291).verdict, 'same');
});

test('a real move still shows, at a tenth of a percent of a small number', () => {
  assert.equal(compareMetric(2, 2.5).verdict, 'better');
});

test('null on either side is "unknown" — never "same" and never zero', () => {
  assert.equal(compareMetric(null, 5).verdict, 'unknown');
  assert.equal(compareMetric(5, null).verdict, 'unknown');
  assert.equal(compareMetric(undefined, undefined).verdict, 'unknown');
  assert.equal(compareMetric(Number.NaN, 5).verdict, 'unknown');
});

test('the unknown/same verdicts produce NO css class — an uncoloured box is honest', () => {
  assert.equal(verdictClass('unknown'), '');
  assert.equal(verdictClass('same'), '');
  assert.equal(verdictClass('better'), 'is-better');
  assert.equal(verdictClass('worse'), 'is-worse');
});

test('worst-single-trade drawdown is HIGHER-is-better, because it is a signed P&L', () => {
  // Marking it "lower" because the word sounds bad would invert every arrow: -5% is worse than -2%.
  assert.equal(TRADE_METRICS.count.better, HIGHER_IS_BETTER);
  assert.equal(compareMetric(-5, -2, HIGHER_IS_BETTER).verdict, 'better');
});

test('compareMetrics fills in "unknown" for a metric the payload does not carry', () => {
  const spec = { a: { better: HIGHER_IS_BETTER }, b: { better: HIGHER_IS_BETTER } };
  assert.deepEqual(compareMetrics(spec, { a: 1 }, { a: 2 }), { a: 'better', b: 'unknown' });
});

test('the three reasons a comparison is missing are distinct sentences', () => {
  const first = noComparisonReason({ previousRunId: null });
  const deleted = noComparisonReason({ previousRunId: 'x', previousRunMissing: true });
  const incomparable = noComparisonReason({ previousRunId: 'x', incomparable: 'different window' });
  assert.match(first, /first stored run/);
  assert.match(deleted, /no longer exists/);
  assert.match(incomparable, /different window/);
  assert.equal(new Set([first, deleted, incomparable]).size, 3);
});

test('no reason is produced when a comparable previous run exists', () => {
  assert.equal(noComparisonReason({ previousRunId: 'abc' }), null);
});
