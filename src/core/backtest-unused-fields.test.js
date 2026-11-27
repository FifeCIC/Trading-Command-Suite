/**
 * backtest-unused-fields.test.js — the inventory must never turn a missing field into a value (#1340).
 *
 * The whole panel exists so the owner can choose what to surface. Its one dangerous failure is
 * rendering a declared field as though the run had returned it: a blank cell reads as "zero" or
 * "nothing happened", and the reader would decide against a field that was never present.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  inventoryRows,
  formatValue,
  readPath,
  pickListFor,
  inventoryFindings,
  UNUSED_FIELD_INVENTORY,
  INVENTORY_CONCERNS,
} from './backtest-unused-fields.js';

const payload = {
  rankingProvider: { provider: 'yahoo', available: ['yahoo'], ambiguous: false, note: null },
  candidates: ['NWTG', 'CANG', 'ELOG'],
  priorSessions: 3,
  sideSource: 'protocol',
  datasetSide: 'winners',
  fillGap: { measured: 0, beyond: 0, medianPct: null },
  perSymbol: [{ symbol: 'ELOG', excludedNotSelected: 0, excludedBeforeCutoff: 2 }],
  admission: null,
};

test('readPath resolves a nested key and refuses to throw on anything else', () => {
  assert.equal(readPath(payload, 'rankingProvider.provider'), 'yahoo');
  assert.equal(readPath(payload, 'nope.deeper.still'), undefined);
  assert.equal(readPath(null, 'a'), undefined);
  assert.equal(readPath(payload, ''), undefined);
});

test('every declared row is reported, whether the run returned it or not', () => {
  const rows = inventoryRows(payload);
  assert.equal(rows.length, UNUSED_FIELD_INVENTORY.length);
  assert.equal(rows.find((r) => r.path === 'priorSessions').present, true);
});

test('a declared field the run does not return is ABSENT, not zero and not blank', () => {
  const rows = inventoryRows({});
  const missing = rows.find((r) => r.path === 'rankingProvider');
  assert.equal(missing.present, false);
  assert.equal(missing.value, undefined);
  assert.equal(formatValue(missing.value), null);
});

test('a null value counts as absent — "the run had nothing" is not "the field is zero"', () => {
  const rows = inventoryRows(payload);
  assert.equal(rows.find((r) => r.path === 'admission').present, false);
});

test('a zero value is PRESENT, which is the case a falsy check would get wrong', () => {
  const rows = inventoryRows({ priorSessions: 0 });
  const row = rows.find((r) => r.path === 'priorSessions');
  assert.equal(row.present, true);
  assert.equal(formatValue(row.value), '0');
});

test('a nested object is read through its path, not borrowed from a sibling', () => {
  const rows = inventoryRows({ perSymbol: [{ symbol: 'ELOG', excludedBeforeCutoff: 2 }] });
  // `excludedBeforeCutoff` lives per symbol and is NOT declared at the top level: reporting it present
  // here would show one symbol's figure as though it were the run's.
  assert.equal(rows.some((r) => r.path === 'excludedBeforeCutoff'), false);
  assert.equal(rows.find((r) => r.path === 'rankingProvider').present, false);
});

test('formatValue summarises objects and never leaks [object Object]', () => {
  assert.match(formatValue({ provider: 'yahoo', ambiguous: false }), /provider: yahoo/);
  assert.equal(formatValue([1, 2, 3]), '1, 2, 3');
  assert.equal(formatValue([{ a: 1 }, { a: 2 }]), '2 item(s)');
  assert.equal(formatValue([]), '(none)');
  assert.equal(formatValue({}), '(empty)');
  assert.equal(formatValue('  '), '(empty)');
  assert.equal(formatValue(1.23456), '1.23');
  assert.equal(formatValue(7), '7');
  assert.equal(formatValue(true), 'yes');
});

// ── note n · the pick-list ───────────────────────────────────────────────────────────────────────

test('the declaration is healthy in BOTH directions — every field answers a question, every question has fields', () => {
  const f = inventoryFindings();
  assert.deepEqual(f.unassigned, [], 'a field no reader is ever offered');
  assert.deepEqual(f.empty, [], 'a chip that opens an empty table');
  assert.deepEqual(f.unknown, [], 'an `answers` id that is not a declared concern');
});

test('▶ CANARY — a field with NO question is reported, so the pick-list cannot silently drop it', () => {
  const f = inventoryFindings([{ path: 'mystery', answers: [] }]);
  assert.deepEqual(f.unassigned, ['mystery']);
});

test('▶ CANARY — a question with NO field is reported, because an empty chip reads as "nothing to say"', () => {
  const f = inventoryFindings([{ path: 'a', answers: ['comparable'] }]);
  assert.deepEqual(f.empty, ['decision', 'assumed']);
});

test('▶ CANARY — a mistyped `answers` id is reported, or the field vanishes from every pick-list', () => {
  const f = inventoryFindings([{ path: 'a', answers: ['comparabel'] }]);
  assert.deepEqual(f.unknown, ['comparabel']);
  assert.deepEqual(f.unassigned, [], 'it HAS an answer; the answer is just not a real question');
});

test('a pick-list returns the fields that answer ONE question, and says how many it left out', () => {
  const rows = inventoryRows(payload);
  const { rows: picked, concern, hidden } = pickListFor(rows, 'decision');
  assert.equal(concern.question, 'Did the strategy actually choose?');
  // ⚠️ `candidates` was retired 2026-11-27 (it is rendered as the Candidates column), so this list is
  // what remains for the question "did the strategy actually choose?".
  assert.deepEqual(picked.map((r) => r.path), ['sideSource', 'datasetSide']);
  assert.equal(hidden, rows.length - picked.length);
  assert.equal(picked.length + hidden, rows.length, 'nothing may be lost between the two counts');
});

test('"all" is the whole inventory with nothing hidden — the default must not filter silently', () => {
  const rows = inventoryRows(payload);
  const all = pickListFor(rows, 'all');
  assert.equal(all.rows.length, rows.length);
  assert.equal(all.hidden, 0);
  assert.equal(all.concern, null);
});

test('an UNKNOWN question returns everything rather than an empty table', () => {
  const rows = inventoryRows(payload);
  const { rows: picked, concern } = pickListFor(rows, 'no-such-concern');
  assert.equal(picked.length, rows.length);
  assert.equal(concern, null);
});

test('a retired field is GONE from the inventory — fillGap is rendered now, so it may not be listed', () => {
  // Measured 2026-11-27: step 2 renders `fillGapChips(fillGapView)`, so the declaration's own claim
  // ("computed on every run and shown nowhere") became false. This asserts the correction holds.
  assert.equal(UNUSED_FIELD_INVENTORY.some((i) => i.path === 'fillGap'), false);
});

/**
 * ── THE LIST CANNOT DISAGREE WITH THE UI (2026-11-27) ──────────────────────────────────────────────
 *
 * A declared "unused" field that IS rendered is a lie in the opposite direction from the one that bit
 * this file: the docblock used to say the two per-symbol exclusion counts were rendered, they were
 * rendered nowhere, and nothing noticed for days. Enumerating the RENDERED fields in prose was the
 * mistake — so the prose is gone and this reads the source instead.
 *
 * ⚠️ THREE THINGS THIS GETS RIGHT THAT A ONE-LINE GREP DOES NOT:
 *
 *   1. **Scope is DERIVED, not listed.** The page plus its own imports plus the strategy folder — the
 *      population the docblock actually measured. A whole-`src` scan reports `candidates` in
 *      `ScreenerPage` and `TrendReadingPage`, which are different fields with the same word.
 *   2. **Comments and strings are stripped first.** `admission` appears in this page twice, both in
 *      prose about "the run's own admission checks". Matching it would be a false finding — and the
 *      docblock's own phrase is "(or comment-only)", which is only checkable with a stripper.
 *   3. **It found a real second error.** `candidates` was listed as unused while the page reads
 *      `r.candidates?.length` for its Candidates column. That row is now retired from the inventory.
 */
