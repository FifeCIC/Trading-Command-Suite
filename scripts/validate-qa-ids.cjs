#!/usr/bin/env node
/**
 * validate-qa-ids.cjs — UNIQUENESS gate for the QA checklist and the capability registry.
 *
 * WHAT IT CLOSES (issue #868, found 2026-09-17 while processing handoff batch #19)
 * -------------------------------------------------------------------------------
 * `src/data/qa-checklist.js` held 354 entries but only 339 unique ids — 15 ids were
 * used twice, because batches appended new entries starting from a number that was
 * already taken and NOTHING OBJECTED. The id is the handle: the QA page and any
 * future automation reference a test BY id, so "qa-contract-022 passed" named two
 * different tests and was therefore not evidence of anything.
 *
 * The 15 collisions were renumbered to the next free number in their prefix, the
 * second (later) occurrence always giving way, so the id that was established first
 * keeps its meaning. Nothing outside the checklist referenced any of them.
 *
 * WHY THIS IS A GUARD AND NOT A REVIEW NOTE
 * -----------------------------------------
 * This is the same shape as every other defect in this repo: a plausible file, no
 * error, and a number that looks right. A reviewer cannot count 354 ids by eye, so
 * the check has to be machine-run. See change-completion.instructions.md — the guard
 * is the deliverable, the fix is the excuse.
 *
 * WHAT IT DELIBERATELY DOES *NOT* CHECK
 * -------------------------------------
 * The id FORMAT. Measured 2026-09-18: 19 of the 354 ids do not match `qa-<prefix>-NNN`
 * — `qa-broker-config-001`, `qa-core-utils-001`, `qa-single-line-001`,
 * `qa-singles-monitor-001`, `qa-strategy-create-001/2`, `qa-strategy-form-001` use
 * MULTI-SEGMENT prefixes, and `qa-ui-005-v2` .. `qa-ui-014-v2` carry a version suffix.
 * A format rule would therefore fire ~19 times on a healthy tree, i.e. it would be
 * switched off or allowlisted within a week, and an allowlisted guard is worse than no
 * guard: it consumes attention and provides no cover. Uniqueness is the property whose
 * absence actually caused a defect, so uniqueness is the whole rule.
 *
 * Two directions is not the whole story either — the interesting failure is a guard
 * that CANNOT READ ITS INPUT. If the extraction regex stops matching (a refactor changes
 * `id: '…'` to something else) the check would compare two empty lists and report OK
 * forever. So zero extracted items is an ERROR, never a pass.
 *
 * USAGE
 *   node scripts/validate-qa-ids.cjs              # gate
 *   node scripts/validate-qa-ids.cjs --self-test  # prove the guard can fail
 *   node scripts/validate-qa-ids.cjs --list       # also print the LINE of every occurrence
 *
 * `--list` is not decoration: the repair for a duplicate is "renumber the later occurrence",
 * and to do that you need to know WHICH LINE each one is on. The failure message tells you
 * the rule; `--list` gives you the coordinates.
 *
 * Runs in `prebuild` (nest/package.json) after the other repo-root validators.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QA_FILE = path.join(ROOT, 'src', 'data', 'qa-checklist.js');
const FEATURES_FILE = path.join(ROOT, 'src', 'data', 'known-features.js');

const TAG = 'qa-ids';

// ── extraction ────────────────────────────────────────────────────────────────

/**
 * Scan a source with a global regex, returning `{ value, line }` for each match.
 * The line number is what makes a failure REPAIRABLE rather than merely reported:
 * "used twice" is a fact, "used twice, at lines 2933 and 3321" is an instruction.
 * Newlines are counted incrementally (never re-scanning from 0) so this stays O(n).
 */
function scan(source, re, pick) {
  const out = [];
  let line = 1;
  let cursor = 0;
  let m;
  while ((m = re.exec(source)) !== null) {
    for (let i = cursor; i < m.index; i++) if (source.charCodeAt(i) === 10) line++;
    cursor = m.index;
    out.push({ value: pick(m), line });
  }
  return out;
}

/**
 * QA ids are declared as a property at the head of each entry: `id: 'qa-…'`.
 * Anchored to the line start so an id MENTIONED inside a `procedure:` string (which
 * is prose, and may legitimately cite another test) is never mistaken for a
 * declaration. Measured 2026-09-18: anchored and unanchored extraction both return
 * 354 on the current file, so the anchor costs nothing and closes a real trap —
 * a guard that counts prose would one day report a duplicate that does not exist.
 */
function extractQaIds(source) {
  return scan(source, /^[ \t]*id:[ \t]*'([^']+)'/gm, (m) => m[1]);
}

