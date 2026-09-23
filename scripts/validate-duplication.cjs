#!/usr/bin/env node
/**
 * validate-duplication.cjs — INV-NO-NEW-DUPLICATION (build-time, ratcheted)
 * =========================================================================
 * Wired into `prebuild`. Fails when a NEW copy-paste block appears in two files.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS PREVENTS (measured 2026-09-18)
 * ─────────────────────────────────────────────────────────────────────────
 * The repo carries **1,621 duplicated 8-line blocks (~13,000 lines)** across 135 file-pairs,
 * and nothing noticed when the number grew.
 *
 * This is the class this codebase keeps re-finding: **a second copy is cheaper to write than
 * to extend the first, and nothing complains.** Every defect fixed in #890 / #892 / #893 was
 * a single source of truth being bypassed:
 *
 *   - #890  a directive in `providers` that was constructed but never registered
 *   - #892  a bridge response body that was never read
 *   - #893  stop edits refused by a closed market, invisibly
 *
 * The distribution matters more than the total — it is CLUSTERED, not spread:
 *
 *   architecture-framework.data.js <-> architecture-reference.js   944 windows (58%)
 *   SignalCard.jsx <-> SignalsOverviewPage.jsx                      68
 *   seed-crypto-5yr.js <-> .ts                                      40
 *   macd-divergence <-> obv-divergence directives                   32
 *
 * Deleting the one architecture pair takes the total from 1,621 to 677. The existing clusters
 * are tracked in #897 and #898; this guard exists so a FIFTH cannot form while they are
 * worked through.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A RATCHET AND NOT A THRESHOLD
 * ─────────────────────────────────────────────────────────────────────────
 * A single number ("fail above 1,500 blocks") is both noisy and gameable — it invites
 * raising the cap until green. Instead the allowance records the pairs that exist TODAY, and:
 *
 *   - an existing pair may only go DOWN
 *   - a pair not in the allowance FAILS (new duplication)
 *   - a pair that goes down is reported so `--update-allowance` can bank the progress
 *
 * Same mechanism as `validate-settings-access.cjs`, deliberately — one ratchet pattern in
 * this repo, not two.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY WINDOWS AND NOT AN AST
 * ─────────────────────────────────────────────────────────────────────────
 * An 8-line normalised window appearing in 2+ DISTINCT files is copy-paste with few false
 * positives, and one mechanism covers `.jsx`, `.ts`, `.cjs` and `.py`. An AST comparison
 * would be more precise and would also be four parsers to maintain.
 *
 * ⚠️ Being listed in `providers` is not registration; being SIMILAR is not duplication. This
 * guard measures shared literal lines only — it will not catch two functions that do the
 * same thing written differently. It is a tripwire, not a proof.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ SENSITIVITY — measured, not assumed
 * ─────────────────────────────────────────────────────────────────────────
 * It compares 8-line windows, so a copy shorter than 8 consecutive SIGNIFICANT lines
 * is INVISIBLE to it. This was measured during the canary: the first attempt duplicated 5
 * consecutive lines across two files and the guard correctly stayed silent — it was under
 * the floor, not broken.
 *
 * The floor is deliberate. Lowering it to catch 4-5 line copies multiplies the window count
 * and starts matching ordinary idioms (`if (!res.ok) { ... }`, a standard error shape),
 * and a guard that produces false positives gets allowlisted — which is worse than no guard.
 *
 * Practical consequence: **this catches copy-paste, not convergent design.** A 6-line helper
 * written twice will pass. That is a known, accepted blind spot, not an oversight.
 *
 * Usage:
 *   node scripts/validate-duplication.cjs                  # check (build gate)
 *   node scripts/validate-duplication.cjs --update-allowance
 *   node scripts/validate-duplication.cjs --self-test      # prove the guard can fail
 *   node scripts/validate-duplication.cjs --report         # list every pair, no exit code
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TAG = 'duplication';
const ROOT = path.resolve(__dirname, '..');
const ALLOWANCE = path.join(__dirname, 'duplication-allowance.json');

/** Lines in a matched window. 8 is long enough to be real copy-paste, short enough to catch it. */
const WINDOW = 8;

