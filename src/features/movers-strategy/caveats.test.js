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
