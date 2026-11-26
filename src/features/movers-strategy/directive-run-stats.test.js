import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunDirectiveStats } from './directive-run-stats.js';

const bar = (...ds) => ({ directives: ds.map(([directiveId, score]) => ({ directiveId, score })) });
const entry = (...bars) => ({ detail: { bars } });

test('the mean is over the bars the directive actually SCORED on, not over every bar', () => {
  const s = buildRunDirectiveStats([entry(
    bar(['rsi', 40]),
    bar(['rsi', 60]),
    bar(), // the directive did not score here at all
  )]);
  const rsi = s.directives.find((d) => d.id === 'rsi');
  assert.equal(rsi.bars, 2, 'two bars named it');
  assert.equal(rsi.scored, 2);
  assert.equal(rsi.mean, 50, 'mean of 40 and 60 — the empty bar is absent, not a 0');
});

test('a recorded score of 0 is a SCORE, and is averaged in', () => {
  const s = buildRunDirectiveStats([entry(bar(['x', 0]), bar(['x', 50]))]);
  const x = s.directives.find((d) => d.id === 'x');
  assert.equal(x.scored, 2);
  assert.equal(x.mean, 25);
});

test('a null or NaN score counts the bar but never the mean', () => {
  const s = buildRunDirectiveStats([entry(bar(['x', null]), bar(['x', Number.NaN]), bar(['x', 30]))]);
  const x = s.directives.find((d) => d.id === 'x');
  assert.equal(x.bars, 3);
  assert.equal(x.scored, 1);
  assert.equal(x.mean, 30, 'the unreadable scores are excluded, not treated as zero');
  assert.equal(x.peak, 30);
});

test('a directive that never scored anywhere has a NULL mean, not a zero', () => {
  const s = buildRunDirectiveStats([entry(bar(['x', null]))]);
  const x = s.directives.find((d) => d.id === 'x');
  assert.equal(x.mean, null);
  assert.equal(x.peak, null);
});

test('bars with no breakdown anywhere are REPORTED, so "no data" cannot read as "nothing fired"', () => {
  // Three bars, none carrying a directive. `attributed: 0` is the signal that the payload had no
  // breakdown at all — the state that must not be drawn as "no directive fired on this run".
  const s = buildRunDirectiveStats([entry(bar(), bar(), {})]);
  assert.equal(s.bars, 3);
  assert.equal(s.attributed, 0);
  assert.deepEqual(s.directives, []);
});

test('every bar counted once, across several days', () => {
  const s = buildRunDirectiveStats([entry(bar(['a', 10], ['b', 20])), entry(bar(['a', 30]))]);
  assert.equal(s.bars, 2);
  assert.equal(s.attributed, 2);
  assert.equal(s.directives.find((d) => d.id === 'a').bars, 2);
  assert.equal(s.directives.find((d) => d.id === 'b').bars, 1);
});

test('garbage in, an empty shape out — never a throw', () => {
  assert.deepEqual(buildRunDirectiveStats(null), { directives: [], bars: 0, attributed: 0 });
  assert.deepEqual(buildRunDirectiveStats([null, {}, { detail: null }]), { directives: [], bars: 0, attributed: 0 });
});