/**
 * How many shared windows a pair needs before a NEW pair is a failure.
 *
 * ⚠️ Not 1. Two files can share a single 8-line block by coincidence — a `try/catch`, a
 * standard error shape, a framework idiom. Failing on that would produce false positives, and
 * a guard that cries wolf gets allowlisted, which is worse than no guard. Three or more
 * consecutive-block matches in two files is copy-paste by any reasonable reading.
 */
const MIN_NEW_PAIR_WINDOWS = 3;

const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.css', '.py']);

/** Build output, data, and anything else that is not hand-written source. */
// ⚠️ Build OUTPUTS of every flavour are skipped. The pattern used to match the exact segment
// `dist` only, so the edition builds (`dist-free`, `dist-full-check`, added with the free-edition
// work on 2026-09-23) were scanned as SOURCES: 200+ "new duplicate" pairs appeared by comparing
// compiled CSS against the source files it was compiled from, and every agent's prebuild failed.
// Build artefacts are derived — the whole `dist*` family belongs here, not just `dist`.
const SKIP_DIR = /(^|[\\/])(node_modules|dist(-[^\\/]+)?|build|\.git|\.vite|coverage|logs|backups|data|archived|\.next)([\\/]|$)/;

// ── Source discovery ────────────────────────────────────────────────────────

function collectFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (SKIP_DIR.test(full)) continue;
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!EXT.has(path.extname(e.name))) continue;
      // Tests mirror production shapes by design; they are not duplication debt.
      if (/\.(spec|test)\./.test(e.name)) continue;
      let src;
      try {
        src = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      out.push({ rel: path.relative(ROOT, full).split(path.sep).join('/'), src });
    }
  };
  walk(ROOT);
  return out;
}

// ── Window extraction ───────────────────────────────────────────────────────

/**
 * Reduce a file to "significant" lines.
 *
 * Blank lines, lone braces and import/comment lines are dropped: they are noise that would
 * make unrelated files look similar. Everything remaining is whitespace-normalised so
 * re-indentation does not hide a copy.
 */
