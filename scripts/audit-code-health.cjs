#!/usr/bin/env node
/**
 * audit-code-health.cjs — measure the SHAPE of the source tree, and ratchet it so it cannot rot.
 *
 * © 2026 Ryan Bayne / FifeCIC · AGPL-3.0 · https://github.com/FifeCIC/Trading-Command-Suite
 *
 * WHY THIS EXISTS (owner direction, 2026-11-07)
 * ----------------------------------------------
 * *"I suspect the epic size of development will have created some messy files, maybe some
 * duplication, maybe theres redundant files etc. Is there a tool for checking the quality without
 * using up a lot of agentic AI tokens to examine the structure for poor design?"*
 *
 * Reading a tree for "poor design" costs an agent a fortune in tokens and produces an opinion.
 * Line counts, comment ratios, function spans and reachability produce NUMBERS, cost nothing, and
 * can be re-run after every change. That is the whole premise: **measure, do not opine.**
 *
 * ⚠️ THIS IS A SHAPE TOOL, NOT A BUG TOOL. It says a file is 4,491 lines with 23 functions over 60
 * and a 4% comment ratio. It does NOT say the file is wrong, and it never reads the logic. A large
 * well-documented file that does one job is not a defect — which is exactly why the thresholds below
 * exist as written.
 *
 * THE OWNER'S THRESHOLDS (verbatim, 2026-11-07)
 * ---------------------------------------------
 *   *"3000 to me seems like a lot. I would [be] creating a warning at around 1500 and additional
 *    warning at 2000. The only time I like seeing a 3000 line file of code is when it's well
 *    commented/documented and the code is very well separated into functions and clear arguments."*
 *
 *     ok        < 1,500 lines
 *     warn      1,500 – 1,999          plan a split
 *     high      2,000 – 2,999          should be decomposed
 *     critical  >= 3,000               ONLY tolerated when documented AND decomposed
 *     large-but-structured  >= 3,000 with comment ratio >= 12% AND no function over 60 lines
 *
 * ⚠️ `critical` is not "bad code". It is "the shape makes review and safe change expensive". The
 * exemption path is deliberately BOTH conditions, because either one alone is a lie: 3,000 lines of
 * prose comments around one 900-line function is not documented-and-decomposed.
 *
 * MODES
 * -----
 *   (default) / --report   print the findings, exit 0. Cheap. Use it any time.
 *   --write                regenerate docs/CODE-HEALTH.md + docs/code-health.json and RATIFY the
 *                          current state. Run it after fixing something, so the ratchet follows.
 *   --check                exit 1 if a file moved to a WORSE band than ratified, or a NEW unreached
 *                          module appeared. Deliberately does not fail on ordinary growth inside a
 *                          band — a guard that fires while you are working gets allowlisted, and an
 *                          allowlisted guard is worse than none.
 *   --stamp [--issue N] [--kind oversized|unreferenced|all]   DRY RUN: show the marker it would add
 *   --stamp ... --apply    write the marker into each offending file, so the NEXT agent to open that
 *                          file meets the work rather than having to run a report
 *   --self-test            prove every rule can FAIL, in both directions
 *
 * ⚠️ WHY THE MARKER IS `PLANNED IN #NNNN`. That marker already exists in this repo (see
 * decision-authority.instructions.md) and is greppable as a CLASS: `rg -n "PLANNED IN #"`. Inventing
 * a second marker class for code shape would split that one search into two, and the whole value of
 * the convention is that one search finds every known gap.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT MEASURED. Coupling, fan-in/fan-out, cyclomatic complexity, import
 * direction. Each needs a real parser to be trustworthy; a regex approximation would produce false
 * positives, and this repo has already learned what happens to a noisy guard. Reachability is
 * measured only as a NAME REFERENCE, which is stated as a caveat in the output rather than hidden.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['src', 'nest/src'];
const EXTS = new Set(['.js', '.jsx', '.ts', '.tsx']);

const THRESHOLDS = { warn: 1500, high: 2000, critical: 3000 };
const QUALITY = { minCommentRatio: 0.12, maxFunctionLines: 60 };

const MD_PATH = 'docs/CODE-HEALTH.md';
const JSON_PATH = 'docs/code-health.json';

/** Ratchet order. `large-but-structured` sits with `high`: tolerated, still large, still worth a split. */
const ORDER = { ok: 0, data: 0, warn: 1, 'large-but-structured': 2, high: 2, critical: 3 };

