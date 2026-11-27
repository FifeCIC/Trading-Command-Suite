import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCaveats, caveatDetail } from './caveats.js';

/**
 * The caveat table's grouping rules.
 *
 * ⚠️ THE GROUPING IS THE FEATURE (2026-11-26). The prose list was removed in November because eleven
 * sentences read as a wall; a table that printed one row per SENTENCE would rebuild that wall, because
 * five days each emit their own "measured on <date>" sentence. These cases pin the difference.
 */

const row = (code, text, label = code, qualifies = 'Totals') => ({ code, label, qualifies, text });

test('the same caveat from five days is ONE row, with the day count carried', () => {
  const runs = [1, 2, 3, 4, 5].map((d) => ({
    caveatRows: [row('single-session', `Measured on 2026-11-${10 + d} only.`)],
  }));
  const out = groupCaveats(runs);
  assert.equal(out.length, 1);
  assert.equal(out[0].code, 'single-session');
  assert.equal(out[0].days, 5);
  // Five different sentences — kept, so the reader can see they are not identical.
  assert.equal(out[0].texts.length, 5);
});

test('IDENTICAL text across days collapses to one, and is shown without an "e.g."', () => {
  const runs = [{ caveatRows: [row('trade-config', 'Trade management came from Bot A.')] },
    { caveatRows: [row('trade-config', 'Trade management came from Bot A.')] }];
  const out = groupCaveats(runs);
  assert.equal(out[0].days, 2);
  assert.equal(out[0].texts.length, 1);
  assert.equal(caveatDetail(out[0]), 'Trade management came from Bot A.');
});

test('a disagreeing detail is shown as an EXAMPLE, never as the whole', () => {
  const runs = [{ caveatRows: [row('excluded-trades', '48 trades excluded on day 1.')] },
    { caveatRows: [row('excluded-trades', '7 trades excluded on day 2.')] }];
  const out = groupCaveats(runs);
  assert.equal(out[0].days, 2);
  assert.match(caveatDetail(out[0]), /^e\.g\. 48 trades excluded/);
});

test('rows keep the order the server emitted them in, so consequence reads top-down', () => {
  const runs = [{ caveatRows: [row('single-session', 'a'), row('trade-config', 'b'), row('membership', 'c')] }];
  assert.deepEqual(groupCaveats(runs).map((r) => r.code), ['single-session', 'trade-config', 'membership']);
});

test('a statement already rendered elsewhere is dropped, so one fact never appears twice', () => {
  const runs = [{ caveatRows: [row('single-session', 'rendered elsewhere'), row('membership', 'kept')] }];
  const out = groupCaveats(runs, ['rendered elsewhere']);
  assert.deepEqual(out.map((r) => r.code), ['membership']);
});

test('an older response with no structured rows is EMPTY, not a crash and not a prose parse', () => {
  // `caveats` (the string array) is deliberately ignored: assembling a table by string-matching breaks
  // the first time a sentence is reworded, and says nothing when it silently matches nothing.
  assert.deepEqual(groupCaveats([{ caveats: ['Measured on 2026-11-20 only.'] }]), []);
  assert.deepEqual(groupCaveats(undefined), []);
});

// ── note: the gist (2026-11-27) ──────────────────────────────────────────────────────────────────
// The Detail column moved to a ≤5-word gist with the sentence behind a marker. Two things can go wrong
// silently: a gist that is really a sentence (the wall returns, one row at a time), and a missing gist
// being filled by a TRUNCATION of the prose (a cell ending mid-clause reads as a bug).

const withRows = (rows) => [{ caveatRows: rows }];

test('the gist is carried through grouping, so the cell can show the fact', () => {
  const [row] = groupCaveats(withRows([
    { code: 'single-session', label: 'One session', qualifies: 'Totals', gist: 'one session, 5 warm-up', text: 'Measured on 2026-11-11 only…' },
  ]));
  assert.equal(row.gist, 'one session, 5 warm-up');
  assert.deepEqual(row.texts, ['Measured on 2026-11-11 only…'], 'the sentence is still carried');
});

test('a row with NO gist keeps null, so the page falls back to the full sentence — never a truncation', () => {
  const [row] = groupCaveats(withRows([
    { code: 'single-session', label: 'One session', qualifies: 'Totals', text: 'Measured on 2026-11-11 only…' },
  ]));
  assert.equal(row.gist, null);
});

test('the first gist a code offers wins, and a later one can fill a missing one', () => {
  const [row] = groupCaveats(withRows([
    { code: 'membership', label: 'Candidate list', qualifies: 'Top N', text: 'A' },
    { code: 'membership', label: 'Candidate list', qualifies: 'Top N', gist: '10 names, optimistic', text: 'B' },
  ]));
  assert.equal(row.gist, '10 names, optimistic');
  assert.equal(row.days, 2);
});

test('▶ CANARY — a gist longer than five words is REPORTED, because the wall returns one row at a time', () => {
  const rows = groupCaveats(withRows([
    { code: 'membership', label: 'Candidate list', qualifies: 'Top N', gist: 'the candidate list was built from the day close', text: 'x' },
  ]));
  const offenders = rows.filter((r) => r.gist && r.gist.trim().split(/\s+/).length > 5);
  assert.equal(offenders.length, 1, 'this guard exists so the rule can fail loudly here rather than on screen');
});

test('the real five-word gists in use pass the same rule', () => {
  const samples = [
    'one session, 5 warm-up',
    "'Movers V1 Long Bot' bracket",
    '10 names, membership optimistic',
    'side from protocol',
    '12 of 90 refused',
    '34 trades not counted',
    '1 symbol(s) failed',
    'nothing ranked this day',
    '2 engine qualification(s)',
  ];
  for (const g of samples) {
    assert.ok(g.trim().split(/\s+/).length <= 5, `"${g}" is a sentence, not a gist`);
  }
});