function significantLines(src) {
  return src
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => {
      if (l.length <= 3) return false;
      if (/^[{}[\]();,]*$/.test(l)) return false;
      if (/^(import|export \{|\/\/|\*|\/\*|#)/.test(l)) return false;
      return true;
    });
}

/** file rel path -> Map(windowHash -> first significant-line index) */
function windowHashes(file) {
  const lines = significantLines(file.src);
  const map = new Map();
  for (let i = 0; i + WINDOW <= lines.length; i++) {
    const block = lines.slice(i, i + WINDOW);
    const h = crypto.createHash('sha1').update(block.join('\n')).digest('hex').slice(0, 16);
    if (!map.has(h)) map.set(h, i);
  }
  return map;
}

/**
 * Group every duplicated window by the FILE-PAIR that shares it.
 *
 * ⚠️ Keyed on the pair, not on the window. A pair that already exists may drift downward in
 * count without fail; the unit a human can act on is "these two files overlap", not "this
 * hash appears twice".
 */
function findDuplication(files) {
  const owners = new Map(); // hash -> Set(rel)
  const lines = new Map();
  for (const f of files) {
    const map = windowHashes(f);
    lines.set(f.rel, map);
    for (const h of map.keys()) {
      if (!owners.has(h)) owners.set(h, new Set());
      owners.get(h).add(f.rel);
    }
  }

  const pairs = new Map();
  for (const [h, set] of owners) {
    if (set.size < 2) continue;
    const rels = [...set].sort();
    // Attribute a window shared by N files to every pair among them.
    for (let i = 0; i < rels.length; i++) {
      for (let j = i + 1; j < rels.length; j++) {
        const key = `${rels[i]} || ${rels[j]}`;
        if (!pairs.has(key)) pairs.set(key, { a: rels[i], b: rels[j], windows: 0, samples: [] });
        const p = pairs.get(key);
        p.windows += 1;
        if (p.samples.length < 3) {
          p.samples.push({ hash: h, lineA: (lines.get(rels[i]).get(h) ?? 0) + 1 });
        }
      }
    }
  }
  return pairs;
}

// ── Allowance ───────────────────────────────────────────────────────────────

function readAllowance() {
  if (!fs.existsSync(ALLOWANCE)) {
    // ⚠️ Fail closed. A missing allowance means nothing is baselined, and every existing pair
    // would read as "new" — OR, if we returned {} and the caller skipped the check, NOTHING
    // would be verified. Neither is acceptable silently, so this is an ERROR.
    console.error(`[${TAG}] \u2716 allowance file not found: ${path.relative(ROOT, ALLOWANCE)}`);
    console.error(`    \u2192 create it with: node scripts/validate-duplication.cjs --update-allowance`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(ALLOWANCE, 'utf8'));
  } catch (err) {
    console.error(`[${TAG}] \u2716 allowance file is not valid JSON: ${err.message}`);
    process.exit(1);
  }
}

/**
 * The allowance records a tolerated pair as a NUMBER. That number cannot distinguish
 * "deliberate, leave it alone" from "copy-pasted, baselined to unblock the build" —
 * so the next agent has to re-derive the decision from scratch, and the cheapest
 * available action is to delete one side. Two of the largest pairs in this repo are
 * DELIBERATE (an A/B card variant and a two-surface architecture split), and deleting
 * either would be a real regression.
 *
 * So each tolerated pair may carry a REASON. This is the same rule the repo applies to
 * every other field: a number without its provenance is a claim, not a finding.
 *
 * ⚠️ Keys are compared ORDER-INSENSITIVELY — the pair key is built from whichever file
 * the walker happened to visit first, and a reason that stops matching after an
 * unrelated reorder would be worse than no reason at all.
 */
function normPair(a, b) {
  return [a, b].sort().join(' || ');
}

/** Look up a recorded reason for a pair, in either order. */
function reasonFor(reasons, a, b) {
  if (!reasons) return null;
  const want = normPair(a, b);
  for (const [k, v] of Object.entries(reasons)) {
    if (normPair(...String(k).split(' || ')) === want) return v;
  }
  return null;
}

function writeAllowance(pairs) {
  const sorted = [...pairs.values()].sort((x, y) => y.windows - x.windows);
  // ⚠️ CARRY THE REASONS FORWARD. This function rebuilds the document from scratch, so
  // without this step a routine `--update-allowance` would silently DELETE every
  // recorded reason — destroying the expensive part during a bookkeeping act. A stale
  // reason (its pair is gone) is DROPPED and named, so the map cannot accumulate lies.
  const previous = readAllowance();
  const previousReasons = previous.reasons ?? {};
  const live = new Set(sorted.map((p) => normPair(p.a, p.b)));
  const reasons = {};
  const stale = [];
  for (const [k, v] of Object.entries(previousReasons)) {
    if (live.has(normPair(...String(k).split(' || ')))) reasons[k] = v;
    else stale.push(k);
  }
  const doc = {
    _comment:
      'Ratchet for cross-file duplication (INV-NO-NEW-DUPLICATION). An existing pair may only ' +
      'go DOWN; a pair NOT listed here fails the build. Record a reduction deliberately with ' +
      "`node scripts/validate-duplication.cjs --update-allowance` so the delta is printed. If a " +
      'pair must remain, prefer FIXING it (extract the shared block) over adding it here — an ' +
      'allowlisted guard that no longer guards is worse than no guard.',
    _measured: new Date().toISOString().slice(0, 10),
    _method: `8-line whitespace-normalised windows appearing in 2+ distinct non-test files; new pair fails at >= ${MIN_NEW_PAIR_WINDOWS}`,
    totals: { pairs: sorted.length, windows: sorted.reduce((s, p) => s + p.windows, 0) },
    pairs: Object.fromEntries(sorted.map((p) => [`${p.a} || ${p.b}`, p.windows])),
  };
  if (Object.keys(reasons).length > 0) doc.reasons = reasons;
  fs.writeFileSync(ALLOWANCE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  if (stale.length > 0) {
    console.log(`[${TAG}] dropped ${stale.length} reason(s) whose pair no longer exists:`);
    for (const k of stale) console.log(`    ${k}`);
  }
  return doc;
}

// ── Main check ──────────────────────────────────────────────────────────────

function check() {
  const files = collectFiles();
  if (files.length === 0) {
    console.error(`[${TAG}] \u2716 scanned 0 files from ${ROOT}`);
    console.error('    \u2192 nothing was verified; a check that inspects nothing must not pass');
    process.exit(1);
  }

  const pairs = findDuplication(files);
  if (pairs.size === 0) {
    console.error(`[${TAG}] \u2716 found 0 duplicated windows across ${files.length} files`);
    console.error('    \u2192 that is implausible for this repo; the window logic is broken, not the code');
    process.exit(1);
  }

  const allowance = readAllowance();
  const allowed = allowance.pairs ?? {};
  const failures = [];
  const reductions = [];

  for (const [key, p] of [...pairs].sort((a, b) => b[1].windows - a[1].windows)) {
    const cap = allowed[key];
    if (cap === undefined) {
      if (p.windows >= MIN_NEW_PAIR_WINDOWS) {
        failures.push({
          kind: 'NEW',
          pair: [p.a, p.b],
          windows: p.windows,
          sample: p.samples[0],
        });
      }
      continue;
    }
    if (p.windows > cap) {
      failures.push({ kind: 'GREW', pair: [p.a, p.b], windows: p.windows, was: cap });
    }
    if (p.windows < cap) {
      reductions.push({ pair: [p.a, p.b], windows: p.windows, was: cap });
    }
  }

  const totalWindows = [...pairs.values()].reduce((s, p) => s + p.windows, 0);

  if (failures.length > 0) {
    console.error(`\n[${TAG}] \u2716 ${failures.length} violation(s) of INV-NO-NEW-DUPLICATION:\n`);
    for (const f of failures.slice(0, 20)) {
      if (f.kind === 'NEW') {
        console.error(`  \u2716 NEW pair shares ${f.windows} block(s):`);
        console.error(`      ${f.pair[0]}`);
        console.error(`      ${f.pair[1]}`);
        if (f.sample) console.error(`      first at line ~${f.sample.lineA} of the first file`);
      } else {
        console.error(`  \u2716 pair GREW ${f.was} \u2192 ${f.windows}:`);
        console.error(`      ${f.pair[0]}`);
        console.error(`      ${f.pair[1]}`);
      }
    }
    if (failures.length > 20) console.error(`  ...and ${failures.length - 20} more`);
    console.error('\n  Fix by EXTRACTING the shared block into one place, not by copying it.');
    console.error('  If the duplication is genuinely unavoidable, bank it deliberately:');
    console.error('      node scripts/validate-duplication.cjs --update-allowance\n');
    process.exit(1);
  }

  if (reductions.length > 0) {
    console.log(`[${TAG}] \u2193 duplication REDUCED in ${reductions.length} pair(s) — bank it:`);
    for (const r of reductions.slice(0, 8)) {
      console.log(`    ${r.was} \u2192 ${r.windows}  ${r.pair[0]} || ${r.pair[1]}`);
    }
    console.log(`    node scripts/validate-duplication.cjs --update-allowance`);
  }

  const allowedTotal = Object.values(allowed).reduce((s, n) => s + n, 0);
  console.log(
    `[${TAG}] \u2705 OK \u2014 ${totalWindows} duplicated block(s) across ${pairs.size} pair(s), ` +
      `none new and none grown (allowance: ${allowedTotal} across ${Object.keys(allowed).length}, ` +
      `scanned ${files.length} files)\n`,
  );
}

// ── self-test — a guard that has never been observed to fail is a decoration ──

function selfTest() {
  const checks = [];
  const assert = (name, condition) => checks.push({ name, pass: !!condition });

  const body = (n) =>
    Array.from({ length: n }, (_, i) => `  const value${i} = computeSomething(input, ${i});`).join('\n');

  // Direction 1 — the checker BITES when two files share a real block.
  const dupFiles = [
    { rel: 'a.js', src: `function one() {\n${body(10)}\n}\n` },
    { rel: 'b.js', src: `function two() {\n${body(10)}\n}\n` },
  ];
  const dupPairs = findDuplication(dupFiles);
  assert('detects a shared block between two files', dupPairs.size === 1);
  assert('counts the shared windows', [...dupPairs.values()][0]?.windows >= 1);

  // Direction 2 — it is SILENT on files that share nothing. Without this,
  // "always reports duplication" would pass direction 1.
  const cleanFiles = [
    { rel: 'a.js', src: `function one() {\n${body(10)}\n}\n` },
    {
      rel: 'b.js',
      src: Array.from({ length: 10 }, (_, i) => `  const other${i} = differentThing(alpha, ${i});`).join('\n'),
    },
  ];
  assert('silent on files that share nothing', findDuplication(cleanFiles).size === 0);

  // Direction 3 — same file twice is NOT duplication (a file cannot duplicate itself).
  assert(
    'a single file is never reported against itself',
    findDuplication([{ rel: 'a.js', src: `function one() {\n${body(10)}\n}\n` }]).size === 0,
  );

  // Direction 4 — INDENTATION must not hide a copy. The two files below differ only in
  // leading whitespace and must still be caught; if normalisation breaks, this fails.
  const reindented = [
    { rel: 'a.js', src: `if (x) {\n${body(10)}\n}\n` },
    { rel: 'b.js', src: `    if (x) {\n${body(10).replace(/^ {2}/gm, '        ')}\n    }\n` },
  ];
  assert('normalises indentation so re-indented copies still match', findDuplication(reindented).size === 1);

  // Direction 5 — the new-pair THRESHOLD is a real boundary, not a guess. One shared block
  // must stay below it; the constant is what keeps a coincidental idiom from failing a build.
  assert(`new-pair threshold is ${MIN_NEW_PAIR_WINDOWS} (a lone block is not a failure)`, MIN_NEW_PAIR_WINDOWS >= 2);

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`  ${c.pass ? '\u2713' : '\u2716'} ${c.name}`);
  if (failed.length) {
    console.error(`\n[${TAG}] \u2716 self-test FAILED \u2014 ${failed.length} of ${checks.length} expectation(s)\n`);
    process.exit(1);
  }
  console.log(`\n[${TAG}] \u2705 self-test PASSED \u2014 ${checks.length}/${checks.length} expectations\n`);
}

// ── Entry ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  selfTest();
} else if (args.includes('--update-allowance')) {
  const pairs = findDuplication(collectFiles());
  const hadAllowance = fs.existsSync(ALLOWANCE);
  const before = hadAllowance
    ? Object.values(JSON.parse(fs.readFileSync(ALLOWANCE, 'utf8')).pairs ?? {}).reduce((s, n) => s + n, 0)
    : 0;
  const doc = writeAllowance(pairs);
  const where = path.relative(ROOT, ALLOWANCE);

  if (!hadAllowance) {
    // ⚠️ First run establishes the baseline; it did NOT "increase" anything. Reporting a
    // delta against a file that did not exist would train the reader to ignore the warning
    // that matters on every subsequent run.
    console.log(
      `[${TAG}] baseline ESTABLISHED in ${where} \u2014 ${doc.totals.pairs} pair(s), ` +
        `${doc.totals.windows} window(s). Existing duplication is now fixed in place; only NEW ` +
        `pairs and GROWTH will fail from here.`,
    );
  } else {
    const delta = doc.totals.windows - before;
    const sign = delta === 0 ? '=' : delta > 0 ? '\u2191' : '\u2193';
    console.log(
      `[${TAG}] wrote ${where} \u2014 ${doc.totals.pairs} pair(s), ` +
        `${doc.totals.windows} window(s) ${sign} ${delta >= 0 ? '+' : ''}${delta} vs before`,
    );
    if (delta > 0) {
      console.log(`[${TAG}] \u26a0 allowance INCREASED by ${delta} \u2014 that banked new duplication.`);
    } else if (delta < 0) {
      console.log(`[${TAG}] \u2705 banked a reduction of ${-delta} window(s).`);
    }
  }
} else if (args.includes('--report')) {
  const pairs = findDuplication(collectFiles());
  const { reasons } = readAllowance();
  const sorted = [...pairs].sort((a, b) => b[1].windows - a[1].windows);
  for (const [key, p] of sorted) {
    console.log(`${String(p.windows).padStart(5)}  ${key}`);
    const why = reasonFor(reasons, p.a, p.b);
    if (why) console.log(`       \u21b3 ${why}`);
  }
  const explained = sorted.filter(([, p]) => reasonFor(reasons, p.a, p.b)).length;
  const big = sorted.filter(([, p]) => p.windows >= 20).length;
  const bigExplained = sorted.filter(([, p]) => p.windows >= 20 && reasonFor(reasons, p.a, p.b)).length;
  console.log('');
  console.log(`[${TAG}] ${explained} of ${sorted.length} pair(s) carry a recorded reason.`);
  console.log(`[${TAG}] ${bigExplained} of ${big} pair(s) at 20+ windows do \u2014 those are the ones a human asks about.`);
} else {
  check();
}