/**
 * Generated/lookup DATA is counted and REPORTED but never called logic debt.
 *
 * ⚠️ The reason is not "it is big so exempt it" — a 8,088-line data table and an 8,000-line service
 * are different problems with different fixes. A data file is fixed in its GENERATOR; a service is
 * fixed by decomposition. Lumping them together would send the next agent to the wrong file.
 * ⚠️ Every entry needs a reason. An allowlist without one is a place to hide.
 */
const DATA_FILES = new Map([
  ['src/data/qa-checklist.js', 'QA checklist entries — appended by the handoff batch tooling; fix the generator, not the file'],
  ['src/pages/architecture-framework.data.js', 'human-facing architecture page data — SLICE/route declarations, one line per fact'],
  ['src/core/architecture-reference.js', 'AI-readable architecture reference — a declaration table; its risk is DIVERGENCE from the page (guarded by validate-duplication), not decomposition'],
]);

/**
 * Modules that ARE reached through a mechanism a name scan cannot see.
 *
 * ⚠️ DELIBERATELY EMPTY TODAY. Every one of the 24 currently-unreferenced files is unresolved (#1228).
 * Pre-populating this map would silently convert a real finding into a false negative, which is the
 * failure mode this tool exists to catch. An entry here needs a NAMED mechanism, not a hunch.
 */
const REACHED_OTHERWISE = new Map([]);

const SKIP_FILE = /(^|[\\/])(main\.ts|main\.jsx|App\.jsx|index\.ts|vite-env\.d\.ts)$|\.(spec|test)\./;

// ── measurement ─────────────────────────────────────────────────────────────────────────────────

/** Remove comments and string bodies so braces in prose or text cannot unbalance the scan. */
function skeleton(line) {
  return line
    .replace(/\/\*.*?\*\//g, '')
    .replace(/\/\/.*$/, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

/** A line that STARTS a function or method body. Deliberately conservative. */
const DECL = new RegExp(
  '^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*[\\w$]*\\s*(?:<[^>]*>)?\\s*\\(' +
    '|^\\s*(?:export\\s+)?(?:const|let|var)\\s+[\\w$]+\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[\\w$]+)\\s*(?::[^=]+)?=>' +
    '|^\\s*(?:public|private|protected|static|readonly|async|get|set)\\s+[\\w$]+\\s*(?:<[^>]*>)?\\s*\\(' +
    '|^\\s*(?:export\\s+)?(?:async\\s+)?[A-Za-z_$][\\w$]*\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)\\s*(?::\\s*[^{;]+)?\\{\\s*$',
);
const CONTROL = /^\s*(?:if|for|while|switch|catch|else|do|try|finally|return|\}|\)|\])\b/;

/**
 * ⚠️ `class` is deliberately NOT a declaration here.
 *
 * Measured 2026-11-07 while writing this tool: including it reported `backtest.service.ts`'s longest
 * "function" as **3,792 lines** — that was the CLASS body. Every method inside it is short. A metric
 * that counts a class as one function turns the owner's "well separated into functions" test into a
 * constant failure for every large service, which is the false positive that gets a guard ignored.
 * Methods are measured individually instead; the class is just their container.
 */

/**
 * Span of the function declared at `start`, in lines.
 *
 * ⚠️ HEURISTIC, and stated as one. It walks brace depth from the declaration until depth returns to
 * zero. A declaration whose body never opens (an interface, a const holding a value) returns 0 and is
 * not counted — erring towards UNDER-reporting, because an over-report would send an agent to split a
 * function that was never long.
 */
