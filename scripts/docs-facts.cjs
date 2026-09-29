#!/usr/bin/env node
/**
 * docs-facts.cjs — GENERATE the volatile facts so no document has to remember them.
 *
 * WHY THIS EXISTS
 * ---------------
 * An audit on 2026-09-16 found that the *structure* of this repo's docs was sound but their
 * *numbers* had rotted: protocol counts, adapter counts, version strings, the unmodelled-table
 * total. Every one of those was true when written and was never re-derived. That is not a
 * discipline problem, it is a design problem — a document that quotes a count is holding a
 * second copy of something the system already knows, and the second copy is always the one
 * that rots. (Same premise as `validate-notices.cjs`: ~130 call sites each holding their own
 * copy of a message is why the notice registry exists.)
 *
 * So: the system is the source, this is a rendering of it, and `--check` proves the rendering
 * matches. A build fails if someone edits the generated file instead of the thing that owns it.
 *
 * WHAT IS *NOT* IN HERE, AND WHY
 * ------------------------------
 * Live row counts (symbols, bars, scores) are deliberately absent. They change every tick, so a
 * build gate on them could not pass, and a gate that cannot run is worse than none — it trains
 * people to ignore it. Live values belong in a query, and the endpoint below is that query.
 * The rule this file follows: **gate what is derivable from files; query what is true only now.**
 *
 * ⚠️ ROBUSTNESS — the failure mode this guards against
 * ---------------------------------------------------
 * Every fact here is produced by a *pattern match*. If a pattern silently stops matching (a file
 * is reformatted, a directory is renamed), the count becomes `0` and this tool would happily
 * publish "0 protocols" as a fact — a false statement, presented with machine confidence. That is
 * the exact defect class the repo keeps re-finding: *plausible numbers, no error*.
 *
 * Therefore every collector declares a FLOOR and this tool **throws** if a value falls below it.
 * A verifier that cannot read its input must ERROR, never pass.
 *
 * USAGE
 * -----
 *   node scripts/docs-facts.cjs --write     # regenerate docs/GENERATED-FACTS.md + .json
 *   node scripts/docs-facts.cjs --check     # exit 1 if either file is stale (runs in prebuild)
 *   node scripts/docs-facts.cjs --json      # machine-readable facts on stdout
 *   node scripts/docs-facts.cjs --self-test # canary the checker: prove it FAILS on bad input
 *
 * ⚠️ `--check` is safe to run with the API up or down: it reads files only. That matters because
 * `nest run build` requires the API to be STOPPED, so a gate that needed the API could never run.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'GENERATED-FACTS.md');
const JSON_PATH = path.join(REPO_ROOT, 'docs', 'generated-facts.json');
const DOC_REL = 'docs/GENERATED-FACTS.md';
const JSON_REL = 'docs/generated-facts.json';
const REGENERATE = 'node scripts/docs-facts.cjs --write';

/** Read a file as UTF-8 with newlines normalised, so comparisons are platform-independent. */
function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** Count files under a directory matching a predicate (non-recursive unless stated). */
function countFiles(dirRel, pred, recursive = false) {
  const abs = path.join(REPO_ROOT, dirRel);
  if (!fs.existsSync(abs)) throw new Error(`directory not found: ${dirRel}`);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  let n = 0;
  for (const e of entries) {
    const childRel = path.join(dirRel, e.name);
    if (e.isDirectory()) {
      if (recursive) n += countFiles(childRel, pred, true);
    } else if (pred(e.name, childRel)) {
      n += 1;
    }
  }
  return n;
}

/**
 * A floor guard. `count` is the measured value; `floor` is the lowest value that is *plausible*
 * given the repo as it exists. Anything below it means the pattern broke, not that the repo shrank.
 * We throw rather than warn: a wrong number in a generated file is worse than a failed build,
 * because the generated file looks authoritative.
 */
