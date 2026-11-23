/**
 * best-record.test.js — the states of the best-record view (#1341).
 *
 * The load-bearing cases are the ones that would otherwise render a MISSING fact as a real one:
 * a server that sends no `best` must claim nothing; a store with nothing in it IS "first run"; and a
 * setting that cannot be read on one side is `unknown`, never `same`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBestView, settingsDiff, moneySigned } from './best-record.js';

const run = (over = {}) => ({
  totals: { netPnl: 500, daysRanked: 1, trades: 18, wins: 13, winRate: 72.2 },
  tradeConfig: { fields: [{ id: 'slPct', value: 20 }, { id: 'tpPct', value: 100 }] },
  best: {
    best: {
      perDay: 500,
      netPnl: 500,
      days: 1,
      trades: 18,
      winRate: 72.2,
      profitFactor: 3.2,
      config: [{ id: 'slPct', value: 20 }, { id: 'tpPct', value: 90 }],
      achievedAt: '2026-11-23T21:10:04.748Z',
      attempts: 1,
      runId: 'r1',
    },
    improved: false,
    previous: null,
    because: 'first record',
  },
  ...over,
});

test('a server that sends no `best` claims nothing', () => {
  assert.equal(buildBestView([{ totals: {} }]).state, 'unsupported');
});

test('no runs at all is null, not a first-run claim', () => {
  assert.equal(buildBestView([]), null);
  assert.equal(buildBestView(undefined), null);
});

test('an empty store is a first run and says why', () => {
  const view = buildBestView([run({
    best: { best: null, improved: false, previous: null, because: 'not recorded — 0 day(s)' },
  })]);
  assert.equal(view.state, 'first-run');
  assert.equal(view.best, null);
  assert.match(view.because, /not recorded/);
});

test('a standing record is reported with the run that did not beat it', () => {
  const view = buildBestView([run()]);
  assert.equal(view.state, 'has-record');
  assert.equal(view.best.perDay, 500);
  assert.equal(view.thisRun.perDay, 500);
});

test('a new record lists only the settings that differ from the ones in force', () => {
  const view = buildBestView([run({
    best: {
      ...run().best,
      improved: true,
      previous: { perDay: 400, netPnl: 400, days: 1, achievedAt: '2026-11-20T10:00:00Z' },
    },
  })]);
  assert.equal(view.state, 'new-record');
  const changed = view.settingsDiff.filter((s) => s.state === 'differs');
  assert.deepEqual(changed.map((s) => s.id), ['tpPct']);
  assert.equal(changed[0].best, '90');
  assert.equal(changed[0].now, '100');
});

test('the record is read from the LAST run, not summed across days', () => {
  const last = run({ totals: { netPnl: 250, daysRanked: 1, trades: 4, wins: 1, winRate: 25 } });
  const view = buildBestView([run(), last]);
  assert.equal(view.thisRun.netPnl, 250);
  assert.equal(view.thisRun.trades, 4);
});

test('settingsDiff: absent on either side is unknown, never same', () => {
  const diff = settingsDiff([{ id: 'a', value: 1 }, { id: 'b', value: 2 }], [{ id: 'a', value: 1 }]);
  assert.equal(diff.find((d) => d.id === 'a').state, 'same');
  assert.equal(diff.find((d) => d.id === 'b').state, 'unknown');
});

test('settingsDiff: null on both sides is unknown, not a match', () => {
  assert.equal(settingsDiff([{ id: 'a', value: null }], [{ id: 'a', value: null }])[0].state, 'unknown');
});

test('settingsDiff survives a config that is not an array', () => {
  assert.deepEqual(settingsDiff(null, []), []);
  assert.deepEqual(settingsDiff('nonsense', []), []);
});

test('moneySigned keeps the sign visible and never prints a bare hyphen for a loss', () => {
  assert.equal(moneySigned(12.34), '+$12.34');
  assert.equal(moneySigned(-12.34), '\u2212$12.34');
  assert.equal(moneySigned(0), '$0.00');
  assert.equal(moneySigned(null), '—');
});