function spanOf(lines, start) {
  let depth = 0;
  let opened = false;
  for (let j = start; j < lines.length && j < start + 4000; j++) {
    for (const ch of skeleton(lines[j])) {
      if (ch === '{') {
        depth += 1;
        opened = true;
      } else if (ch === '}') {
        depth -= 1;
        if (opened && depth <= 0) return j - start + 1;
      }
    }
    if (!opened && j > start + 6) return 0;
  }
  return 0;
}

function analyseFile(abs, rel) {
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  let commentLines = 0;
  let codeLines = 0;
  const spans = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.length === 0) continue;
    const isComment = inBlock || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
    if (isComment) commentLines += 1;
    else codeLines += 1;

    if (!inBlock && t.startsWith('/*') && !t.includes('*/')) inBlock = true;
    else if (inBlock && t.includes('*/')) inBlock = false;

    if (!isComment && DECL.test(lines[i]) && !CONTROL.test(lines[i])) {
      const span = spanOf(lines, i);
      if (span > 0) spans.push({ line: i + 1, span });
    }
  }

  const maxFunctionLines = spans.reduce((m, s) => Math.max(m, s.span), 0);
  return {
    path: rel,
    lines: lines.length,
    codeLines,
    commentLines,
    commentRatio: codeLines + commentLines === 0 ? 0 : commentLines / (codeLines + commentLines),
    maxFunctionLines,
    longFunctions: spans.filter((s) => s.span > QUALITY.maxFunctionLines).sort((a, b) => b.span - a.span),
  };
}

function bandOf(lines) {
  if (lines >= THRESHOLDS.critical) return 'critical';
  if (lines >= THRESHOLDS.high) return 'high';
  if (lines >= THRESHOLDS.warn) return 'warn';
  return 'ok';
}

/**
 * The verdict for one file. This is the ONLY place the exemption is decided.
 *
 * ⚠️ `>= 3,000` is not automatically a defect: the owner's own rule is that a large file is
 * acceptable when it is documented AND decomposed. Both conditions, not either.
 */
function verdictOf(a) {
  if (DATA_FILES.has(a.path)) return 'data';
  // ⚠️ A test suite is large because it holds many CASES, not because one function is unwieldy.
  // Banding it would flag the healthiest files in the tree, which is how a guard loses its audience.
  if (/\.(spec|test)\./.test(a.path)) return 'data';
  const band = bandOf(a.lines);
  if (band !== 'critical') return band;
  const documented = a.commentRatio >= QUALITY.minCommentRatio;
  const decomposed = a.maxFunctionLines <= QUALITY.maxFunctionLines;
  return documented && decomposed ? 'large-but-structured' : 'critical';
}

function listFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(p);
      } else if (EXTS.has(path.extname(e.name))) out.push(p);
    }
  };
  for (const r of rootDir ? [rootDir] : SCAN_ROOTS) walk(path.join(ROOT, r));
  return out;
}

/**
 * Files nothing else names.
 *
 * ⚠️ TWO REACHABILITY KEYS, because one alone produces false positives (measured 2026-11-07):
 *   • the FILE NAME — `import ... from './x.service'`
 *   • each EXPORTED SYMBOL — `import { X } from './whatever'`
 * The second was added after `snapshots.controller.ts` was reported unreferenced: it declares BOTH
 * the controller AND its `SnapshotsModule` in one file, and `AppModule` imports `SnapshotsModule`,
 * so the file is reached by a name that is not its filename. A finding a reader can disprove in ten
 * seconds is the fastest way to lose their trust in the whole report.
 *
 * ⚠️ STILL A NAME REFERENCE, not a module graph. `import.meta.glob`, a DI string token, or a
 * reflection lookup reads as unreferenced here and is not. That is why the finding is a QUESTION per
 * file (#1228: delete / wire up / keep+explain), never a delete list.
 */
const EXPORTED =
  /^\s*export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|enum|interface|type)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORTED_LIST = /^\s*export\s*\{([^}]+)\}/gm;

