/**
 * movers-funnel.test.js — the counts a reader will quote (#1344).
 *
 * The funnel counts the engine's own per-bar verdicts, so its only real failure modes are arithmetic and
 * vocabulary: a bucket that silently matches nothing, or an entry count that counts a same-bar
 * open-and-close twice. Both produce plausible numbers with no error, which is why they are pinned here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  funnelFor,
  funnelTotals,
  sharePct,
  speedOf,
  protocolDirectiveIds,
  funnelShape,
  BAR_STATES,
} from './movers-funnel.js';

const bar = (state, directives = undefined) => ({ state, ...(directives ? { directives } : {}) });
const detail = (bars, trades = []) => ({ bars, trades });

test('each bucket counts its own state and nothing else', () => {
  const row = funnelFor('ELOG', detail([
    bar('no-data'), bar('quiet'), bar('bar-gate'), bar('bar-gate'),
    bar('signal-not-traded'), bar('entry'),
  ]));
  assert.equal(row.scored, 6);
  assert.equal(row.noData, 1);
  assert.equal(row.quiet, 1);
  assert.equal(row.barGate, 2);
  assert.equal(row.signalNotTraded, 1);
  assert.equal(row.entered, 1);
});

test('a same-bar entry AND exit counts as ONE traded bar, not two', () => {
  assert.equal(funnelFor('ELOG', detail([bar('entry+exit')])).entered, 1);
});

test('an unknown state is counted into NO bucket, so the parts never exceed the whole', () => {
  const row = funnelFor('ELOG', detail([bar('entry'), bar('something-new')]));
  assert.equal(row.scored, 2);
  const parts = row.noData + row.quiet + row.barGate + row.signalNotTraded + row.entered;
  assert.equal(parts, 1);
});

test('every state the engine emits has a bucket, so a new state cannot hide', () => {
  // A state in BAR_STATES that no bucket counts would be a bar that vanishes from the table.
  const counted = new Set(['no-data', 'quiet', 'bar-gate', 'signal-not-traded', 'entry', 'entry+exit']);
  for (const s of BAR_STATES) assert.equal(counted.has(s), true, `${s} has no bucket`);
});

test('the speed rating comes from the speed directive own score, never a re-derivation', () => {
  const row = funnelFor('ELOG', detail([
    bar('quiet', [{ directiveId: 'speed-momentum', score: 40, maxScore: 120 }]),
    bar('entry', [{ directiveId: 'speed-momentum', score: 100, maxScore: 120 }]),
  ]));
  assert.equal(row.speed.present, true);
  assert.equal(row.speed.mean, 70);
  assert.equal(row.speed.peak, 100);
  assert.equal(row.speed.maxScore, 120);
  assert.equal(row.speed.bars, 2);
});

test('a run with no breakdown reports speed as ABSENT, not as zero', () => {
  const speed = speedOf([bar('quiet'), bar('entry')]);
  assert.equal(speed.present, false);
  assert.equal(speed.mean, null);
  assert.equal(speed.peak, null);
});

test('an empty detail is zeros, and totals over nothing stay at zero rather than NaN', () => {
  const row = funnelFor('ELOG', null);
  assert.equal(row.scored, 0);
  assert.deepEqual(funnelTotals([row]), {
    scored: 0, noData: 0, quiet: 0, barGate: 0, signalNotTraded: 0, entered: 0, trades: 0,
  });
});

test('totals sum the symbols, so the table foot agrees with its own rows', () => {
  const a = funnelFor('A', detail([bar('entry'), bar('bar-gate')]));
  const b = funnelFor('B', detail([bar('quiet'), bar('entry'), bar('entry')]));
  const t = funnelTotals([a, b]);
  assert.equal(t.scored, a.scored + b.scored);
  assert.equal(t.entered, a.entered + b.entered);
  assert.equal(t.barGate, 1);
  assert.equal(t.quiet, 1);
});

test('sharePct refuses a zero denominator instead of printing 0% or NaN%', () => {
  assert.equal(sharePct(1, 4), '25.0%');
  assert.equal(sharePct(0, 0), '—');
  assert.equal(sharePct(3, 0), '—');
  assert.equal(sharePct(undefined, 4), '—');
});

test('protocolDirectiveIds reads membership from the bars, and is empty when there is no breakdown', () => {
  const withBars = protocolDirectiveIds([
    { detail: { bars: [bar('quiet', [{ directiveId: 'speed-momentum' }, { directiveId: 'vwap' }])] } },
    { detail: { bars: [bar('entry', [{ directiveId: 'vwap' }])] } },
  ]);
  assert.deepEqual([...withBars].sort(), ['speed-momentum', 'vwap']);
  assert.equal(protocolDirectiveIds([{ detail: { bars: [bar('quiet')] } }]).size, 0);
  assert.equal(protocolDirectiveIds(undefined).size, 0);
});

/**
 * ── funnelShape (audit note 'i', 2026-11-26) ────────────────────────────────────────────────────
 * The owner asked for a bar that shows WHERE the population is lost, not just how much. The scale is
 * the whole claim: scaled to `scored`, an engine state this module does not know leaves a VISIBLE gap;
 * scaled to the buckets' own sum, the bar always fills and that difference disappears.
 */
test('▶ CANARY — the bar is scaled to `scored`, so an unknown state leaves a VISIBLE gap', () => {
  const row = funnelFor('AAA', detail([
    bar('entry'), bar('entry+exit'), bar('quiet'), bar('mystery-state'),
  ]));
  const { segments, unaccounted } = funnelShape(row);
  const entered = segments.find((s) => s.key === 'entered');
  assert.equal(row.scored, 4);
  assert.equal(entered.count, 2);
  // 2 of 4 bars traded → half the bar, NOT 2 of 3 (which would be a full-looking 66.7%).
  assert.equal(entered.pct, 50);
  assert.equal(unaccounted, 1);
  // The segments never add past the whole.
  assert.ok(segments.reduce((a, s) => a + s.pct, 0) <= 100);
});

test('a fully-explained row accounts for every bar and leaves no gap', () => {
  const row = funnelFor('BBB', detail([bar('entry'), bar('quiet'), bar('no-data'), bar('bar-gate')]));
  const { segments, unaccounted } = funnelShape(row);
  assert.equal(unaccounted, 0);
  assert.equal(Math.round(segments.reduce((a, s) => a + s.pct, 0)), 100);
});

test('segments run most-survived first, so the bar reads in pipeline order', () => {
  const row = funnelFor('CCC', detail([bar('entry'), bar('bar-gate'), bar('quiet')]));
  assert.deepEqual(funnelShape(row).segments.map((s) => s.key), [
    'entered', 'signalNotTraded', 'barGate', 'quiet', 'noData',
  ]);
});

test('no bars means no bar — an empty shape, never a division by zero', () => {
  const { segments, unaccounted } = funnelShape(funnelFor('DDD', detail([])));
  assert.deepEqual(segments, []);
  assert.equal(unaccounted, 0);
  assert.deepEqual(funnelShape(null).segments, []);
});