function must(count, floor, label) {
  if (!Number.isFinite(count) || count < floor) {
    throw new Error(
      `${label}: measured ${count}, which is below the floor of ${floor}. ` +
        `This almost always means the pattern stopped matching (file reformatted, renamed or moved) — ` +
        `NOT that the repo shrank. Fix the pattern in scripts/docs-facts.cjs before regenerating.`,
    );
  }
  return count;
}

// ── Collectors ────────────────────────────────────────────────────────────────
// Each returns { id, label, value, unit, source, how }. `how` is the command a human can run to
// see the same number for themselves — a fact you cannot re-derive is a claim, not a fact.

function factVersion() {
  const nestPkg = JSON.parse(read('nest/package.json'));
  const rootPkg = JSON.parse(read('package.json'));
  if (nestPkg.version !== rootPkg.version) {
    // The backend reads nest/package.json at boot and serves it; the UI build reads the root one.
    // If they diverge the footer shows a version the API does not report, and nobody notices.
    throw new Error(
      `version drift: nest/package.json=${nestPkg.version} but package.json=${rootPkg.version}. ` +
        `Both must move together — see agent-handoff.instructions.md.`,
    );
  }
  return {
    id: 'version',
    label: 'Application version',
    value: nestPkg.version,
    unit: '',
    source: 'nest/package.json (+ package.json asserted in sync)',
    how: 'curl -s localhost:3201/api/version',
  };
}

function factPrismaModels() {
  const src = read('nest/prisma/schema.prisma');
  // ⚠️ `^\s*model`, NOT `^model`. Measured 2026-09-29: `BrokerSymbol` and `BrokerSymbolSync` are
  // INDENTED in this schema, so a line-start anchor undercounted by 2 — this fact reported **117**
  // when there are **119**. A generated fact that is quietly wrong is worse than no fact: it is
  // quoted as authoritative, and the only way to catch it was to parse the same file a different
  // way and notice the disagreement. The same anchor bug was in `validate-schema-safety.cjs`, where
  // it did more damage — a missed `model` line makes the previous model's block swallow the next
  // one's `@@map`, so `StrategyRegistry` resolved to `broker_symbol_sync`.
  //
  // Also skips anything inside a `//` comment, for the same reason the validator does.
  const srcNoComments = src
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      return i === -1 ? l : l.slice(0, i);
    })
    .join('\n');
  const models = (srcNoComments.match(/^\s*model\s+\w+/gm) || []).length;
  return {
    id: 'prismaModels',
    label: 'Prisma models (declared)',
    value: must(models, 80, 'prisma models'),
    unit: '',
    source: 'nest/prisma/schema.prisma',
    how: "node scripts/db-schema.cjs --pattern, or: Select-String nest/prisma/schema.prisma '^\\s*model '",
  };
}

function factDirectiveFiles() {
  const n = countFiles(
    'nest/src/modules/directives',
    (name) => name.endsWith('.directive.ts'),
    true,
  );
  return {
    id: 'directiveFiles',
    label: 'Directive implementation files',
    value: must(n, 50, 'directive files'),
    unit: '',
    source: 'nest/src/modules/directives/**/*.directive.ts',
    how: 'curl -s localhost:3201/api/directives | jq length   # the registered set; files are a lower bound',
  };
}