function exportedNames(text) {
  const names = new Set();
  for (const m of text.matchAll(EXPORTED)) names.add(m[1]);
  for (const m of text.matchAll(EXPORTED_LIST)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

function unreferenced(files, texts) {
  const blob = [...texts.values()].join('\n');
  const out = [];
  const countIn = (needle, hay) => hay.split(needle).length - 1;

  for (const f of files) {
    if (SKIP_FILE.test(f.rel)) continue;
    if (REACHED_OTHERWISE.has(f.rel)) continue;

    const own = texts.get(f.rel) ?? '';
    if (countIn(path.basename(f.rel, path.extname(f.rel)), blob) > countIn(path.basename(f.rel, path.extname(f.rel)), own)) {
      continue;
    }
    const reachedBySymbol = exportedNames(own).some((sym) => countIn(sym, blob) > countIn(sym, own));
    if (reachedBySymbol) continue;

    const base = path.basename(f.rel, path.extname(f.rel));
    if (base.length < 4) continue;
    out.push(f.rel);
  }
  return out;
}

function analyseTree(rootDir) {
  const abs = listFiles(rootDir);
  const files = abs.map((a) => {
    const rel = path.relative(ROOT, a).split(path.sep).join('/');
    return analyseFile(a, rel);
  });
  const texts = new Map(files.map((f) => [f.path, fs.readFileSync(path.join(ROOT, f.path), 'utf8')]));
  const refs = unreferenced(files.map((f) => ({ rel: f.path })), texts);
  for (const f of files) f.verdict = verdictOf(f);
  files.sort((a, b) => b.lines - a.lines);
  return { files, unreferenced: refs.sort() };
}

// ── reporting ───────────────────────────────────────────────────────────────────────────────────

const n = (x) => x.toLocaleString('en-GB');
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function findings(state) {
  return state.files.filter((f) => f.verdict !== 'ok' && ORDER[f.verdict] >= 1);
}

function report(state) {
  const f = findings(state);
  console.log(`\n[code-health] scanned ${n(state.files.length)} source file(s) across ${SCAN_ROOTS.join(' + ')}`);
  console.log(
    `[code-health] thresholds: warn ${n(THRESHOLDS.warn)} · high ${n(THRESHOLDS.high)} · ` +
      `critical ${n(THRESHOLDS.critical)} (tolerated only at >= ${pct(QUALITY.minCommentRatio)} comments ` +
      `and no function over ${QUALITY.maxFunctionLines} lines)\n`,
  );

  const byVerdict = {};
  for (const x of f) byVerdict[x.verdict] = (byVerdict[x.verdict] ?? 0) + 1;
  console.log(
    `  ${n(f.length)} file(s) need attention: ` +
      Object.entries(byVerdict)
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ') +
      `\n`,
  );

  const rows = f.length === 0 ? [] : f;
  for (const x of rows) {
    console.log(
      `  ${String(n(x.lines)).padStart(6)}  ${x.verdict.padEnd(20)} ${x.path}` +
        (x.verdict === 'data' ? '' : `  · comments ${pct(x.commentRatio)} · longest fn ${x.maxFunctionLines}`),
    );
  }

  // Exempt files are shown by name, not hidden: an exemption the reader cannot see is a cover-up.
  const exempt = state.files.filter((x) => x.verdict === 'data' && x.lines >= THRESHOLDS.warn);
  if (exempt.length > 0) {
    console.log(`\n  ${exempt.length} declared data/test file(s) above ${n(THRESHOLDS.warn)} lines — exempt, listed so the exemption is visible:`);
    for (const x of exempt) console.log(`     ${String(n(x.lines)).padStart(6)}  ${x.path}`);
  }

  console.log(`\n  ⚠️ NAME-REFERENCE SCAN, not a module graph: ${n(state.unreferenced.length)} file(s) are named nowhere else.`);
  for (const p of state.unreferenced) console.log(`     ${p}`);
  console.log('');
  return f;
}

// ── generated artefacts ────────────────────────────────────────────────────────────────────────

function mdFor(state) {
  const f = findings(state);
  const groups = new Map();
  for (const x of f) {
    if (!groups.has(x.verdict)) groups.set(x.verdict, []);
    groups.get(x.verdict).push(x);
  }
  const order = ['critical', 'high', 'warn', 'large-but-structured', 'data'];

  const sections = order
    .filter((k) => groups.has(k))
    .map((k) => {
      const rows = groups
        .get(k)
        .map(
          (x) =>
            `| \`${x.path}\` | ${n(x.lines)} | ${pct(x.commentRatio)} | ${x.maxFunctionLines} | ${x.longFunctions.length} |`,
        )
        .join('\n');
      return `### \`${k}\`\n\n| File | Lines | Comments | Longest fn | Fns over ${QUALITY.maxFunctionLines} |\n|---|---|---|---|---|\n${rows}\n`;
    })
    .join('\n');

  return `# CODE HEALTH

<!-- GENERATED FILE — do not edit. Regenerate: node scripts/audit-code-health.cjs --write -->

**Status:** active
**Category:** C (reference)
**Owner:** generated — do NOT edit by hand

Generated by \`scripts/audit-code-health.cjs\`. Numbers are a SNAPSHOT — re-run the tool for current
values. The RATCHET lives in \`docs/code-health.json\` and compares BANDS, not line counts, because
line counts change on every edit and a guard that fires during normal work gets allowlisted.

## The rule this file exists for

> "The only time I like seeing a 3000 line file of code is when it's well commented/documented and
> the code is very well separated into functions and clear arguments." — owner, 2026-11-07

| Band | Lines | Meaning |
|---|---|---|
| \`ok\` | < ${n(THRESHOLDS.warn)} | fine |
| \`warn\` | ${n(THRESHOLDS.warn)} – ${n(THRESHOLDS.high - 1)} | plan a split |
| \`high\` | ${n(THRESHOLDS.high)} – ${n(THRESHOLDS.critical - 1)} | should be decomposed |
| \`critical\` | >= ${n(THRESHOLDS.critical)} | only tolerated at >= ${pct(QUALITY.minCommentRatio)} comments AND no function over ${QUALITY.maxFunctionLines} lines |
| \`large-but-structured\` | >= ${n(THRESHOLDS.critical)} | meets BOTH conditions — reported, not a defect |
| \`data\` | any | generated/lookup data. Fixed in its GENERATOR, not by decomposition |

⚠️ This tool measures SHAPE, not correctness. It never reads the logic. A file here is not "wrong" —
it is expensive to review and risky to change.

## Files needing attention (${n(f.length)})

${sections || '_None._'}

## Unreferenced modules (${n(state.unreferenced.length)})

⚠️ **A name-reference scan, not a module graph.** A file loaded through \`import.meta.glob\` or a
registry string that does not contain its filename reads as unreferenced here and is not. Treat each
line as a QUESTION — delete / wire up / keep and explain — never as a delete list. Owner: #1228.

${state.unreferenced.map((p) => `- \`${p}\``).join('\n') || '_None._'}

## How to act on this

1. \`node scripts/audit-code-health.cjs --report\` — the current numbers, any time, no cost.
2. Fix something. Split by RESPONSIBILITY, not by line count.
3. \`node scripts/audit-code-health.cjs --write\` — re-bank. The ratchet follows your progress, so
   the same file can never silently drift back.
4. \`node scripts/audit-code-health.cjs --stamp --issue N --apply\` — put a \`PLANNED IN #N\` marker in
   each offending file, so the next agent to open it meets the work.
`;
}

