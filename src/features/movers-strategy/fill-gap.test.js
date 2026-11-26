import test from 'node:test';
import assert from 'node:assert/strict';
import { summariseFillGaps, formatRange, fillGapChips } from './fill-gap.js';

/**
 * The two rules that make this surface honest (2026-11-26):
 *   1. `measured: 0` is "not recorded", never "no gap";
 *   2. counts sum, percentiles do not — a median of medians describes nothing.
 * Both are asserted here because both are the kind of thing a later simplification would "tidy up".
 */

const run = (measured, beyond, medianPct, p90Pct, worstPct) => ({
  fillGap: { measured, beyond, medianPct, p90Pct, worstPct, note: measured ? 'x' : null },
});

test('sums the exit counts across days, because they are counts', () => {
  const out = summariseFillGaps([run(4, 4, 2.33, 2.98, 14.96), run(6, 3, 0.75, 3.1, 9.0)]);
  assert.equal(out.measured, 10);
  assert.equal(out.beyond, 7);
  assert.equal(out.measuredRuns, 2);
  assert.equal(out.unmeasuredRuns, 0);
});

test('reports percentiles as a RANGE across days, never a median of medians', () => {
  const out = summariseFillGaps([run(4, 4, 2.33, 2.98, 14.96), run(6, 3, 0.75, 3.1, 9.0)]);
  assert.deepEqual(out.median, { min: 0.75, max: 2.33 });
  assert.deepEqual(out.p90, { min: 2.98, max: 3.1 });
  // `worst` is the largest observed, which is the only cross-day claim that is true.
  assert.equal(out.worst, 14.96);
});

test('an unmeasured day is COUNTED, not folded in as a zero gap', () => {
  const out = summariseFillGaps([run(4, 4, 2.33, 2.98, 14.96), run(0, 0, null, null, null)]);
  assert.equal(out.runs, 2);
  assert.equal(out.measuredRuns, 1);
  assert.equal(out.unmeasuredRuns, 1);
  // The measured day's numbers survive untouched — the unmeasured one contributes nothing to them.
  assert.equal(out.measured, 4);
  assert.deepEqual(out.median, { min: 2.33, max: 2.33 });
});

test('nothing measured anywhere yields zero counts and NULL percentiles — never 0%', () => {
  const out = summariseFillGaps([run(0, 0, null, null, null), run(0, 0, null, null, null)]);
  assert.equal(out.measured, 0);
  assert.equal(out.beyond, 0);
  assert.equal(out.median, null);
  assert.equal(out.p90, null);
  assert.equal(out.worst, null);
  assert.equal(out.unmeasuredRuns, 2);
});

test('a run with no fillGap object at all is ignored rather than crashing', () => {
  const out = summariseFillGaps([{}, null, undefined, run(2, 1, 1.0, 2.0, 5.0)]);
  assert.equal(out.runs, 1);
  assert.equal(out.measured, 2);
  assert.equal(out.unmeasuredRuns, 0);
});

/**
 * ⚠️ THE TWO MEANINGS OF `measured: 0` (2026-11-26). A population with no stop exit and a stop exit
 * recorded without the bar's extreme both read `measured: 0`, and they say opposite things. Carried
 * through so the page can state which — precautionary: the second state was not observed when this was
 * written, and the apparent instance was trades the selection had refused.
 */
test('separates "no stop exit" from "stop exit that could not be read"', () => {
  const gap = (measured, stopExits, unrecorded) => ({
    fillGap: { measured, stopExits, unrecorded, beyond: measured, medianPct: null, p90Pct: null, worstPct: null },
  });
  const none = summariseFillGaps([gap(0, 0, 0)]);
  assert.equal(none.stopExits, 0);
  assert.equal(none.unrecorded, 0);

  const unreadable = summariseFillGaps([gap(0, 4, 4)]);
  assert.equal(unreadable.stopExits, 4);
  assert.equal(unreadable.unrecorded, 4);
  assert.equal(unreadable.measured, 0);
  // ...and the totals survive when both kinds of day are present.
  const mixed = summariseFillGaps([gap(2, 2, 0), gap(0, 4, 4)]);
  assert.equal(mixed.measured, 2);
  assert.equal(mixed.stopExits, 6);
  assert.equal(mixed.unrecorded, 4);
});

