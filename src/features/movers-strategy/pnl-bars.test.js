import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPnlBars } from './pnl-bars.js';

/**
 * ONE rule, two tables (day and symbol). Every case below renders a chart that LOOKS correct when it
 * is wrong, which is why the rule is asserted rather than left to the reader.
 */

const day = (id, netPnl, notice) => ({ id, netPnl, ...(notice ? { notice } : {}) });
const sym = (symbol, netPnl, errors = 0) => ({ symbol, netPnl, errors });

test('▶ CANARY — bars are scaled to the LARGEST row, not to the total', () => {
  // Three equal days: the honest picture is three full-width bars. Scaling to the total (300) would
  // draw three one-third bars and look like an evenly spread result.
  const { fracById, maxAbs } = buildPnlBars([day('a', 100), day('b', 100), day('c', 100)]);
  assert.equal(maxAbs, 100);
  assert.deepEqual(fracById, { a: 1, b: 1, c: 1 });
});

test('one row carrying the total shows as one full bar beside small ones', () => {
  const { fracById } = buildPnlBars([day('big', 900), day('x', 50), day('y', 50)]);
  assert.equal(fracById.big, 1);
  assert.ok(fracById.x < 0.1);
});

test('the SIGN does not shorten the bar — magnitude is what is drawn', () => {
  const { fracById } = buildPnlBars([day('win', 200), day('loss', -100)]);
  assert.equal(fracById.win, 1);
  assert.equal(fracById.loss, 0.5);
});

test('an all-flat book is 0%, not NaN and not a missing bar', () => {
  const { fracById, maxAbs } = buildPnlBars([day('a', 0), day('b', 0)]);
  assert.equal(maxAbs, 0);
  assert.deepEqual(fracById, { a: 0, b: 0 });
});

test('a failed day and an unreadable P/L are ABSENT, never a zero-length bar', () => {
  // ⚠️ `Number(null) === 0` and `Number("") === 0` — the first run of this module failed here.
  const { fracById } = buildPnlBars([
    day('ok', 100),
    day('failed', 500, { title: 'refused' }),
    day('blank', null),
    day('empty', ''),
    day('junk', 'n/a'),
  ]);
  assert.deepEqual(Object.keys(fracById), ['ok']);
});

test('the SYMBOL table uses the same rule with its own accessors', () => {
  const rows = [sym('AAA', 300), sym('BBB', -150), sym('CCC', 0)];
  const { fracById } = buildPnlBars(rows, {
    getId: (r) => r.symbol,
    skip: (r) => r.errors > 0,
  });
  assert.deepEqual(fracById, { AAA: 1, BBB: 0.5, CCC: 0 });
});

test('a symbol that COULD NOT RUN has no bar — it is not a break-even row', () => {
  const rows = [sym('OK', 100), sym('BROKE', 0, 1)];
  const { fracById } = buildPnlBars(rows, { getId: (r) => r.symbol, skip: (r) => r.errors > 0 });
  assert.deepEqual(Object.keys(fracById), ['OK']);
});

test('garbage in, empty map out — no throw', () => {
  assert.deepEqual(buildPnlBars(null).fracById, {});
  assert.deepEqual(buildPnlBars([null, undefined]).fracById, {});
});