function jsonFor(state) {
  return JSON.stringify(
    {
      generatedBy: 'scripts/audit-code-health.cjs',
      thresholds: THRESHOLDS,
      quality: QUALITY,
      files: state.files.map((f) => ({
        path: f.path,
        lines: f.lines,
        verdict: f.verdict,
        commentRatio: Number(f.commentRatio.toFixed(3)),
        maxFunctionLines: f.maxFunctionLines,
      })),
      unreferenced: state.unreferenced,
    },
    null,
    2,
  ) + '\n';
}

// ── modes ──────────────────────────────────────────────────────────────────────────────────────

function write(state) {
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, MD_PATH), mdFor(state));
  fs.writeFileSync(path.join(ROOT, JSON_PATH), jsonFor(state));
  console.log(`[code-health] wrote ${MD_PATH} and ${JSON_PATH} — current state RATIFIED.`);
  console.log('[code-health] a file may no longer move to a worse band without --write being run again.');
}

function check(state) {
  const p = path.join(ROOT, JSON_PATH);
  if (!fs.existsSync(p)) {
    console.error(`[code-health] ✖ ${JSON_PATH} is missing. Create the baseline: node scripts/audit-code-health.cjs --write`);
    process.exit(1);
  }
  const ratified = JSON.parse(fs.readFileSync(p, 'utf8'));
  const prev = new Map(ratified.files.map((f) => [f.path, f]));
  const problems = [];

  for (const f of state.files) {
    const was = prev.get(f.path);
    if (!was) {
      if (ORDER[f.verdict] >= 1) problems.push(`${f.path} is "${f.verdict}" (${n(f.lines)} lines) and was never ratified`);
      continue;
    }
    if (ORDER[f.verdict] > ORDER[was.verdict]) {
      problems.push(`${f.path} moved ${was.verdict} -> ${f.verdict} (${n(was.lines)} -> ${n(f.lines)} lines)`);
    }
  }

  for (const u of state.unreferenced) {
    if (!ratified.unreferenced.includes(u)) problems.push(`${u} is named by NOTHING and was never ratified`);
  }

  if (problems.length === 0) {
    const banned = state.files.filter((f) => ORDER[f.verdict] >= 1).length;
    console.log(`[code-health] ✅ OK — ${n(state.files.length)} files scanned, nothing got worse (${banned} already-ratified finding(s), ${n(state.unreferenced.length)} unreferenced)`);
    return;
  }
  console.error(`[code-health] ✖ ${problems.length} regression(s):`);
  for (const x of problems) console.error(`    ${x}`);
  console.error('[code-health] Fix the shape, or ratify deliberately: node scripts/audit-code-health.cjs --write');
  process.exit(1);
}

