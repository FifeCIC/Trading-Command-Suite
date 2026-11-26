import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPriceReference, priceDistance, formatDistance } from './price-reference.js';

const t = (symbol, entryPrice) => ({ symbol, entryPrice });

test('the reference is ONE symbol\'s median entry — never a blend across instruments', () => {
  // 3 EURUSD at ~1.05 and 1 BTC at 60,000. A median over all four would be ~1.05 anyway, so the
  // canary uses counts that force the comparison: the blended median of these four is (1.05+60000)/2.
  const ref = buildPriceReference([t('EURUSD', 1.05), t('BTC', 60000), t('BTC', 61000), t('EURUSD', 1.06)]);
  assert.equal(ref.symbol, 'BTC');
  assert.equal(ref.price, 60500, 'median of BTC\'s own two entries, not a figure spanning both symbols');
  assert.equal(ref.symbols, 2, 'the count of symbols it does NOT describe is carried');
});

test('the most-traded symbol wins, so the reference describes the bulk of the run', () => {
  const ref = buildPriceReference([t('BTC', 60000), t('EURUSD', 1.05), t('EURUSD', 1.07), t('EURUSD', 1.09)]);
  assert.equal(ref.symbol, 'EURUSD');
  assert.equal(ref.price, 1.07);
  assert.equal(ref.count, 3);
});

test('a tie on count breaks alphabetically, so the figure does not move between renders', () => {
  const ref = buildPriceReference([t('SPY', 500), t('AAPL', 200)]);
  assert.equal(ref.symbol, 'AAPL');
  assert.equal(ref.price, 200);
});

test('a missing, zero or negative entry price is IGNORED — never read as a price of zero', () => {
  const ref = buildPriceReference([t('SPY', null), t('SPY', 0), t('SPY', -4), t('SPY', 500), t('SPY', 502)]);
  assert.equal(ref.count, 2);
  assert.equal(ref.price, 501);
});

test('no readable price anywhere is NULL, not a price of zero', () => {
  assert.equal(buildPriceReference([]), null);
  assert.equal(buildPriceReference(null), null);
  assert.equal(buildPriceReference([t('SPY', null)]), null);
});

test('trades with no symbol are grouped rather than dropped, and say so', () => {
  const ref = buildPriceReference([{ entryPrice: 42 }, { entryPrice: 44 }]);
  assert.equal(ref.symbol, 'unattributed');
  assert.equal(ref.price, 43);
});

test('a trade the SELECTION refused is not part of the population — it would outnumber the run', () => {
  // The measured case: `detail.trades` held 102 rows against a run reporting 89 trades, because the
  // refused rows ride along to draw the timeline. Same prices here, so the median is unchanged: the
  // assertion is on the COUNT, which is the number the reader compares against the run.
  const kept = Array.from({ length: 4 }, (_, i) => ({ symbol: 'ELOG', entryPrice: 1.3 + i * 0.01, kept: true }));
  const refused = Array.from({ length: 3 }, () => ({ symbol: 'ELOG', entryPrice: 1.34, kept: false }));
  const ref = buildPriceReference([...kept, ...refused]);
  assert.equal(ref.count, 4, 'only the permitted trades are counted');
});

test('a payload with NO kept marker is not treated as refusal — an old run keeps its median', () => {
  const ref = buildPriceReference([{ symbol: 'SPY', entryPrice: 500 }, { symbol: 'SPY', entryPrice: 502 }]);
  assert.equal(ref.count, 2);
  assert.equal(ref.price, 501);
});

test('a percentage becomes a distance at the reference price — the note\'s own example', () => {
  assert.equal(priceDistance(5, 1.5), 0.075);
});

test('an unreadable percentage is NULL, and a real zero is ZERO', () => {
  assert.equal(priceDistance(null, 1.5), null);
  assert.equal(priceDistance(undefined, 1.5), null);
  assert.equal(priceDistance(Number.NaN, 1.5), null);
  assert.equal(priceDistance(5, null), null);
  assert.equal(priceDistance(0, 1.5), 0, 'a 0% bracket is a measured zero, not an absence');
});

test('a distance is printed to three significant figures at any price scale', () => {
  assert.equal(formatDistance(0.075), '0.075');
  assert.equal(formatDistance(0.0751), '0.0751');
  assert.equal(formatDistance(3000), '3000');
  assert.equal(formatDistance(0.00525), '0.00525');
  assert.equal(formatDistance(null), '—');
});