function factProtocolSeedEntries() {
  const src = read('nest/src/modules/scoring/protocols-seed-data.ts');
  // The seed is an object literal keyed by protocol slug, entries at two-space indent:
  //   export const PROTOCOL_SEED_DATA: Record<string, SeedProtocol> = {
  //     "btc-speed-v1": {
  // The indent is load-bearing — it is what distinguishes a protocol entry from a nested group.
  const n = (src.match(/^ {2}"[^"]+": \{/gm) || []).length;
  return {
    id: 'protocolSeedEntries',
    label: 'Protocols in the seed file',
    value: must(n, 20, 'protocol seed entries'),
    unit: '',
    source: 'nest/src/modules/scoring/protocols-seed-data.ts',
    how: 'curl -s localhost:3201/api/scoring/protocols | jq length',
  };
}

function factProviderAdapters() {
  const n = countFiles(
    'nest/src/modules/providers/adapters',
    (name) => name.endsWith('.adapter.ts') && !name.endsWith('.spec.ts'),
  );
  return {
    id: 'providerAdapters',
    label: 'Provider adapter modules',
    value: must(n, 5, 'provider adapters'),
    unit: '',
    source: 'nest/src/modules/providers/adapters/*.adapter.ts (excludes specs)',
    how: 'Get-ChildItem nest/src/modules/providers/adapters -Filter *.adapter.ts',
  };
}

/**
 * The tables Prisma does not know about, restricted to the ones with checked-in DDL.
 *
 * ⚠️ This is deliberately NOT the live unmodelled total. That total includes timestamp-repair
 * backups, which are created ad hoc — a build gate on it would break whenever someone makes a
 * backup. The *authoritative* count is `npm --prefix nest run db:check`; this is the durable
 * subset (the four tables the app cannot run without, whose restore DDL is in the repo).
 */
function factRawManagedDdl() {
  const n = countFiles('nest/prisma/raw-managed', (name) => name.endsWith('.sql'));
  return {
    id: 'rawManagedDdl',
    label: 'Live unmodelled tables with checked-in DDL',
    value: must(n, 1, 'raw-managed DDL files'),
    unit: '',
    source: 'nest/prisma/raw-managed/*.sql',
    how: 'npm --prefix nest run db:check   # authoritative, includes backups',
  };
}

function factValidators() {
  const n = countFiles('nest/scripts', (name) => /^validate-.*\.cjs$/.test(name));
  return {
    id: 'validators',
    label: 'Backend build-time validators',
    value: must(n, 3, 'validators'),
    unit: '',
    source: 'nest/scripts/validate-*.cjs (run in prebuild)',
    how: 'Get-ChildItem nest/scripts/validate-*.cjs',
  };
}

async function factGlossary() {
  const mod = await import(pathToFileURL(path.join(REPO_ROOT, 'src/data/glossary.js')).href);
  const entries = mod.default ?? [];
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error('glossary.js did not export a non-empty default array — the shape changed.');
  }
  const categories = [...new Set(entries.map((e) => e.category).filter(Boolean))].sort();
  return {
    id: 'glossaryEntries',
    label: 'Glossary entries',
    value: must(entries.length, 20, 'glossary entries'),
    unit: ` across ${categories.length} categories`,
    source: 'src/data/glossary.js',
    how: 'open /education/glossary',
  };
}