/**
 * Capability names are the KEYS of the KNOWN_FEATURES map:
 *     'Some Capability': { dataPersistence: '…', … },
 * The leading quote may be preceded by indentation; the value shape (`dataPersistence`)
 * is required so an unrelated string-keyed object in the same file is not swept in.
 * `(?:[^'\\]|\\.)+` allows an escaped apostrophe inside a name.
 */
function extractCapabilityNames(source) {
  return scan(source, /^[ \t]*'((?:[^'\\]|\\.)+)':[ \t]*\{[ \t]*dataPersistence/gm, (m) =>
    m[1].replace(/\\'/g, "'"),
  );
}

/**
 * Items used more than once, in first-seen order, each carrying the LINES it occupies.
 * `lines.length` IS the count — keeping them separate would be two facts that can
 * disagree, and the whole point of this guard is that a number which can disagree with
 * its evidence is how the original defect got in.
 */
function findDuplicates(items) {
  const seen = new Map();
  for (const { value, line } of items) {
    if (!seen.has(value)) seen.set(value, []);
    seen.get(value).push(line);
  }
  const dupes = [];
  for (const [name, lines] of seen) {
    if (lines.length > 1) dupes.push({ name, count: lines.length, lines });
  }
  return dupes;
}

// ── checks ────────────────────────────────────────────────────────────────────

function checkFile(label, file, extract, { unit, hint }) {
  if (!fs.existsSync(file)) {
    return { label, fatal: `${file} does not exist — the guard cannot verify anything.` };
  }
  const source = fs.readFileSync(file, 'utf8');
  const items = extract(source);

  // ⚠️ A verifier that cannot read its input must ERROR, never pass. Empty extraction
  //    means the regex no longer matches the file's shape, which is a guard defect,
  //    not a clean bill of health.
  if (items.length === 0) {
    return {
      label,
      fatal:
        `extracted 0 ${unit}s from ${path.relative(ROOT, file)}. The file's shape has ` +
        `changed and this guard is now blind — fix the extraction regex in ` +
        `scripts/validate-qa-ids.cjs, do NOT delete the guard.`,
    };
  }

  const dupes = findDuplicates(items);
  return { label, file, total: items.length, unique: items.length - dupes.reduce((n, d) => n + d.count - 1, 0), dupes, hint };
}

// ── reporting ─────────────────────────────────────────────────────────────────

function run({ list }) {
  const results = [
    checkFile('QA checklist ids', QA_FILE, extractQaIds, {
      unit: 'id',
      hint:
        'Two entries answering to one id cannot be told apart, so citing the id is not\n' +
        '  evidence. Renumber the LATER occurrence to the next free number for its prefix\n' +
        '  (the id that was established first keeps its meaning) — that is the repair used\n' +
        '  for the original 15 collisions in #868.',
    }),
    checkFile('Capability names', FEATURES_FILE, extractCapabilityNames, {
      unit: 'capability name',
      hint:
        'Capability names are the key the registry is seeded by (nest/scripts/\n' +
        '  seed-capabilities.cjs), so two entries sharing a name silently become ONE row\n' +
        '  and the loser is unreachable from the Capability Map.',
    }),
  ];

  const fatals = results.filter((r) => r.fatal);
  const failing = results.filter((r) => r.dupes && r.dupes.length > 0);

  if (fatals.length === 0 && failing.length === 0) {
    console.log(`[${TAG}] ${results[0].total} QA ids, all unique`);
    console.log(`[${TAG}] ${results[1].total} capability names, all unique`);
    console.log(`\n[${TAG}] ✅ OK — no id or capability name is used twice\n`);
    process.exit(0);
  }

  if (fatals.length > 0) {
    console.error(`\n[${TAG}] ✖ ${fatals.length} unreadable input(s):\n`);
    for (const f of fatals) console.error(`  ✖ ${f.label}: ${f.fatal}`);
  }

  if (failing.length > 0) {
    const n = failing.reduce((sum, r) => sum + r.dupes.length, 0);
    console.error(`\n[${TAG}] ✖ ${n} duplicated name(s):\n`);
    for (const r of failing) {
      console.error(`  ── ${r.label} (${r.total} total, ${r.unique} unique) ──`);
      for (const d of r.dupes) {
        const where = list ? `  (lines ${d.lines.join(', ')})` : '';
        console.error(`  ✖ "${d.name}" is used ${d.count} times${where}`);
      }
      if (!list) {
        console.error(
          `\n  Re-run with --list to print the line of every occurrence — the repair is to\n` +
            `  renumber the LAST one, and you cannot do that from a count alone.`,
        );
      }
      if (r.hint) console.error(`\n  ${r.hint}\n`);
    }
  }

  process.exit(1);
}

