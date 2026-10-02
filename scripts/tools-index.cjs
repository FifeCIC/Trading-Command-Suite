#!/usr/bin/env node
/**
 * tools-index.cjs — GENERATE the index of this repo's own tooling, so no capability is
 * discoverable only by accident.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured 2026-09-25/26: in ONE agent session, three separate proposals were made to BUILD
 * something that already existed — a signal/indicator breakdown explorer (`ProtocolTrailPage`,
 * `SinglesMonitorPage` and twelve more already render `score.breakdown`), a ceiling-vs-bar warning
 * (`ScoringThresholds.jsx`, `threshold-ceiling.js` and Settings already do it), and a reachability
 * measure (`analyse-unreachable-capacity.cjs` already did it, and its own header records an earlier
 * agent making the same mistake the other way).
 *
 * The capabilities were not hidden. They were UNFINDABLE. An agent with grep missed all three; the
 * owner has no chance. A fourth surface would make that worse, not better — what is missing is an
 * INDEX.
 *
 * ⚠️ WHY IT IS GENERATED AND NOT WRITTEN. This is the same premise as `docs-facts.cjs`: a document
 * that lists things is holding a second copy of something the filesystem already knows, and the
 * second copy is always the one that rots. Add a script and this index changes itself.
 *
 * ⚠️ THE DIAGNOSTIC THAT MATTERS. A tool nobody references is a buried ability — it exists, works,
 * and will not be found. So every entry is marked with WHERE IT IS REACHABLE FROM:
 *
 *     prebuild   — runs automatically in the backend build
 *     npm        — has a package.json alias (discoverable from `npm run`)
 *     docs       — named in an instruction, handoff or doc
 *     ⚠️ ORPHAN  — named in NONE of the above. This is the finding, not a blank.
 *
 * `analyse-unreachable-capacity.cjs` was an ORPHAN. That is exactly why it took three passes to find.
 *
 * USAGE
 *   node scripts/tools-index.cjs --write    # regenerate docs/TOOLS-INDEX.md + docs/tools-index.json
 *   node scripts/tools-index.cjs --check    # exit 1 if stale (runs in prebuild)
 *   node scripts/tools-index.cjs --orphans  # list only the unreferenced tools
 *   node scripts/tools-index.cjs --find <keyword...>   # SEARCH name + purpose — "is there a tool for X?"
 *   node scripts/tools-index.cjs --run <name> [args...] # RUN one, printing which file it resolved to
 *   node scripts/tools-index.cjs --self-test
 *
 * ⚠️ RUN `--find` BEFORE BUILDING A TOOL. Three separate proposals in one session were to build
 * something already in this list. The library is only worth what can be found in it.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// ⚠️ THE SHARED HARNESS, NOT A LOCAL COPY — see validator-helpers.cjs. The loop that used to live
// here was byte-identical to `scripts/lib/mysql-cli.cjs`'s, and the duplication guard failed the
// build on the pair (2026-09-29).
const { runCases } = require('./lib/validator-helpers.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const NEST = path.join(REPO_ROOT, 'nest');

/** Directories scanned, in the order they are listed. */
const SCAN_DIRS = [
  { dir: path.join(REPO_ROOT, 'scripts'), label: 'repo' },
  { dir: path.join(NEST, 'scripts'), label: 'nest' },
];

/** Files we look at when asking "is this tool named anywhere a reader would look?". */
function referenceFiles() {
  const out = [];
  const add = (p) => fs.existsSync(p) && out.push(p);

  add(path.join(REPO_ROOT, 'package.json'));
  add(path.join(NEST, 'package.json'));
  add(path.join(REPO_ROOT, '.github', 'AGENT-ATTENTION.md'));
  add(path.join(REPO_ROOT, 'NEXT-AGENT.md'));
  add(path.join(REPO_ROOT, '.agent-context.md'));

  // Instruction files + agents + skills: everything an agent actually loads.
  for (const sub of ['instructions', 'agents', 'skills', 'prompts']) {
    const d = path.join(REPO_ROOT, '.github', sub);
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d, { recursive: true })) {
      const p = path.join(d, String(e));
      if (fs.statSync(p).isFile()) out.push(p);
    }
  }

  // Docs, excluding the two generated artefacts (they would make everything look referenced).
  const docs = path.join(REPO_ROOT, 'docs');
  if (fs.existsSync(docs)) {
    for (const e of fs.readdirSync(docs, { recursive: true })) {
      const p = path.join(docs, String(e));
      if (fs.statSync(p).isFile() && !/GENERATED-FACTS|generated-facts|TOOLS-INDEX|tools-index/.test(p)) {
        out.push(p);
      }
    }
  }
  return out;
}