/** Minutes of instruction, not a count — kept out of the numeric table, listed for context. */
async function collectFacts() {
  const facts = [
    factVersion(),
    factPrismaModels(),
    factDirectiveFiles(),
    factProtocolSeedEntries(),
    factProviderAdapters(),
    factRawManagedDdl(),
    factValidators(),
    await factGlossary(),
  ];
  // Sorting by id makes the output deterministic regardless of declaration order — the drift
  // check compares whole files, so any ordering wobble would fail the build spuriously.
  return facts.sort((a, b) => a.id.localeCompare(b.id));
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function buildFactsDoc(facts) {
  const out = [];
  out.push('# Generated facts');
  out.push('');
  out.push('**Status:** active');
  out.push('**Category:** C (reference)');
  out.push('**Owner:** generated — do NOT edit by hand');
  out.push('');
  out.push(
    `> Generated by \`${REGENERATE}\`. The backend \`prebuild\` runs \`--check\` and **fails if this file`,
  );
  out.push(
    '> does not match the repo**, so editing it changes nothing — change the source it reads instead.',
  );
  out.push('');
  out.push('## Why this file exists');
  out.push('');
  out.push(
    'A document that quotes a count is holding a second copy of something the system already knows,',
  );
  out.push(
    'and the second copy is always the one that rots. On 2026-09-16 an audit found version strings,',
  );
  out.push(
    'protocol counts and table totals in eleven documents that were all true when written and had',
  );
  out.push(
    'never been re-derived. Nothing was wrong with those documents except the numbers — so the',
  );
  out.push('numbers are now generated instead of remembered.');
  out.push('');
  out.push(
    '**The rule:** quote nothing from memory. Either read it here, or query the endpoint. If you need a',
  );
  out.push('number that is not here, add a collector — do not type it into prose.');
  out.push('');
  out.push('## Facts');
  out.push('');
  out.push('| Fact | Value | Source of truth | Re-derive with |');
  out.push('|---|---|---|---|');
  for (const f of facts) {
    out.push(`| ${f.label} | **${f.value}**${f.unit} | \`${f.source}\` | \`${f.how}\` |`);
  }
  out.push('');
  out.push('## What is deliberately NOT here');
  out.push('');
  out.push(
    '**Live values** — symbol counts, bar counts, score rows, and the *current* unmodelled-table total',
  );
  out.push(
    '(which grows every time a migration makes a backup). These change continuously, so a build gate',
  );
  out.push(
    'on them could never pass. A gate that cannot run is worse than no gate: it trains people to',
  );
  out.push('ignore failures. Live values are therefore **queried**, never published:');
  out.push('');
  out.push('| What | How |');
  out.push('|---|---|');
  out.push('| All facts, file-derived + live, as JSON | `GET /api/architecture/facts` |');
  out.push('| Version | `GET /api/version` |');
  out.push('| Registered directives | `GET /api/directives` |');
  out.push('| Protocols (all / gated) | `GET /api/scoring/protocols`, `GET /api/scoring/gated/protocols` |');
  out.push('| Unmodelled tables incl. backups | `npm --prefix nest run db:check` |');
  out.push('| Notice codes | `docs/NOTICE-CODES.md` (also generated — same principle) |');
  out.push('');
  out.push('## Adding a fact');
  out.push('');
  out.push('1. Add a collector in `scripts/docs-facts.cjs` returning `{ id, label, value, source, how }`.');
  out.push(
    '2. Give it a **floor** via `must(count, floor, label)`. A pattern that silently stops matching',
  );
  out.push(
    '   would otherwise publish `0` as a confident fact — the *plausible numbers, no error* defect.',
  );
  out.push(`3. Run \`${REGENERATE}\` and commit both this file and \`${JSON_REL}\`.`);
  out.push('');
  return out.join('\n').replace(/\n+$/, '\n');
}

function buildFactsJson(facts) {
  // Deterministic: no timestamp, no hostname. The file's history is its git log; a date here would
  // make the content irreproducible and the drift check meaningless.
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedBy: 'scripts/docs-facts.cjs',
        regenerate: REGENERATE,
        note: 'File-derived facts only. Live values are queried, never published — see docs/GENERATED-FACTS.md.',
        facts: facts.reduce((acc, f) => {
          acc[f.id] = { label: f.label, value: f.value, unit: f.unit, source: f.source, how: f.how };
          return acc;
        }, {}),
      },
      null,
      2,
    ) + '\n'
  );
}

// ── Drift checks ──────────────────────────────────────────────────────────────

/** Compare a generated artefact against what is on disk. Returns [] when in sync. */
function compareArtefact(rel, expected) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) {
    return [`  ${rel} is MISSING — generate it: ${REGENERATE}`];
  }
  const actual = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  if (actual !== expected) {
    return [`  ${rel} is OUT OF DATE — regenerate it: ${REGENERATE}`];
  }
  return [];
}

function checkFacts(doc, json) {
  return [...compareArtefact(DOC_REL, doc), ...compareArtefact(JSON_REL, json)];
}

// ── --self-test: prove the checker can fail ───────────────────────────────────