// ── self-test — a guard that has never been observed to fail is a decoration ───

function selfTest() {
  const checks = [];
  const assert = (name, condition) => checks.push({ name, pass: !!condition });

  // Direction 1 — the checker BITES on a duplicate.
  const dupIds = extractQaIds(
    ["  {\n    id: 'qa-x-001',\n  },\n", "  {\n    id: 'qa-x-001',\n  },\n"].join(''),
  );
  assert('extracts ids from a well-formed entry', dupIds.length === 2);
  assert('detects a duplicate id', findDuplicates(dupIds).length === 1);
  assert('reports the duplicate count', findDuplicates(dupIds)[0].count === 2);
  // Lines 2 and 5 — the synthetic input is two 3-line objects, so the ids sit on the
  // second line of each. ⚠️ This expectation was WRONG on first write ([2, 4]) and the
  // self-test failed on it: the extractor was right and the spec was wrong. That is the
  // direction a self-test is supposed to catch, and it is why the assertion pins the
  // exact lines rather than just "some number".
  assert(
    'reports the LINE of every occurrence',
    JSON.stringify(findDuplicates(dupIds)[0].lines) === JSON.stringify([2, 5]),
  );

  // Direction 2 — it is SILENT on a clean set. Without this, "always fails" would pass.
  const cleanIds = extractQaIds(
    ["  {\n    id: 'qa-x-001',\n  },\n", "  {\n    id: 'qa-x-002',\n  },\n"].join(''),
  );
  assert('no false positive on unique ids', findDuplicates(cleanIds).length === 0);

  // Direction 3 — the ANCHOR matters: an id cited in prose must not count.
  const prose = "      procedure: 'Run this, then `id: 'qa-x-001'` by hand',\n";
  assert('ignores an id mentioned only in prose', extractQaIds(prose).length === 0);

  // Direction 4 — capability extraction, including an escaped apostrophe in a name.
  const caps = extractCapabilityNames(
    [
      "  'One Thing': { dataPersistence: 'none', uiSurfaces: 0 },\n",
      "  'Other Thing': { dataPersistence: 'none', uiSurfaces: 0 },\n",
      "  'It\\'s Fine': { dataPersistence: 'none', uiSurfaces: 0 },\n",
    ].join(''),
  );
  assert('extracts capability names', caps.length === 3);
  assert('unescapes an apostrophe in a name', caps[2].value === "It's Fine");
  assert('no duplicate among distinct capability names', findDuplicates(caps).length === 0);

  const dupCaps = extractCapabilityNames(
    [
      "  'Same': { dataPersistence: 'none', uiSurfaces: 0 },\n",
      "  'Same': { dataPersistence: 'none', uiSurfaces: 0 },\n",
    ].join(''),
  );
  assert('detects a duplicate capability name', findDuplicates(dupCaps).length === 1);

  // Direction 5 — an unrelated object in the same file must not be swept in.
  const noise = "  'notACapability': {\n    somethingElse: true,\n  },\n";
  assert('ignores a string key with no dataPersistence', extractCapabilityNames(noise).length === 0);

  // Direction 6 — the real files still parse to a non-zero count, i.e. the guard is
  // currently looking at something. This is the check that would have caught the
  // "blind guard" case in production.
  const realQa = extractQaIds(fs.readFileSync(QA_FILE, 'utf8'));
  const realCaps = extractCapabilityNames(fs.readFileSync(FEATURES_FILE, 'utf8'));
  assert('real qa-checklist.js yields a non-zero id count', realQa.length > 300);
  assert('real known-features.js yields a non-zero name count', realCaps.length > 300);
  assert('real qa-checklist.js has no duplicates', findDuplicates(realQa).length === 0);
  assert(
    'every real id carries a plausible line number',
    realQa.every((i) => Number.isInteger(i.line) && i.line > 0 && i.line <= 5000),
  );

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) {
    console.log(`  ${c.pass ? '✅' : '✖ '} ${c.name}`);
  }
  console.log('');
  if (failed.length === 0) {
    console.log(`[${TAG}] ✅ self-test PASSED — ${checks.length}/${checks.length} expectations\n`);
    process.exit(0);
  }
  console.error(`[${TAG}] ✖ self-test FAILED — ${failed.length} of ${checks.length} expectation(s)\n`);
  process.exit(1);
}

// ── entry ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
else run({ list: args.includes('--list') });