function markerFor(f, issue) {
  const head = `/* ── PLANNED IN #${issue} ──`;
  if (f.verdict === 'unreferenced') {
    return [
      head,
      ' * MISSING:  reachability. Nothing in src/ or nest/src/ names this file — no import, no route,',
      ' *           no dynamic load. Either it is dead code, or it is a capability nobody wired up, and',
      ' *           those two need opposite responses.',
      ' * TODAY:    found by the name-reference scan in scripts/audit-code-health.cjs (see',
      ' *           docs/CODE-HEALTH.md). Decide DELETE / WIRE UP / KEEP+explain, record it on the',
      ' *           issue, then re-bank: node scripts/audit-code-health.cjs --write',
      ' * WHEN BUILT: the file is either gone, or reachable and named by something.',
      ' * CODE-HEALTH-MARKER — written by scripts/audit-code-health.cjs; re-run it rather than editing.',
      ' */',
    ].join('\n');
  }
  return [
    head,
    ` * MISSING:  decomposition. Measured ${n(f.lines)} lines, ${f.longFunctions.length} function(s) over`,
    ` *           ${QUALITY.maxFunctionLines} lines (longest ${f.maxFunctionLines}), comment ratio ${pct(f.commentRatio)}.`,
    ' * TODAY:    one file carrying several responsibilities. Nothing here is known to be broken — the',
    ' *           shape makes review and safe change expensive.',
    ' * WHEN BUILT: split by RESPONSIBILITY (not by line count), prove behaviour is unchanged, then',
    ' *           re-bank: node scripts/audit-code-health.cjs --write',
    ' * CODE-HEALTH-MARKER — written by scripts/audit-code-health.cjs; re-run it rather than editing.',
    ' */',
  ].join('\n');
}