function stripCommentsAndStrings(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** The page, its own imports, and every file in the strategy folder. Derived from the page's source. */
function moversUiSources() {
  const srcRoot = new URL('../', import.meta.url);
  const pagePath = new URL('pages/MoversStrategyBacktestPage.jsx', srcRoot);
  const page = readFileSync(pagePath, 'utf8');
  const files = [{ file: 'pages/MoversStrategyBacktestPage.jsx', text: page }];

  for (const m of page.matchAll(/from '(\.[^']+)'/g)) {
    const target = new URL(m[1], pagePath);
    for (const candidate of [target, new URL(`${target.href}.jsx`, target), new URL(`${target.href}.js`, target)]) {
      try {
        files.push({ file: decodeURIComponent(candidate.pathname).split('/src/').pop(), text: readFileSync(candidate, 'utf8') });
        break;
      } catch {
        /* not a file — a folder import or a css file; the folder walk below covers those */
      }
    }
  }
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.jsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        files.push({ file: decodeURIComponent(full.pathname).split('/src/').pop(), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(new URL('features/movers-strategy/', srcRoot));
  return files;
}

test('▶ CANARY — every field declared UNUSED is matched nowhere in the movers UI source', () => {
  const sources = moversUiSources();
  assert.ok(sources.length >= 8, `expected the page, its imports and the strategy folder, got ${sources.length}`);

  const claimedUnused = UNUSED_FIELD_INVENTORY.map((i) => i.path);
  const present = [];
  for (const { file, text } of sources) {
    const code = stripCommentsAndStrings(text);
    for (const path of claimedUnused) {
      if (new RegExp(`\\b${path}\\b`).test(code)) present.push(`${path} in ${file}`);
    }
  }
  assert.deepEqual(
    present,
    [],
    'a field listed as unused is READ by the movers UI — retire it from the inventory, do not leave the ' +
      'declaration claiming the page does not show it',
  );
});

test('▶ CANARY — the detector can fail, so the assertion above is not vacuous', () => {
  const sources = moversUiSources();
  const probe = [...sources.map((s) => stripCommentsAndStrings(s.text)), 'const x = run.priorSessions;'];
  assert.ok(probe.some((t) => /\bpriorSessions\b/.test(t)), 'the detector must fire on a rendered field');
  // …and a comment must NOT fire it, or the two findings above would be indistinguishable.
  assert.equal(/\badmission\b/.test(stripCommentsAndStrings('// the run\'s own admission checks')), false);
});

test('a field that IS rendered is retired — candidates is the Candidates column', () => {
  // Measured 2026-11-27: the page reads `r.candidates?.length` for the day table's Candidates column.
  assert.equal(UNUSED_FIELD_INVENTORY.some((i) => i.path === 'candidates'), false);
});

test('every concern names a question and a reason a reader can act on', () => {
  for (const c of INVENTORY_CONCERNS) {
    assert.ok(c.id && c.question && c.why, `${c.id} is incomplete`);
    assert.match(c.question, /\?$/, 'a concern is a question, not a noun');
  }
});