test('formatRange prints one figure when the days agree, a range when they do not', () => {
  assert.equal(formatRange({ min: 2.33, max: 2.33 }), '2.33%');
  assert.equal(formatRange({ min: 0.75, max: 2.33 }), '0.75–2.33%');
  assert.equal(formatRange(null), null);
});

/**
 * ── fillGapChips (owner, 2026-11-26) ─────────────────────────────────────────────────────────────
 * The paragraph this replaces printed four blocks. The chips keep the facts but make the SEVERITY a
 * derived fact — worst overshoot against the bot's own stop distance — because a chip is believed
 * faster than prose.
 */

const view = (over = {}) => ({
  runs: 5, measuredRuns: 1, unmeasuredRuns: 3,
  measured: 19, beyond: 18, stopExits: 19, unrecorded: 0,
  median: { min: 5.19, max: 5.19 }, p90: { min: 24.38, max: 24.38 }, worst: 25.52,
  ...over,
});

test('▶ CANARY — severity comes from the overshoot against the STOP DISTANCE', () => {
  // worst 25.52% on a 20% stop = 1.28× the intended risk.
  const risk = fillGapChips(view(), { stopPct: 20 });
  assert.equal(risk[0].tone, 'risk');

  // The same overshoot on a 60% stop is 0.43× — below half the distance would be info; 0.43 is info.
  assert.equal(fillGapChips(view(), { stopPct: 60 })[0].tone, 'info');

  // …and on a 40% stop it is 0.64×, which is warn.
  assert.equal(fillGapChips(view(), { stopPct: 40 })[0].tone, 'warn');
});

test('the chip carries ONE figure — the worst overshoot beside the stop it is judged against', () => {
  const [chip] = fillGapChips(view(), { stopPct: 20 });
  assert.equal(chip.value, 'worst 25.52% · stop 20%');
  // The other percentiles live in the panel, not on the row.
  assert.match(chip.detail, /median 5\.19%/);
  assert.match(chip.detail, /p90 24\.38%/);
  assert.match(chip.meaning, /1\.3× your stop distance/);
});

test('with no stop distance the severity is NOT invented — info, and the panel says why', () => {
  const [chip] = fillGapChips(view(), {});
  assert.equal(chip.tone, 'info');
  assert.match(chip.meaning, /cannot be judged/);
});

test('"not measured" is muted, never ok — and never shares the passing colour', () => {
  const chips = fillGapChips(view({ measured: 0, beyond: 0, unrecorded: 4, measuredRuns: 0 }), { stopPct: 20 });
  const muted = chips.filter((c) => c.tone === 'muted');
  assert.equal(muted.length, 1);
  assert.equal(muted[0].code, 'unrecorded');
  assert.equal(chips.some((c) => c.tone === 'ok'), false);
});

test('days with no stop exit are an absence, not a fault — info, not warn', () => {
  const chips = fillGapChips(view({ unmeasuredRuns: 3 }), { stopPct: 20 });
  const coverage = chips.find((c) => c.code === 'coverage');
  assert.equal(coverage.tone, 'info');
  assert.equal(coverage.value, '3 of 5 days had no stop exit');
});

test('nothing measured and no stops anywhere still says something, rather than nothing', () => {
  const chips = fillGapChips(view({ measured: 0, beyond: 0, stopExits: 0, unrecorded: 0, measuredRuns: 0 }), { stopPct: 20 });
  assert.equal(chips.length, 1);
  assert.equal(chips[0].tone, 'muted');
  assert.match(chips[0].meaning, /not a zero gap/);
});

test('no runs at all renders no strip', () => {
  assert.deepEqual(fillGapChips(view({ runs: 0 }), { stopPct: 20 }), []);
});