function stamp(state, issue, kind, apply) {
  if (!/^\d+$/.test(String(issue ?? ''))) {
    console.error('[code-health] --stamp needs --issue <number> — a marker that cites no issue is a comment, not a plan.');
    process.exit(1);
  }
  const targets = [];
  if (kind === 'oversized' || kind === 'all') {
    for (const f of state.files) {
      // ⚠️ `large-but-structured` is NOT stamped. It meets the owner's own test (documented AND
      // decomposed), so a marker saying "MISSING: decomposition" would be a false accusation in the
      // one place an agent is most likely to read it. It stays visible in docs/CODE-HEALTH.md.
      if (['warn', 'high', 'critical'].includes(f.verdict)) targets.push({ ...f });
    }
  }
  if (kind === 'unreferenced' || kind === 'all') {
    for (const p of state.unreferenced) targets.push({ path: p, verdict: 'unreferenced' });
  }
  if (targets.length === 0) {
    console.log('[code-health] nothing to stamp.');
    return;
  }

  let wrote = 0;
  for (const t of targets) {
    const abs = path.join(ROOT, t.path);
    const text = fs.readFileSync(abs, 'utf8');
    const marker = markerFor(t, issue);
    let next;
    const existing = text.match(/\/\* ── PLANNED IN #\d+ ──[\s\S]*?CODE-HEALTH-MARKER[\s\S]*?\*\//);
    if (existing) {
      next = text.replace(existing[0], marker);
    } else {
      const lines = text.split(/\r?\n/);
      const at = lines[0] && lines[0].startsWith('#!') ? 1 : 0;
      next = [...lines.slice(0, at), marker, '', ...lines.slice(at)].join('\n');
    }
    if (next === text) {
      console.log(`  = ${t.path} (marker already current)`);
      continue;
    }
    if (apply) {
      fs.writeFileSync(abs, next);
      wrote += 1;
      console.log(`  ✎ ${t.path}`);
    } else {
      console.log(`  ~ ${t.path} (would be stamped)`);
    }
  }
  console.log(
    apply
      ? `\n[code-health] stamped ${wrote} file(s) with PLANNED IN #${issue}. Re-bank with --write — the marker adds lines.`
      : `\n[code-health] DRY RUN — ${targets.length} target(s). Add --apply to write.`,
  );
}

// ── self-test ──────────────────────────────────────────────────────────────────────────────────

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-health-'));
  const cases = [];
  const check1 = (name, cond, detail) => cases.push({ name, ok: !!cond, detail });

  const mk = (rel, body) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    return analyseFile(p, rel);
  };

  const filler = (n2, txt = 'const pad = 1;') => Array.from({ length: n2 }, () => txt).join('\n');

  try {
    // 1 — band boundaries, both sides of every threshold.
    for (const [lines, want] of [
      [1499, 'ok'],
      [1500, 'warn'],
      [1999, 'warn'],
      [2000, 'high'],
      [2999, 'high'],
    ]) {
      check1(`band at ${lines} lines is "${want}"`, bandOf(lines) === want, `got ${bandOf(lines)}`);
    }

    // 2 — 3,000+ with NOTHING documented or decomposed must be critical.
    const bad = mk('bad.ts', filler(3100));
    check1('3,100 lines, no comments, no long fns -> critical', verdictOf(bad) === 'critical', verdictOf(bad));

    // 3 — 3,000+ documented AND decomposed is TOLERATED (the owner's exemption).
    const good = mk(
      'good.ts',
      filler(3100, '/** documented line for the exemption case */\nconst pad = 1;'),
    );
    check1('3,100 lines, 50% comments, short fns -> large-but-structured', verdictOf(good) === 'large-but-structured', verdictOf(good));

    // 4 — the exemption needs BOTH conditions, not either.
    //     Documented, but carrying one 200-line function: the second condition is absent.
    const huge = ['function monster() {'];
    for (let i = 0; i < 200; i++) huge.push('  const y' + i + ' = 1;');
    huge.push('}');
    const documentedOnly = mk(
      'doc-only.ts',
      [...Array.from({ length: 500 }, () => '// a documented line'), ...huge, filler(2400)].join('\n'),
    );
    check1(
      'documented but one 200-line function still -> critical',
      verdictOf(documentedOnly) === 'critical',
      `${verdictOf(documentedOnly)} (maxFn ${documentedOnly.maxFunctionLines}, comments ${pct(documentedOnly.commentRatio)})`,
    );

    // 5 — function span measurement, against a KNOWN length.
    const fnBody = ['function longOne() {'];
    for (let i = 0; i < 100; i++) fnBody.push('  const x' + i + ' = 1;');
    fnBody.push('}');
    const measured = mk('fn.ts', fnBody.join('\n'));
    check1(
      'a 102-line function is measured within 2 lines',
      Math.abs(measured.maxFunctionLines - 102) <= 2,
      `got ${measured.maxFunctionLines}`,
    );

    // 6 — braces inside strings and comments must not end a function early.
    const tricky = mk(
      'tricky.ts',
      ['function f() {', '  const s = "}";', '  // closing brace in a comment }', '  return s;', '}'].join('\n'),
    );
    check1('a "}" inside a string does not truncate the span', tricky.maxFunctionLines >= 4, `got ${tricky.maxFunctionLines}`);

    // 7 — data files are classified as data, never as logic debt.
    const dataCase = mk('data.ts', filler(3200));
    DATA_FILES.set('data.ts', 'self-test fixture');
    check1('a declared data file is "data"', verdictOf(dataCase) === 'data', verdictOf(dataCase));
    DATA_FILES.delete('data.ts');

    // 8 — reachability, BOTH directions, and via BOTH keys.
    mk('used.ts', 'export const usedThing = 1;');
    mk('lonely.ts', 'export const lonelyThing = 1;');
    mk('consumer.ts', "import { usedThing } from './used';\nconsole.log(usedThing);");
    // A file reached only by an EXPORTED SYMBOL, not by its filename — the snapshots.controller case.
    mk(
      'module-and-controller.ts',
      'export class WidgetController {}\nexport class WidgetModule {}',
    );
    mk('app.ts', "import { WidgetModule } from './module-and-controller';\nexport const boot = WidgetModule;");
    const names = ['used.ts', 'lonely.ts', 'consumer.ts', 'module-and-controller.ts', 'app.ts'];
    const texts = new Map(names.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
    const refs = unreferenced(
      names.map((rel) => ({ rel })),
      texts,
    );
    check1('a module named by an importer is NOT reported', !refs.includes('used.ts'), refs.join(','));
    check1('a module named by nothing IS reported', refs.includes('lonely.ts'), refs.join(','));
    check1(
      'a file reached only by its EXPORTED SYMBOL is NOT reported',
      !refs.includes('module-and-controller.ts'),
      refs.join(','),
    );

    // 9 — the ratchet accepts ordinary growth but rejects a band change.
    check1('growing within a band is not a regression', ORDER[bandOf(1600)] === ORDER[bandOf(1900)]);
    check1('crossing a threshold IS a regression', ORDER[bandOf(1999)] < ORDER[bandOf(2000)]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`  ${c.ok ? '✅' : '✖ '} ${c.name}${c.ok ? '' : '  <-- ' + c.detail}`);
  if (failed.length > 0) {
    console.error(`\n[code-health] ✖ SELF-TEST FAILED — ${failed.length} of ${cases.length}`);
    process.exit(1);
  }
  console.log(`\n[code-health] ✅ self-test: ${cases.length} cases — thresholds, the both-conditions exemption, span measurement, reachability both directions, and the ratchet all observed to behave.`);
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  selfTest();
} else if (args.includes('--stamp')) {
  const issue = args[args.indexOf('--issue') + 1];
  const kindIdx = args.indexOf('--kind');
  const kind = kindIdx >= 0 ? args[kindIdx + 1] : 'all';
  if (!['oversized', 'unreferenced', 'all'].includes(kind)) {
    console.error('[code-health] --kind must be oversized | unreferenced | all');
    process.exit(1);
  }
  stamp(analyseTree(), issue, kind, args.includes('--apply'));
} else {
  const state = analyseTree();
  if (args.includes('--write')) write(state);
  else if (args.includes('--check')) check(state);
  else report(state);
}