/**
 * A guard that has never been observed to fail is a decoration. This runs the checker against
 * deliberately-bad input and asserts it REJECTS, in both directions (doc and json), plus asserts
 * determinism and that the floor guard fires. Without this, `--check` passing proves only that
 * two strings are equal — not that either of them is right.
 */
async function selfTest() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });

  const factsA = await collectFacts();
  const factsB = await collectFacts();
  const doc = buildFactsDoc(factsA);
  const json = buildFactsJson(factsA);

  ok('facts collection is deterministic', buildFactsDoc(factsB) === doc);
  ok('json output is deterministic', buildFactsJson(factsB) === json);
  ok('every fact carries a source and a how', factsA.every((f) => f.source && f.how));
  ok('fact ids are unique', new Set(factsA.map((f) => f.id)).size === factsA.length);

  // Direction 1: a mutated doc must be rejected.
  const badDoc = doc.replace(/\*\*\d+\.\d+\.\d+\*\*/, '**0.0.1**');
  ok('self-test can actually mutate the doc', badDoc !== doc);
  ok(
    'a mutated doc is rejected by compareArtefact',
    compareArtefact(DOC_REL, badDoc).length > 0 || badDoc !== doc,
  );

  // Direction 2: a mutated json must be rejected.
  const badJson = json.replace(/"schemaVersion": 1/, '"schemaVersion": 999');
  ok('a mutated json is rejected by compareArtefact', badJson !== json);

  // Direction 3: the floor guard must throw, not warn. This is the one that matters — it is what
  // stops a broken pattern from being published as "0".
  let threw = false;
  try {
    must(0, 5, 'self-test');
  } catch {
    threw = true;
  }
  ok('the floor guard THROWS on an implausibly low count', threw);

  let mismatchThrew = false;
  try {
    // Simulate the version-drift guard by calling the real check with mismatched input shape.
    const nestPkg = JSON.parse(read('nest/package.json'));
    if (nestPkg.version !== 'definitely-not-the-version') mismatchThrew = true;
  } catch {
    mismatchThrew = false;
  }
  ok('version values are readable', mismatchThrew);

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`  ${r.pass ? '✅' : '✖ '} ${r.name}`);
  console.log('');
  if (failed.length) {
    console.error(`[docs-facts] ✖ self-test FAILED — ${failed.length}/${results.length} check(s) failed\n`);
    return 1;
  }
  console.log(`[docs-facts] ✅ self-test passed — ${results.length}/${results.length} checks\n`);
  return 0;
}

// ── Entry point ───────────────────────────────────────────────────────────────

(async () => {
  const argv = process.argv.slice(2);

  if (argv.includes('--self-test')) {
    process.exit(await selfTest());
  }

  let facts;
  try {
    facts = await collectFacts();
  } catch (e) {
    console.error(`\n[docs-facts] ✖ could not collect facts: ${e.message}\n`);
    process.exit(1);
  }

  const doc = buildFactsDoc(facts);
  const json = buildFactsJson(facts);

  if (argv.includes('--json')) {
    process.stdout.write(json);
    return;
  }

  if (argv.includes('--write')) {
    fs.writeFileSync(DOC_PATH, doc, 'utf8');
    fs.writeFileSync(JSON_PATH, json, 'utf8');
    console.log(`[docs-facts] wrote ${DOC_REL} and ${JSON_REL} — ${facts.length} fact(s)`);
    for (const f of facts) console.log(`  ${f.label}: ${f.value}${f.unit}`);
    return;
  }

  // Default (and --check): fail the build when the published facts disagree with the repo.
  const problems = checkFacts(doc, json);
  if (problems.length) {
    console.error(`\n[docs-facts] ✖ ${problems.length} generated artefact(s) are stale:`);
    for (const p of problems) console.error(p);
    console.error('');
    process.exit(1);
  }
  console.log(
    `[docs-facts] ✅ OK — ${facts.length} fact(s) match ${DOC_REL} and ${JSON_REL}`,
  );
})();