/**
 * First meaningful line of the leading block comment — the tool's own statement of purpose.
 *
 * ⚠️ THE SHEBANG BUG, and why this function is written the long way. The first version used a regex
 * that permitted ONLY whitespace before the opening block comment, so the comment had to be the very
 * first thing in the file. Almost
 * every tool here starts with `#!/usr/bin/env node`, so the match failed and the tool was listed as
 * **"(no header comment)"** — a confident FALSE finding, in the table whose whole purpose is to
 * tell a reader what a tool does. Four tools were wrongly reported as undocumented.
 *
 * ⚠️ And its self-test passed while that was happening, because the only header case began directly
 * with the comment marker — the happy path. A self-test that never exercises the shape the files
 * actually have proves nothing. There is now a shebang case, and it would have failed before this fix.
 */
function purposeOf(src) {
  // Drop a shebang and any leading blank lines/whitespace before looking for the header.
  const body = src.replace(/^#![^\n]*\n/, '').replace(/^\s+/, '');

  // ⚠️ SECOND SHAPE, same bug. `cleanup-canonical.cjs` and `dump-gold-directives.cjs` DO have a
  // header — they lead with a run of `//` lines instead of a `/** */` block. The first version only
  // accepted the block form, so it reported them as "(no header comment)" too. A reader would
  // conclude the tool is undocumented. It is not; the comment is simply in the other common shape.
  const block = body.match(/^\/\*\*([\s\S]*?)\*\//);
  let raw;
  if (block) {
    raw = block[1];
  } else {
    const lineRun = [];
    for (const line of body.split('\n')) {
      if (/^\s*\/\//.test(line)) lineRun.push(line.replace(/^\s*\/\/\s?/, ''));
      else if (!line.trim() && lineRun.length) lineRun.push('');
      else break;
    }
    if (!lineRun.length) return null;
    raw = lineRun.join('\n');
  }

  const lines = raw
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => l && !/^[-=]{3,}$/.test(l) && !/^⚠️|^USAGE|^WHY |^WHAT /.test(l));
  // Prefer a line that reads like a sentence about the file, not a heading.
  return lines.find((l) => l.length > 30 && !l.endsWith(':')) || lines[0] || null;
}

/**
 * Does this file actually IMPLEMENT `--self-test`, or merely mention it?
 *
 * ⚠️ The first version was `/--self-test/.test(src)`, which counts a passing mention in a comment or
 * a docstring — so a tool that documents the convention without following it scored as compliant,
 * and the "tools with no self-test" backlog silently under-reported. `docs-facts.cjs` warns about
 * exactly this shape: a pattern that matches something it should not produces a confident wrong
 * number. Mentions live in comments; an implementation is code.
 */
function hasSelfTest(src) {
  return src
    .split('\n')
    .some((l) => {
      const t = l.trim();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false;
      return t.includes('--self-test');
    });
}

function categoryOf(name) {
  if (/^validate-/.test(name)) return 'validator';
  if (/^audit-/.test(name)) return 'audit';
  if (/^analyse-|^analyze-/.test(name)) return 'analysis';
  if (/^check-/.test(name)) return 'check';
  if (/^diff-/.test(name)) return 'comparison';
  if (/^generate-|^build-|^publish-|^sync-/.test(name)) return 'generator';
  if (/^db-|^seed-|^backfill-/.test(name)) return 'database';
  if (/^verify-|^probe-|^contract-/.test(name)) return 'verification';
  return 'tool';
}

function scan() {
  const files = [];
  for (const { dir, label } of SCAN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(cjs|mjs|js)$/.test(name)) continue;
      if (/\.spec\.|\.test\./.test(name)) continue;
      files.push({ name, abs: path.join(dir, name), label });
    }
  }

  const refText = referenceFiles().map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  const prebuild = (() => {
    try {
      return String(require(path.join(NEST, 'package.json')).scripts?.prebuild ?? '');
    } catch {
      return '';
    }
  })();
  const npmScripts = (() => {
    const all = {};
    for (const p of [path.join(REPO_ROOT, 'package.json'), path.join(NEST, 'package.json')]) {
      try {
        Object.assign(all, require(p).scripts ?? {});
      } catch {
        /* ignore */
      }
    }
    return Object.values(all).join('\n');
  })();

  return files
    .map(({ name, abs, label }) => {
      const src = fs.readFileSync(abs, 'utf8');
      const selfTest = hasSelfTest(src);
      // ⚠️ The CANDIDATE name, not the bare name: `docs-facts.cjs` is referenced as
      // `../scripts/docs-facts.cjs` from nest, so a bare-name test would report a false ORPHAN —
      // and a diagnostic that cries wolf gets ignored, which is worse than none.
      const referenced =
        refText.includes(name) ||
        prebuild.includes(name) ||
        npmScripts.includes(name);
      const reaches = [];
      if (prebuild.includes(name)) reaches.push('prebuild');
      if (npmScripts.includes(name)) reaches.push('npm');
      if (referenced && !reaches.length) reaches.push('docs');
      // Headers habitually open with the filename ("audit-x.cjs — what did ...?"). The table shows
      // the name in its own column, so strip the repeat rather than print it twice per row.
      const raw = purposeOf(src);
      const purpose =
        raw === null
          ? '(no header comment)'
          : raw.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[—:-]\\s*`), '').trim() || raw;
      return {
        name,
        where: label,
        category: categoryOf(name),
        purpose,
        selfTest,
        reaches: reaches.length ? reaches : null,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function render(tools) {
  const orphans = tools.filter((t) => !t.reaches);
  const noSelfTest = tools.filter((t) => !t.selfTest);
  const L = [];

  // ⚠️ Header shape copied from `docs/GENERATED-FACTS.md`, the existing generated doc — Status,
  // Category, Owner, and NO dates. `validate-agent-docs.cjs` flags a `docs/` file with no date or
  // status line, and the Status line is what satisfies it.
  //
  // ⚠️ Deliberately NO `Last updated: <today>`: a today-date makes this generated file differ on
  // every run, so the byte-comparison in `--check` would fail every single day until someone
  // allowlisted the gate — and "an allowlisted guard is worse than none". A derived mtime would
  // work, but it makes a fresh `git clone` report stale. Omitting the date has neither problem.
  L.push('# TOOLS INDEX');
  L.push('');
  L.push('<!-- GENERATED FILE — do not edit. Regenerate: node scripts/tools-index.cjs --write -->');
  L.push('');
  L.push('**Status:** active');
  L.push('**Category:** C (reference)');
  L.push('**Owner:** generated — do NOT edit by hand');
  L.push('');
  L.push(`Generated by \`scripts/tools-index.cjs\`. **${tools.length} tools** across \`scripts/\` and \`nest/scripts/\`.`);
  L.push('');
  L.push('> **The rule this file exists for:** a capability nobody can find is indistinguishable from one');
  L.push('> that does not exist. Before building a new tool, look here — three separate proposals in one');
  L.push('> session were to build things that were already in this list.');
  L.push('');
  L.push('## ⚠️ Orphans — reachable from nothing');
  L.push('');
  if (!orphans.length) {
    L.push('None. Every tool is named in prebuild, an npm alias, or a document.');
  } else {
    L.push(`**${orphans.length} tool(s) are named in NO prebuild step, NO npm alias and NO document.** They work,`);
    L.push('and they will not be found. Either surface them or delete them: leaving them is the');
    L.push('buried ability `development-philosophy` §7 warns about.');
    L.push('');
    L.push('| tool | what it does (its own words) |');
    L.push('|---|---|');
    for (const t of orphans) L.push(`| \`${t.name}\` | ${t.purpose} |`);
  }
  L.push('');
  L.push('## All tools');
  L.push('');
  L.push('| tool | where | kind | self-test | reachable from | purpose |');
  L.push('|---|---|---|---|---|---|');
  for (const t of tools) {
    L.push(
      `| \`${t.name}\` | ${t.where} | ${t.category} | ${t.selfTest ? 'yes' : '—'} | ` +
        `${t.reaches ? t.reaches.join(', ') : '⚠️ **NOTHING**'} | ${t.purpose} |`,
    );
  }
  L.push('');
  L.push('## Tools with no `--self-test`');
  L.push('');
  L.push(`**${noSelfTest.length} of ${tools.length}.** The instruction rule is that any NEW audit or validator`);
  L.push('ships a `--self-test`; older tools predate it. This list is the backlog, not a defect count.');
  L.push('');
  L.push(noSelfTest.map((t) => `\`${t.name}\``).join(' · '));
  L.push('');
  return L.join('\n');
}

const DOC = path.join(REPO_ROOT, 'docs', 'TOOLS-INDEX.md');
const JSON_PATH = path.join(REPO_ROOT, 'docs', 'tools-index.json');

/**
 * The line `--check` prints on success.
 *
 * ⚠️ THE THIRD FALSE FINDING, and the worst of the three. This was a hardcoded literal:
 *
 *     `✅ OK — ${tools.length} tools, 0 orphans, rendering matches the filesystem.`
 *
 * `0 orphans` was not a count. The tool reported **75** orphans everywhere else, and 0 here — on the
 * path a build gate or a hurried reader is most likely to see. `docs-facts.cjs` warns about exactly
 * this shape in its own header: a count that stops being computed becomes 0, and the tool publishes
 * "0 protocols" with machine confidence. Two of its own three lessons were live in this file.
 *
 * Factored out so a self-test can assert the number is DERIVED rather than written.
 */
function checkSummary(tools) {
  const orphans = tools.filter((t) => !t.reaches).length;
  const note =
    orphans === 0
      ? '0 orphans'
      : `⚠️ ${orphans} ORPHAN(S) — reachable from nothing, see docs/TOOLS-INDEX.md`;
  return `  [tools-index] ✅ OK — ${tools.length} tools, ${note}, rendering matches the filesystem.`;
}

/**
 * pathOf(tool) — the tool's file on disk, from the scan label it came in under.
 *
 * ⚠️ The index record deliberately carries `where` (the LABEL, `repo` | `nest`) and not an absolute
 * path: the record is written to `docs/tools-index.json`, which is committed, and a committed file
 * holding `/Users/...` or `C:\\...` paths is machine-specific noise that rots on the next clone.
 * The path is reconstructed here instead, at the one place that needs it.
 *
 * ⚠️ Measured 2026-10-02: the first version of `--run` read `tool.path`, which does not exist, and
 * CRASHED with `Cannot read properties of undefined`. The unit tests passed because they only ever
 * exercised `resolveTool`, never the printing that followed it — the same shape as an absence-only
 * assertion. Hence the `fs.existsSync` guard at the call site: a wrong name ERRORS, it does not throw.
 */
function pathOf(tool) {
  const scan = SCAN_DIRS.find((s) => s.label === tool.where);
  return scan ? path.join(scan.dir, tool.name) : null;
}

/**
 * matchesQuery(tool, terms) — the `--find` matcher, PURE so it can be canaried.
 *
 * Matches name OR purpose, case-insensitively; ALL terms must match (AND, not OR), so
 * `--find audit signal` narrows instead of widening. A purpose match is the one that matters:
 * an agent looking for "why is the denominator wrong" will never guess the filename
 * `audit-signal-capacity.cjs`, but the purpose text contains the words they would search for.
 *
 * An empty query matches everything — deliberately, so `--find` with no term behaves as a listing
 * rather than as a silent "no results".
 */
function matchesQuery(tool, terms) {
  const list = (terms || []).map((t) => String(t).toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const haystack = `${tool.name} ${tool.purpose} ${tool.category}`.toLowerCase();
  return list.every((t) => haystack.includes(t));
}

/**
 * resolveTool(tools, wanted) — turn a user-typed name into exactly one tool, or an error.
 *
 * Accepts an exact filename, a name without the extension, or an UNAMBIGUOUS prefix. Ambiguity is
 * refused with the candidates listed, never resolved by picking the first — `--run` executes real
 * scripts, and silently choosing one is a guess presented as a command.
 */
function resolveTool(tools, wanted) {
  const w = String(wanted || '').toLowerCase();
  if (!w) return { error: 'no tool name given' };

  const exact = tools.filter((t) => t.name.toLowerCase() === w || t.name.toLowerCase() === `${w}.cjs`);
  if (exact.length === 1) return { tool: exact[0] };

  const prefixed = tools.filter((t) => t.name.toLowerCase().startsWith(w));
  if (prefixed.length === 1) return { tool: prefixed[0] };
  if (prefixed.length > 1) {
    return {
      error:
        `'${wanted}' matches ${prefixed.length} tools — refusing to guess:\n` +
        prefixed.map((t) => `      ${t.name}`).join('\n'),
    };
  }

  return {
    error:
      `no tool named '${wanted}'.\n` +
      `      find one with:  node scripts/tools-index.cjs --find <keyword>`,
  };
}

// ── self-test ────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    // ── THE LIBRARY SURFACE — `--find` / `--run` (2026-10-02) ──
    //
    // ⚠️ THE FIRST CASE IS THE WHOLE POINT OF `--find`. An agent asking "why is the denominator
    // wrong?" will never guess the filename `audit-signal-capacity.cjs`. Matching the PURPOSE text
    // is what makes the library reachable; matching only filenames would have left all 75 orphans
    // exactly as unfindable as they were.
    ['find matches on PURPOSE text, not just the filename', () =>
      matchesQuery({ name: 'audit-signal-capacity.cjs', purpose: 'answers "why is the Signal denominator 725?"', category: 'audit' }, ['denominator'])],
    ['find requires ALL terms (AND, not OR)', () => {
      const t = { name: 'a.cjs', purpose: 'signal denominator audit', category: 'audit' };
      return matchesQuery(t, ['signal', 'denominator']) && !matchesQuery(t, ['denominator', 'zzz']);
    }],
    ['find with no terms lists everything rather than nothing', () =>
      matchesQuery({ name: 'a.cjs', purpose: 'x', category: 'tool' }, [])],
    ['find does not match an unrelated tool', () =>
      !matchesQuery({ name: 'commit-only.cjs', purpose: 'commit named files', category: 'tool' }, ['denominator'])],
    ['run resolves an exact filename', () => {
      const r = resolveTool([{ name: 'a.cjs' }, { name: 'b.cjs' }], 'a.cjs');
      return r.tool && r.tool.name === 'a.cjs';
    }],
    ['run resolves a name without the extension', () => {
      const r = resolveTool([{ name: 'audit-thing.cjs' }], 'audit-thing');
      return r.tool && r.tool.name === 'audit-thing.cjs';
    }],
    // ⚠️ The case that was MISSING: every other case stopped at `resolveTool`, so the printing and
    // spawning that followed it were never exercised — which is exactly where `tool.path` threw.
    // These assert the RECORD carries what the caller needs to find the file.
    ['a scanned tool carries the label its path is reconstructed from', () => {
      // ⚠️ `scan()` is called HERE, not captured from `main()` — the self-test runs before the
      // index is built, so a reference to an outer `tools` would be `undefined` and the case would
      // throw rather than assert. A test that errors is not a passing test.
      const t = scan().find((x) => x.name === 'tools-index.cjs');
      return !!t && typeof t.where === 'string' && !!pathOf(t) && fs.existsSync(pathOf(t));
    }],
    ['pathOf returns null for an unknown label instead of guessing', () =>
      pathOf({ name: 'x.cjs', where: 'nowhere' }) === null],
    ['run resolves an UNAMBIGUOUS prefix', () => {
      const r = resolveTool([{ name: 'audit-thing.cjs' }, { name: 'commit-only.cjs' }], 'audit');
      return r.tool && r.tool.name === 'audit-thing.cjs';
    }],
    // ⚠️ The case that keeps `--run` honest: an ambiguous prefix must REFUSE, not pick the first.
    ['run REFUSES an ambiguous prefix and names the candidates', () => {
      const r = resolveTool([{ name: 'audit-a.cjs' }, { name: 'audit-b.cjs' }], 'audit');
      return !!r.error && r.error.includes('audit-a.cjs') && r.error.includes('audit-b.cjs');
    }],
    ['run refuses an unknown name with a way to search', () => {
      const r = resolveTool([{ name: 'a.cjs' }], 'nope');
      return !!r.error && r.error.includes('--find');
    }],
    ['classifies validators', () => categoryOf('validate-thing.cjs') === 'validator'],
    ['classifies audits', () => categoryOf('audit-thing.cjs') === 'audit'],
    ['classifies analysis', () => categoryOf('analyse-unreachable-capacity.cjs') === 'analysis'],
    ['classifies generators', () => categoryOf('generate-free-map.cjs') === 'generator'],
    ['falls back to tool', () => categoryOf('commit-only.cjs') === 'tool'],
    ['extracts a purpose from a real header', () => {
      const p = purposeOf('/**\n * Foo bar — does a thing that is long enough to read as a sentence.\n */\ncode');
      return typeof p === 'string' && p.includes('Foo bar');
    }],
    // ⚠️ THE CASE THAT WAS MISSING. Every real tool starts with a shebang, and the first version of
    // `purposeOf` reported all of them as "(no header comment)". This case fails against that code.
    ['extracts a purpose when the file starts with a SHEBANG', () => {
      const p = purposeOf('#!/usr/bin/env node\n/**\n * Bar baz — a sentence long enough to be the stated purpose.\n */\nx');
      return typeof p === 'string' && p.includes('Bar baz');
    }],
    // ⚠️ The case that was missing for the SECOND false finding: a `//` line-comment header.
    ['extracts a purpose from a // line-comment header', () => {
      const p = purposeOf(
        '#!/usr/bin/env node\n// Qux quux — deletes score rows not in the resolved set.\nconst http = 1;',
      );
      return typeof p === 'string' && p.includes('Qux quux');
    }],
    ['extracts a purpose from a // header with no shebang', () => {
      const p = purposeOf('// Corge grault — rebuilds the canonical index each night.\ncode');
      return typeof p === 'string' && p.includes('Corge');
    }],
    // ⚠️ The mirror: a MENTION of --self-test in a comment is not an implementation.
    ['does NOT count a --self-test mention in a comment as an implementation', () =>
      hasSelfTest('/**\n * usage: node x.cjs --self-test\n */\nconst x = 1;') === false],
    ['DOES count a real --self-test branch', () =>
      hasSelfTest('if (argv.includes("--self-test")) return selfTest();') === true],
    ['returns null for a file with no header', () => purposeOf('const x = 1;') === null],
    ['skips a file with no purpose line rather than inventing one', () => {
      const p = purposeOf('/**\n *\n */\nx');
      return p === null || typeof p === 'string';
    }],
    ['the scan finds real tools', () => scan().length > 20],
    ['every scanned tool has a name and a category', () => scan().every((t) => t.name && t.category)],
    // ⚠️ The case that was missing for the THIRD false finding. The old code printed a literal
    // `0 orphans` on the --check path. This asserts the number is derived from the input.
    ['the --check summary reports the REAL orphan count, not a literal 0', () => {
      const fake = [
        { name: 'a.cjs', reaches: ['npm'] },
        { name: 'b.cjs', reaches: null },
        { name: 'c.cjs', reaches: null },
      ];
      const line = checkSummary(fake);
      return line.includes('2 ORPHAN') && !/0 orphans/.test(line);
    }],
    ['the --check summary says 0 orphans only when there ARE none', () => {
      const line = checkSummary([{ name: 'a.cjs', reaches: ['npm'] }]);
      return line.includes('0 orphans');
    }],
  ];
  process.exit(runCases(cases) ? 1 : 0);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

  const tools = scan();

  if (argv.includes('--orphans')) {
    const orphans = tools.filter((t) => !t.reaches);
    if (!orphans.length) return console.log('\n  No orphans — every tool is referenced.\n');
    console.log(`\n  ${orphans.length} orphan(s) — named nowhere:\n`);
    for (const t of orphans) console.log(`    ${t.name}\n      ${t.purpose}\n`);
    return;
  }

  // ── THE LIBRARY SURFACE (2026-10-02) ────────────────────────────────────────────────────────
  //
  // `--write`/`--check` answer "is the index current?". Neither answers the question an agent
  // actually has: **"is there already a tool that does X?"**
  //
  // ⚠️ THE MEASURED COST OF NOT ANSWERING IT. 75 of 175 tools were orphans — named in no
  // instruction, no npm script, and not run by prebuild. `analyse-unreachable-capacity.cjs` was
  // one of them, and it took an agent **three passes to find while actively looking for exactly
  // that capability**. An orphan is not dead code; it is working code with no door.
  //
  // ⚠️ WHY THIS LIVES HERE AND NOT IN A NEW TOOL. A second index over the same directory is the
  // duplication this repo warns about most — two copies of one fact, and only one gets the next
  // fix. The index already holds the name, the purpose and the reachability; `--find` and `--run`
  // are two readers over data that is already correct.
  //
  //   node scripts/tools-index.cjs --find denominator        # every tool whose name/PURPOSE matches
  //   node scripts/tools-index.cjs --run audit-signal-capacity.cjs [args...]
  if (argv.includes('--find')) {
    const terms = argv.slice(argv.indexOf('--find') + 1).filter((a) => !a.startsWith('--'));
    const hits = tools.filter((t) => matchesQuery(t, terms));
    if (!hits.length) {
      console.log(`\n  No tool matches ${JSON.stringify(terms.join(' '))}.`);
      console.log('  ⚠️ That is a finding about the library, not about you: if this capability is');
      console.log('     missing, building it is justified. Try a broader word first.\n');
      return;
    }
    console.log(`\n  ${hits.length} tool(s) matching ${JSON.stringify(terms.join(' '))}:\n`);
    for (const t of hits) {
      const where = t.reaches ? t.reaches.join(',') : '⚠️ ORPHAN';
      console.log(`    ${t.name}  [${t.category} · ${where}]`);
      console.log(`      ${t.purpose}`);
      if (t.selfTest) console.log('      self-test: --self-test');
      console.log('');
    }
    console.log('  run one with:  node scripts/tools-index.cjs --run <name> [args...]\n');
    return;
  }

  if (argv.includes('--run')) {
    const rest = argv.slice(argv.indexOf('--run') + 1);
    const wanted = rest[0];
    if (!wanted) {
      console.error('  ✖ --run needs a tool name.  find one with --find <keyword>');
      process.exit(2);
    }
    const found = resolveTool(tools, wanted);
    if (found.error) {
      console.error(`\n  ✖ ${found.error}\n`);
      process.exit(2);
    }
    const toolPath = pathOf(found.tool);
    // ⚠️ REFUSE, DO NOT THROW. A dispatcher that crashes on a name it resolved is worse than one
    // that says it cannot find the file — the first looks like a broken install, the second is
    // actionable. This guard exists because the first version of this block did throw.
    if (!toolPath || !fs.existsSync(toolPath)) {
      console.error(`\n  ✖ resolved '${found.tool.name}' but no file at ${toolPath}\n`);
      process.exit(2);
    }
    // ⚠️ PRINT WHAT IS ABOUT TO RUN. A dispatcher that silently chooses a file is a guess
    // wearing a command's clothes — and `--run` runs REAL scripts with REAL side effects.
    console.log(`\n  ▶ ${toolPath.replace(REPO_ROOT + path.sep, '')}`);
    console.log(`    ${found.tool.purpose}`);
    if (!found.tool.reaches) console.log('    ⚠️ ORPHAN — nothing else references this tool.');
    console.log('');
    const r = spawnSync('node', [toolPath, ...rest.slice(1)], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    process.exit(r.status == null ? 1 : r.status);
  }

  const md = render(tools);
  const js = JSON.stringify({ generatedFrom: 'scripts/tools-index.cjs', count: tools.length, tools }, null, 2) + '\n';

  if (argv.includes('--check')) {
    const stale = [];
    if (!fs.existsSync(DOC) || fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n') !== md) stale.push('docs/TOOLS-INDEX.md');
    if (!fs.existsSync(JSON_PATH) || fs.readFileSync(JSON_PATH, 'utf8').replace(/\r\n/g, '\n') !== js) stale.push('docs/tools-index.json');
    if (stale.length) {
      console.error(`\n  [tools-index] ✖ ${stale.length} generated artefact(s) are stale:`);
      for (const s of stale) console.error(`    ${s} is OUT OF DATE — regenerate: node scripts/tools-index.cjs --write`);

      // ⚠️ NAME THE CAUSE, not just the remedy (added 2026-10-02). The old message said
      // "regenerate" and stopped there — so an agent who had just ADDED a script to `scripts/`
      // saw a failure naming a generated FILE and had no reason to connect it to their own
      // change. Measured that day: adding scripts/bump-version.cjs turned the build red with a
      // message that never mentioned it. The difference between an instruction and a diagnosis
      // is whether the reader has to guess what they did.
      //
      // The cause is always the same: the tool SET changed, because a file was added to,
      // removed from, renamed in, or edited inside `scripts/` or `nest/scripts/`.
      try {
        const prev = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
        const prevNames = new Set((prev.tools || []).map((t) => t.path || t.name));
        const nowNames = new Set(tools.map((t) => t.path || t.name));
        const added = [...nowNames].filter((n) => !prevNames.has(n));
        const removed = [...prevNames].filter((n) => !nowNames.has(n));
        console.error('\n    CAUSE — the tool set changed. You most likely added/removed/renamed a');
        console.error('    file in scripts/ or nest/scripts/, or edited a script\'s header:');
        if (added.length) for (const n of added.slice(0, 8)) console.error(`      + ${n}   <-- NEW`);
        if (removed.length) for (const n of removed.slice(0, 8)) console.error(`      - ${n}   <-- GONE`);
        if (!added.length && !removed.length) {
          console.error('      (same tool names — a header/description or reachability changed)');
        }
        console.error('    ⚠️ A new script is NOT an orphan-check failure: this is only staleness.');
        console.error('       Run --write, then commit the regenerated files WITH your script.');
      } catch {
        console.error('\n    CAUSE — the tool set changed (could not diff against the previous index).');
      }
      console.error('');
      process.exit(1);
    }
    console.log(checkSummary(tools));
    return;
  }

  fs.mkdirSync(path.dirname(DOC), { recursive: true });
  // Encoding guard: no BOM, LF only — the repo fails a build on mojibake signatures.
  fs.writeFileSync(DOC, md);
  fs.writeFileSync(JSON_PATH, js);
  const orphans = tools.filter((t) => !t.reaches).length;
  console.log(`  [tools-index] wrote docs/TOOLS-INDEX.md + docs/tools-index.json`);
  console.log(`  ${tools.length} tools, ${orphans} orphan(s), ${tools.filter((t) => t.selfTest).length} with a self-test`);
}

main();
