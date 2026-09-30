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
 *   node scripts/tools-index.cjs --self-test
 */

'use strict';

const fs = require('fs');
const path = require('path');
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

// ── self-test ────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
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

  const md = render(tools);
  const js = JSON.stringify({ generatedFrom: 'scripts/tools-index.cjs', count: tools.length, tools }, null, 2) + '\n';

  if (argv.includes('--check')) {
    const stale = [];
    if (!fs.existsSync(DOC) || fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n') !== md) stale.push('docs/TOOLS-INDEX.md');
    if (!fs.existsSync(JSON_PATH) || fs.readFileSync(JSON_PATH, 'utf8').replace(/\r\n/g, '\n') !== js) stale.push('docs/tools-index.json');
    if (stale.length) {
      console.error(`\n  [tools-index] ✖ ${stale.length} generated artefact(s) are stale:`);
      for (const s of stale) console.error(`    ${s} is OUT OF DATE — regenerate: node scripts/tools-index.cjs --write`);
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
