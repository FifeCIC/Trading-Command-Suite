#!/usr/bin/env node
/**
 * why-unregistered.cjs — is an unregistered directive a DUPLICATE, a RETIREMENT, or a FAULT? (#1169)
 * ================================================================================================
 * The owner asked the right question (2026-11-01): *"is that because many directives aren't deemed ready
 * to use or a fault?"* A count cannot answer that — 25 unreachable classes is one number describing
 * three different situations, and only one of them is harmless.
 *
 * For every unregistered directive class this reports:
 *
 *   id           the runtime id it would have registered under
 *   readiness    its own declaration: 'ready' | 'beta' | 'alpha'
 *   duplicate?   is a class with the SAME `id` registered from another file?
 *   verdict      DUPLICATE  — a live class already owns this id; the file is dead weight (harmless-ish,
 *                             but editing it silently does nothing — this bit a real change)
 *                RETIRED    — the file, or its registry entry, says it was stood down on purpose
 *                NEVER-WIRED— nothing suggests intent either way: a class that was written and forgotten
 *
 * ⚠️ The verdict is EVIDENCE, not judgement. `NEVER-WIRED` does not mean "should be registered": a
 * duplicate id would double-count a signal in a composite and inflate the denominator (#1169).
 *
 *   node scripts/why-unregistered.cjs            # table
 *   node scripts/why-unregistered.cjs --json     # machine-readable
 *   node scripts/why-unregistered.cjs --self-test
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'nest', 'src', 'modules', 'directives', 'implementations');
const MODULE = path.join(__dirname, '..', 'nest', 'src', 'modules', 'directives', 'directives.module.ts');

/**
 * Which directive classes are ACTUALLY registered at runtime.
 *
 * ⚠️ THE EXACT RULE LIVES IN `scripts/lib/directive-registry.cjs`. It was three copies of the same
 * parser before, and one of them (the reference guard) tested class-name presence instead of a
 * `register()` call — so it reported OK on a tree where `williams-r` was named by a protocol group
 * and never registered. A second copy also missed an ALIASED import
 * (`MondayEffectDirective as MondayEffectRealDirective`), which made a live, registered directive
 * read as unreachable. One implementation, four consumers.
 */
const { registeredClassNames } = require('./lib/directive-registry.cjs');

/** Every directive class in the library with its id, readiness and source file. */
function scanLibrary() {
  const moduleSrc = fs.readFileSync(MODULE, 'utf8');
  const registeredClasses = registeredClassNames(moduleSrc);
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
  const out = [];

  for (const file of files) {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    const classStarts = [...src.matchAll(/export\s+class\s+(\w+)[\s\S]*?implements\s+IDirective/g)];
    for (let i = 0; i < classStarts.length; i++) {
      const start = classStarts[i].index;
      const end = i + 1 < classStarts.length ? classStarts[i + 1].index : src.length;
      const body = src.slice(start, end);
      const id = (/readonly id = '([^']+)'/.exec(body) || [])[1];
      if (!id) continue;
      out.push({
        className: classStarts[i][1],
        id,
        file,
        readiness: (/readonly readiness = '([^']+)'/.exec(body) || [])[1] ?? '?',
        registered: registeredClasses.has(classStarts[i][1]),
        // ⚠️ SCOPED TO THE CLASS, and this was a real bug. The first version scanned the WHOLE file, so
        // `price-above-sma-50` was reported RETIRED because `momentum-and-macro.directives.ts` contains
        // seven genuinely retired calendar claims (#879) elsewhere in the same file. A verdict borrowed
        // from a neighbouring class is worse than no verdict — it reads as a deliberate decision.
        // The note is looked for in the class body and in the comment block immediately above it.
        retiredNote: findRetirementNote(classPrecedingComment(src, start) + '\n' + body),
      });
    }
  }
  return out;
}

/**
 * The contiguous comment block immediately above a class, so a note written there is attributed to the
 * class rather than to whatever happens to share the file.
 */
function classPrecedingComment(src, classAt) {
  const before = src.slice(0, classAt);
  const lines = before.split('\n');
  const kept = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { if (kept.length) break; else continue; }
    if (/^\s*(\*|\/\/|\/\*|@)/.test(line)) { kept.unshift(line); continue; }
    // A decorator or the previous class declaration ends the block.
    break;
  }
  return kept.join('\n');
}

const RETIREMENT_PATTERNS = [
  /retired/i, /superseded/i, /deprecated/i, /do not (use|register)/i,
  /replaced by/i, /no longer (used|registered)/i, /unused/i,
];

function findRetirementNote(src) {
  const lines = src.split('\n');
  for (const line of lines) {
    if (!/^\s*(\*|\/\/)/.test(line)) continue; // comments only — a code string is not a note
    for (const p of RETIREMENT_PATTERNS) {
      if (p.test(line)) return line.replace(/^\s*(\*|\/\/)\s?/, '').trim().slice(0, 120);
    }
  }
  return null;
}

function classify(rows) {
  const registeredIds = new Map(rows.filter((r) => r.registered).map((r) => [r.id, r.file]));
  return rows
    .filter((r) => !r.registered)
    .map((r) => {
      const owner = registeredIds.get(r.id);
      let verdict;
      if (owner) verdict = 'DUPLICATE';
      else if (r.retiredNote) verdict = 'RETIRED';
      else verdict = 'NEVER-WIRED';
      return { ...r, registeredOwner: owner ?? null, verdict };
    });
}

function main() {
  const rows = scanLibrary();
  const dead = classify(rows).sort((a, b) => a.verdict.localeCompare(b.verdict) || a.id.localeCompare(b.id));

  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) { selfTest(rows, dead); return; }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ total: rows.length, unregistered: dead.length, rows: dead }, null, 1));
    return;
  }

  const by = (v) => dead.filter((d) => d.verdict === v);
  console.log(`\ndirective classes: ${rows.length}    registered: ${rows.length - dead.length}    unregistered: ${dead.length}\n`);
  console.log(`  DUPLICATE   ${String(by('DUPLICATE').length).padStart(3)}  a live class already owns this id`);
  console.log(`  RETIRED     ${String(by('RETIRED').length).padStart(3)}  a comment says it was stood down`);
  console.log(`  NEVER-WIRED ${String(by('NEVER-WIRED').length).padStart(3)}  nothing indicates intent — written and forgotten\n`);

  console.log('verdict      id                          ready      file');
  console.log('─'.repeat(104));
  for (const d of dead) {
    const owner = d.verdict === 'DUPLICATE' ? `  → live in ${d.registeredOwner}` : '';
    console.log(`${d.verdict.padEnd(12)} ${d.id.padEnd(27)} ${String(d.readiness).padEnd(10)} ${d.file}${owner}`);
  }
  console.log('');
}

/**
 * --self-test: prove all three verdicts are REACHABLE by the classifier.
 *
 * ⚠️ Asserted on SYNTHETIC rows, not on the library. The first version of this test required the real
 * data to contain a DUPLICATE and failed — correctly, because it does not: no two unregistered classes
 * share an `id` with a registered one. Asserting on live data makes a test that breaks when the data
 * changes for legitimate reasons, and it had also been used to support a wrong claim (`bollinger-percent-b`
 * and `williams-percent-r` are the same INDICATOR as live classes but under DIFFERENT ids, so they are
 * not duplicates in the sense this classifier measures).
 */
function selfTest(rows, dead) {
  const fail = [];
  const ok = (cond, name) => { if (!cond) fail.push(name); };

  const synthetic = [
    { className: 'LiveOne', id: 'live-one', file: 'live.ts', readiness: 'ready', registered: true, retiredNote: null },
    { className: 'DeadDup', id: 'live-one', file: 'dup.ts', readiness: 'ready', registered: false, retiredNote: null },
    { className: 'RetiredOne', id: 'retired-one', file: 'r.ts', readiness: 'beta', registered: false, retiredNote: 'stood down 2026-01-01' },
    { className: 'NeverWired', id: 'never-wired', file: 'n.ts', readiness: 'ready', registered: false, retiredNote: null },
  ];
  const verdicts = classify(synthetic);
  ok(verdicts.find((v) => v.id === 'live-one')?.verdict === 'DUPLICATE', 'self-test: a shared id is classified DUPLICATE');
  ok(verdicts.find((v) => v.id === 'retired-one')?.verdict === 'RETIRED', 'self-test: a retirement note is classified RETIRED');
  ok(verdicts.find((v) => v.id === 'never-wired')?.verdict === 'NEVER-WIRED', 'self-test: no evidence is classified NEVER-WIRED');
  ok(verdicts.length === 3, 'self-test: the registered class is excluded from the unregistered set');

  // A DUPLICATE must name the live file, or the verdict is unsupported.
  ok(verdicts.filter((v) => v.verdict === 'DUPLICATE').every((v) => v.registeredOwner), 'self-test: a DUPLICATE always names its live file');

  // Data sanity — true of the library today, and a failure here means the SCAN broke, not the library.
  ok(rows.length > 100, 'self-test: the scan finds the library (a scan that finds nothing must FAIL)');
  ok(!dead.some((d) => d.registered), 'self-test: no registered class appears in the unregistered set');

  // The retirement matcher must match a comment and must NOT match code.
  ok(findRetirementNote('// retired 2026-01-01') !== null, 'self-test: a retirement note is detected');
  ok(findRetirementNote('const x = 1;') === null, 'self-test: code with no note is not called retired');
  ok(findRetirementNote('reason: "unused"') === null, 'self-test: a code STRING is not a note');

  if (fail.length) {
    console.error('\nSELF-TEST FAILED:');
    for (const f of fail) console.error(`  ✖ ${f}`);
    process.exit(1);
  }
  console.log('✅ self-test: 10 assertions pass — all three verdicts are reachable (proven on synthetic rows, '
    + 'not on live data), a DUPLICATE names its live file, and the retirement matcher reads comments only.');
}

if (require.main === module) main();

module.exports = { scanLibrary, classify, findRetirementNote };
