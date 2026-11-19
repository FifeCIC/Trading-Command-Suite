/**
 * scaffold-templates.cjs — the file bodies `audit-project-readiness.cjs --scaffold` writes.
 *
 * WHY THIS IS A SEPARATE MODULE: the auditor passed 1,500 lines with the templates inline, and this
 * repository's own code-health rule warns at 1,500 / 2,000 / 3,000. A tool that audits structure must
 * not breach the structure rule — so the CONTENT moved out and the auditor kept the DECISION logic.
 *
 * ⚠️ Every template carries a header naming the measured defect it prevents. A file that says "add
 * your own rules here" reads as done and is not; empty boilerplate is worse than no file, because it
 * silences the audit without changing the behaviour.
 *
 * `${DATE}` is substituted at scaffold time (see `fillTemplate` in the auditor).
 */

const TEMPLATES = {
  gitignore: `# ── Ignored by default, because each of these has shipped to a public repo before ──
#
# MEASURED (Trading Command Suite, 2026-09): a logs/ folder held 576 files and **435 were tracked**
# in a public repository, one of them carrying a note the requirement did not want published. Nothing was
# wrong with git — nothing had told it to look away.

# Agent and session output. Working material, never product.
logs/
*.log
session-*/
tmp/
scratch/

# Backups and editor droppings that are genuinely never wanted.
*.bak
*.orig
*.rej
*~
.DS_Store
Thumbs.db

# Secrets. A credential in a repository cannot be recalled by deleting it afterwards.
.env
.env.local
.env.*.local
*.pem
*.key
!*.pub

# Build output and dependencies.
node_modules/
dist/
build/
coverage/
.vite/
`,

  decisions: `# Settled Decisions

**Status:** active
**Category:** C
**Created:** \${DATE}
**Last updated:** \${DATE}

> **What this file is.** The register of decisions that have been settled, each with an honest guard
> status. Check it before changing an area that has been decided — re-opening a settled decision by
> accident is the most expensive thing that happens in a maintained codebase.
>
> ⚠️ **A row is not a record until it exists in three places**: this row, a \`DECISION\` marker at the
> code site, and the issue that carries the reasoning. This file alone is a claim; the marker is where
> the next reader actually meets it.

| # | Decision | What it means | Settled | Guard status |
|---|---|---|---|---|
| 1 | **A file lives where its concern lives.** | Layout is not cosmetic: a file's LOCATION decides whether it is validated at all. Measured elsewhere: 13 SQL files sat outside both DDL scan roots and were checked by nothing until they were moved. | \${DATE} | 🔴 UNGUARDED — no check enforces the layout yet. Add one, or keep this row honest by leaving it red. |
| 2 | **Every guard ships a way to make it fail.** | A guard that has never been observed to fail is a decoration. Each validator carries \`--self-test\`, canaried in both directions, with the restore verified. | \${DATE} | 🟡 PARTIAL — the convention exists; not every script here has a self-test yet. |

## How to add a row

1. Append the next number. **Numbering must stay contiguous** — a hole makes every citation above it
   ambiguous, and a citation to a missing row reads as valid.
2. Fill \`Guard status\` honestly: 🟢 enforced by a named check · 🟡 partial · 🔴 **UNGUARDED**.
   ⚠️ 🔴 must be *declared*, never left blank. A blank looks like "probably fine".
3. Put a \`DECISION (YYYY-MM-DD, primary)\` marker at the code site naming this row.
4. If you are overriding an earlier decision or another person's reasoning, add \`INSTEAD OF:\` and
   state what changed that invalidates it. Never quietly replace a settled decision.
`,

  copilotInstructions: `# Engineering standards

Read this before changing code in this repository. These are not style preferences — each one exists
because something broke without an error: a number that looked normal, a guard that never ran, a page
that rendered nothing.

**Silent failure is the failure mode this project designs against.**

---

## 1 · Evidence over assertion

The running system is the only source of truth. A diff, a build, a test name and a ticket are all
*claims about* it.

- Name the command and its output behind every claim. "Should work" and "looks correct" are not results.
- Do not attribute a fix you did not isolate. If two things changed and the symptom went away, say
  so — a correlation is not a cause.
- When a validator cannot read its input it must **error**, never pass.

## 2 · A guard that has never failed is a decoration

Every guard must be observed to fail in **both** directions:

1. break the thing it protects, confirm it fails;
2. restore, confirm it passes, and **verify the restore**.

A canary that cannot make its own edit must refuse to report — never claim a pass.

## 3 · A declaration is not validated by being well-formed

| Declaration | Not validated by | Validated by |
|---|---|---|
| a seeder | running cleanly | round-tripping: delete, re-seed, compare |
| a config value | parsing | calling every consumer |
| a page | compiling | rendering |
| an instruction file | existing | firing when it should |

## 4 · One source of truth for every fact

If a calculation, a constant or a lookup already exists, use it. Two copies drift and only one gets
the next fix.

## 5 · Make silence visible

An empty list and a failed query must never render the same. \`[]\` is information; \`null\` is the
absence of information; an error is a third thing. Collapse them and every reader draws a wrong
conclusion.

## 6 · Numbers that affect a decision are copied, never edited in place

Weights, thresholds, limits and gates are changed by creating a **copy** and comparing the two. The
incumbent is not deleted until the comparison reports.

A bug fix that restores an intended value is not covered by this rule — say so explicitly and cite
the intent.

## 7 · Honest-partial is a pass

Report the gates you ran, the result you observed, and **what you did not do**.
**Reporting a limitation is never penalised. Concealing one is.**
`,

  reviewQueue: `# Review Queue — the one list every agent adds to

**Purpose:** the things only the requirement can decide. **How to answer:** the row id and a word.

| ✅ A row | 🛑 not a row |
|---|---|
| A **technical fork** with no clear winner · **where a new input belongs** · a **policy number** · **permission to spend effort** | "Do you like this?" · layout or colour preferences · anything an agent can settle by measuring |

**Limits:** ONE concern per row · question ≤ 40 words · ≤ 3 numbers. If it does not fit, it is an
explainer (a table, a mockup, a comparison), not a row.

---

## OPEN

| id | the decision, in one breath | where | question |
|---|---|---|---|

## ANSWERED

| id | decision | date |
|---|---|---|
`,

  selfTestLib: `/**
 * self-test.cjs — the shared assertion harness for build-script self-tests.
 *
 * WHY THIS EXISTS: every validator in this repo is expected to be able to prove it FAILS. Without a
 * shared harness each script hand-rolls its own loop, and \`validate-duplication.cjs\` (elsewhere) has
 * failed a build on exactly that pair of copies. One harness, one shape.
 *
 * ⚠️ A self-test that inspects nothing must FAIL, not pass. \`runCases\` refuses an empty list.
 */

/**
 * Run a list of cases and print a verdict. Returns the number of failures.
 *
 * @param {string} title          what is being tested
 * @param {Array<{name:string, pass:boolean, detail?:string}>} cases
 * @returns {number} failures
 */
function runCases(title, cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    console.error(\`[self-test] \${title}: NO CASES — a suite that inspects nothing cannot pass.\`);
    return 1;
  }
  console.log(\`\\n[self-test] \${title}\`);
  let failures = 0;
  for (const c of cases) {
    if (c.pass) {
      console.log(\`   ✅ \${c.name}\`);
    } else {
      console.log(\`   ❌ \${c.name} — \${c.detail || 'no detail'}\`);
      failures += 1;
    }
  }
  console.log(\`\\n[self-test] \${cases.length - failures}/\${cases.length} passed\`);
  return failures;
}

module.exports = { runCases };
`,

  readme: `# Project name

One sentence: what this is, and who it is for. Replace this line — a README that still says "Project
name" is the first thing a visitor reads, and it reads as abandoned.

## Quick start

\`\`\`powershell
npm install
npm run dev
\`\`\`

## What this project is

<!-- Two or three sentences. State what it does, not how it is built. -->

## Development

\`\`\`powershell
npm run validate      # the gate chain (runs automatically as prebuild)
npm run test:gates    # prove the guards can still fail
\`\`\`

### The rules that matter here

Read \`.github/copilot-instructions.md\` before changing code. The short version:

- **Evidence over assertion** — a claim needs a command and its output behind it.
- **A guard that has never failed is a decoration** — every gate ships a \`--self-test\`.
- **An empty result and a failed query must never render the same.**

### Settled decisions

\`docs/SETTLED-DECISIONS.md\` records decisions that are closed, each with an honest guard status.
Check it before changing an area that has been decided.

## Licence

<!-- State the licence, or delete this section. ⚠️ A public repository with no licence is
     "all rights reserved" by default, which contradicts any open-source claim. -->
`,

  validateRequiredFiles: `#!/usr/bin/env node
/**
 * validate-required-files.cjs — new project bootstrap guard: the files and facts every repo needs.
 * =================================================================================================
 *
 * A starting gate, deliberately small. It proves the plumbing works before the project has any code
 * to be strict about — and every rule below exists because its absence is silent rather than loud.
 *
 * ⚠️ ERROR IS NOT PASS. A file that cannot be read exits 2, never 0. A check that inspects nothing
 * and reports OK is the defect this whole practice set exists to prevent.
 *
 * Usage:
 *   node scripts/validate-required-files.cjs
 *   node scripts/validate-required-files.cjs --self-test
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** A credential shape that must never appear in tracked text. Two shapes, both measured. */
const CREDENTIAL_PATTERNS = [
  /mysql:\\/\\/[^:/\\s]+:[^@\\s]{4,}@/,
  /(?:password|passwd|pwd)\\s*[:=]\\s*['"][^'"\\s]{6,}['"]/i,
];

/**
 * ⚠️ BUILT AT RUNTIME ON PURPOSE — do not "tidy" this into a literal.
 *
 * A literal fixture is ITSELF a credential-shaped string, so this file would fail its own scan. That
 * self-defeating shape has been measured before: a procedure proving "a committed credential fails
 * the build" was itself a committed credential-shaped string, and the guard rejected the build that
 * documented it. A fixture must be unmistakably a fixture.
 */
const FIXTURE_CREDENTIAL = ['mysql:', '//', 'user', ':', 'secret', '123', '@localhost:3306/db'].join('');

function readIf(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function check() {
  const problems = [];
  let judged = 0;

  const pkgRaw = readIf(path.join(ROOT, 'package.json'));
  if (pkgRaw === null) {
    problems.push('no readable package.json — cannot judge anything useful without it');
  } else {
    judged += 1;
    let pkg = null;
    try {
      pkg = JSON.parse(pkgRaw);
    } catch (err) {
      problems.push(\`package.json does not parse: \${err.message}\`);
    }
    if (pkg) {
      if (!pkg.name) problems.push('package.json has no "name"');
      if (!pkg.version) problems.push('package.json has no "version"');
    }
  }

  for (const required of ['.gitignore', 'README.md']) {
    judged += 1;
    if (readIf(path.join(ROOT, required)) === null) problems.push(\`\${required} is missing\`);
  }

  // A .bak / tmp- file at the package root is a scratch artefact that will be committed by someone.
  judged += 1;
  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(ROOT);
  } catch {
    return { problems: ['the repository root could not be read'], judged: 0, unreadable: true };
  }
  const scratch = rootEntries.filter((n) => /\\.(bak|orig|rej)$/.test(n) || /^tmp[-_]/.test(n));
  if (scratch.length) problems.push(\`scratch files at the package root: \${scratch.join(', ')}\`);

  // scan tracked text for credential shapes
  judged += 1;
  const scanExts = ['.js', '.cjs', '.mjs', '.ts', '.json', '.md', '.yml', '.yaml', '.ps1'];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
  const stack = [ROOT];
  let scanned = 0;
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (scanExts.includes(path.extname(e.name))) {
        const body = readIf(full);
        if (body === null) continue;
        scanned += 1;
        for (const re of CREDENTIAL_PATTERNS) {
          if (re.test(body)) {
            problems.push(\`credential-shaped string in \${path.relative(ROOT, full)}\`);
            break;
          }
        }
      }
    }
  }

  return { problems, judged, scanned };
}

function selfTest() {
  const { runCases } = require('./lib/self-test.cjs');
  const cases = [
    {
      name: 'a credential shape is detected',
      pass: CREDENTIAL_PATTERNS.some((re) => re.test(FIXTURE_CREDENTIAL)),
      detail: 'the mysql URL shape was not matched',
    },
    {
      name: 'an ordinary string is NOT flagged',
      pass: !CREDENTIAL_PATTERNS.some((re) => re.test('the database is on localhost')),
      detail: 'a false positive on plain prose',
    },
    {
      // ⚠️ THE GUARD MUST NOT FLAG ITSELF. This file necessarily contains the patterns, and an earlier
      // version also contained a literal fixture — so a freshly scaffolded project's build was RED on
      // day one, for a file the scaffold had just written. Canaried here so it cannot come back.
      name: 'this validator does not flag its own source',
      pass: !CREDENTIAL_PATTERNS.some((re) => re.test(fs.readFileSync(__filename, 'utf8'))),
      detail: 'the validator flags itself — a scaffolded project would fail its own build',
    },
    {
      name: 'a scratch filename is detected',
      pass: /\\.(bak|orig|rej)$/.test('service.ts.bak'),
      detail: 'a .bak file was not matched',
    },
    {
      name: 'a normal filename is NOT flagged as scratch',
      pass: !/\\.(bak|orig|rej)$/.test('service.ts'),
      detail: 'service.ts was wrongly flagged',
    },
  ];
  return runCases('validate-required-files', cases) === 0;
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--self-test')) return selfTest() ? 0 : 1;

  const r = check();
  if (r.unreadable) {
    console.error(\`[required-files] CANNOT JUDGE — \${r.problems[0]}\`);
    return 2;
  }
  if (r.problems.length) {
    console.error(\`[required-files] ❌ \${r.problems.length} problem(s):\`);
    for (const p of r.problems) console.error(\`   • \${p}\`);
    return 1;
  }
  console.log(\`[required-files] ✅ OK — \${r.judged} check(s), \${r.scanned} text file(s) scanned\`);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { check };
`,
  validateRepoHygiene: `#!/usr/bin/env node
/**
 * validate-repo-hygiene.cjs — new project bootstrap guard: no scratch, no compiled output, no credentials.
 * =================================================================================================
 *
 * A PORTABLE SUBSET of the rules measured elsewhere. Every rule below exists because its absence was
 * silent: the file was committed, nothing complained, and a reader concluded the project was tidy.
 *
 * ⚠️ ERROR IS NOT PASS. If the root cannot be read this exits 2, never 0. A guard that inspects
 * nothing and reports OK is the defect this whole practice set exists to prevent.
 *
 * ── WHAT THIS DOES NOT CHECK ─────────────────────────────────────────────────────────────────
 *   • it does not judge whether a file BELONGS in the tree, only whether it is scratch or output;
 *   • it does not scan binary files, so a credential inside an image or an archive is missed;
 *   • it does not know your ignore rules — a file git would ignore is still flagged if present.
 *
 * Usage:
 *   node scripts/validate-repo-hygiene.cjs
 *   node scripts/validate-repo-hygiene.cjs --self-test
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Files legitimately found at a package root. Extend this, never the exemptions below it — a rule
 * widened until it is quiet is a rule that has stopped working.
 */
const ROOT_ALLOW = new Set([
  '.gitignore', '.gitattributes', '.editorconfig', '.env.example', '.dockerignore',
  '.nvmrc', '.npmrc', '.prettierrc', '.eslintrc', '.eslintrc.js', '.eslintignore',
  'LICENSE', 'LICENCE', 'LICENSE.md', 'LICENCE.md', 'COPYING', 'NOTICE', 'CREDITS.md',
  'README.md', 'README', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'tsconfig.json',
  'jsconfig.json', 'vite.config.js', 'vite.config.ts', 'eslint.config.js', 'vitest.config.ts',
  'index.html', 'netlify.toml', 'vercel.json', 'Dockerfile', 'docker-compose.yml',
]);

/** Directories allowed at a package root. */
const ROOT_DIR_ALLOW = new Set([
  'src', 'scripts', 'docs', 'public', 'test', 'tests', '__tests__', 'packages', 'apps',
  '.github', '.vscode', '.husky', 'migrations', 'prisma', 'node_modules', 'dist', 'build',
  'coverage', '.git', 'config', 'types', 'assets', 'static', 'e2e',
]);

const SCRATCH_RE = /(\\.(bak|orig|rej|swp|swo)$)|(^tmp[-_.])|(^~)|(\\.tmp$)/;

const CREDENTIAL_PATTERNS = [
  /mysql:\\/\\/[^:/\\s]+:[^@\\s]{4,}@/,
  /postgres(?:ql)?:\\/\\/[^:/\\s]+:[^@\\s]{4,}@/,
  /(?:password|passwd|pwd)\\s*[:=]\\s*['"][^'"\\s]{6,}['"]/i,
];

/** Built at runtime on purpose: a literal fixture would be flagged by this file's own scan. */
const FIXTURE_CREDENTIAL = ['mysql:', '//', 'user', ':', 'secret', '123', '@localhost:3306/db'].join('');

const TEXT_EXTS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.yml', '.yaml', '.ps1', '.sql']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vite']);

function readIf(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function check(root) {
  const problems = [];
  let judged = 0;

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    return { problems: [\`the repository root could not be read: \${err.code || err.message}\`], judged: 0, scanned: 0, unreadable: true };
  }

  // R1 — a package root holds only package files.
  judged += 1;
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!ROOT_DIR_ALLOW.has(e.name)) problems.push(\`R1 unexpected directory at the package root: \${e.name}/\`);
    } else if (!ROOT_ALLOW.has(e.name)) {
      problems.push(\`R1 unexpected file at the package root: \${e.name}\`);
    }
  }

  // R2/R3 — walk the tree once for compiled-beside-source and scratch.
  judged += 2;
  const stack = [root];
  const textFiles = [];
  while (stack.length) {
    const cur = stack.pop();
    let list;
    try {
      list = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of list) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(cur, e.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (SCRATCH_RE.test(e.name)) problems.push(\`R3 scratch file tracked: \${rel}\`);
      const ext = path.extname(e.name);
      if (ext === '.js' || ext === '.jsx') {
        for (const srcExt of ['.ts', '.tsx']) {
          const sibling = full.slice(0, -ext.length) + srcExt;
          if (fs.existsSync(sibling)) {
            problems.push(\`R2 compiled output beside its source: \${rel} (source exists)\`);
            break;
          }
        }
      }
      if (TEXT_EXTS.has(ext)) textFiles.push(full);
    }
  }

  // R4 — an unconsumed .txt at a package root is usually session output someone pasted in.
  judged += 1;
  for (const e of entries) {
    if (!e.isDirectory() && e.name.endsWith('.txt')) {
      problems.push(\`R4 .txt at the package root (session output?): \${e.name}\`);
    }
  }

  // R5 — a credential in tracked text cannot be recalled by deleting it later.
  judged += 1;
  for (const file of textFiles) {
    const body = readIf(file);
    if (body === null) continue;
    for (const re of CREDENTIAL_PATTERNS) {
      if (re.test(body)) {
        problems.push(\`R5 credential-shaped string in \${path.relative(root, file).split(path.sep).join('/')}\`);
        break;
      }
    }
  }

  return { problems, judged, scanned: textFiles.length };
}

function selfTest() {
  const fsx = fs;
  const osx = require('os');
  const tmp = fsx.mkdtempSync(path.join(osx.tmpdir(), 'hygiene-'));
  const cases = [];

  const build = (name, build2) => {
    const d = path.join(tmp, name);
    fsx.mkdirSync(d, { recursive: true });
    build2(d);
    return d;
  };
  const write = (d, rel, body) => {
    const full = path.join(d, rel);
    fsx.mkdirSync(path.dirname(full), { recursive: true });
    fsx.writeFileSync(full, body || 'x');
  };

  cases.push({
    name: 'a clean project reports no problems',
    pass: check(build('clean', (d) => { write(d, 'package.json', '{}'); write(d, 'README.md', 'x'); write(d, 'src/a.ts', 'x'); })).problems.length === 0,
    detail: 'a clean fixture was flagged',
  });
  cases.push({
    name: 'R1 flags a stray file at the package root',
    pass: check(build('stray', (d) => { write(d, 'package.json', '{}'); write(d, 'notes.md', 'x'); })).problems.some((p) => p.startsWith('R1')),
    detail: 'notes.md at the root was not flagged',
  });
  cases.push({
    name: 'R2 flags compiled output beside its source',
    pass: check(build('compiled', (d) => { write(d, 'package.json', '{}'); write(d, 'src/a.ts', 'x'); write(d, 'src/a.js', 'x'); })).problems.some((p) => p.startsWith('R2')),
    detail: 'a.js beside a.ts was not flagged',
  });
  cases.push({
    name: 'R3 flags a .bak file',
    pass: check(build('bak', (d) => { write(d, 'package.json', '{}'); write(d, 'src/a.ts.bak', 'x'); })).problems.some((p) => p.startsWith('R3')),
    detail: 'a .bak was not flagged',
  });
  cases.push({
    name: 'R5 flags a credential and does NOT flag this file',
    pass: (() => {
      const bad = check(build('cred', (d) => { write(d, 'package.json', '{}'); write(d, 'src/db.ts', \`const u = '\${FIXTURE_CREDENTIAL}';\`); }));
      const self = CREDENTIAL_PATTERNS.some((re) => re.test(fsx.readFileSync(__filename, 'utf8')));
      return bad.problems.some((p) => p.startsWith('R5')) && !self;
    })(),
    detail: 'either the fixture was not flagged, or this file flags itself',
  });
  cases.push({
    name: 'a sub-directory that is not allowed at the root is reported, an allowed one is not',
    pass: (() => {
      const ok = check(build('dirs', (d) => { write(d, 'package.json', '{}'); write(d, 'src/a.ts', 'x'); write(d, 'docs/a.md', 'x'); }));
      const bad = check(build('dirs2', (d) => { write(d, 'package.json', '{}'); write(d, 'junk/a.ts', 'x'); }));
      return ok.problems.length === 0 && bad.problems.some((p) => p.includes('junk'));
    })(),
    detail: 'an allowed directory was flagged, or a stray one was missed',
  });

  try {
    fsx.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* the OS owns its temp dir */
  }

  let failures = 0;
  console.log('\\n[hygiene] --self-test');
  for (const c of cases) {
    console.log(\`   \${c.pass ? '✅' : '❌'} \${c.name}\${c.pass ? '' : \` — \${c.detail}\`}\`);
    if (!c.pass) failures += 1;
  }
  console.log(\`\\n[hygiene] \${cases.length - failures}/\${cases.length} passed\`);
  return failures === 0;
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--self-test')) return selfTest() ? 0 : 1;

  const r = check(ROOT);
  if (r.unreadable) {
    console.error(\`[hygiene] CANNOT JUDGE — \${r.problems[0]}\`);
    return 2;
  }
  if (r.problems.length) {
    console.error(\`[hygiene] ❌ \${r.problems.length} problem(s):\`);
    for (const p of r.problems.slice(0, 40)) console.error(\`   • \${p}\`);
    if (r.problems.length > 40) console.error(\`   … (+\${r.problems.length - 40} more)\`);
    return 1;
  }
  console.log(\`[hygiene] ✅ OK — \${r.judged} rule(s), \${r.scanned} text file(s) scanned\`);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { check };
`,

  validateAgentDocs: `#!/usr/bin/env node
/**
 * validate-agent-docs.cjs — new project bootstrap guard: an instruction file the client cannot load is a rule that does not exist.
 * =================================================================================================
 *
 * THE DEFECT THIS CLOSES, MEASURED: agent definition files declared \`argumentHint:\` (camelCase)
 * instead of \`argument-hint:\`. The client did not report an error — it silently skipped the files, so
 * two agents were unusable and nobody knew. A frontmatter key the parser does not recognise is not a
 * warning; it is a rule that never loads, and a rule that does not load is indistinguishable from one
 * that does not exist.
 *
 * ⚠️ NO CORPUS IS NOT A FAILURE. When \`.github/instructions/\` is absent the instruction checks are
 * SKIPPED, LOUDLY, and this exits 0. A crash is neither skipped nor loud: it reads as a broken
 * repository and sends the reader hunting for a corrupt install. (That exact crash was measured.)
 *
 * ── WHAT THIS DOES NOT CHECK ─────────────────────────────────────────────────────────────────
 *   • it does not know whether a rule FIRES — only that the file is well-formed and reachable;
 *   • it does not judge the CONTENT of a rule, only its frontmatter and its citations;
 *   • \`applyTo\` is checked for PRESENCE, not for whether the glob matches any real file.
 *
 * Usage:
 *   node scripts/validate-agent-docs.cjs
 *   node scripts/validate-agent-docs.cjs --self-test
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Keys the client actually understands. An unknown key is judged on shape; a known key is trusted. */
const KNOWN_KEBAB = new Set([
  'description', 'applyto', 'argument-hint', 'tools', 'user-invocable',
  'disable-model-invocation', 'mode', 'model', 'title', 'name', 'target', 'handoffs',
]);

function readIf(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function listMarkdown(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Split YAML frontmatter from the body. Returns { keys, body } or null when there is no frontmatter. */
function frontmatter(text) {
  const m = text.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?([\\s\\S]*)$/);
  if (!m) return null;
  const keys = m[1]
    .split(/\\r?\\n/)
    .map((l) => l.match(/^([A-Za-z][A-Za-z-]*)\\s*:/))
    .filter(Boolean)
    .map((x) => x[1]);
  return { keys, body: m[2] };
}

/** Repo-relative paths cited in prose, so a doc cannot name a file that no longer exists. */
function citations(body) {
  const out = new Set();
  const re = /(?:^|[\\s\`('"])((?:\\.github|scripts|docs|src|nest)\\/[A-Za-z0-9._/-]+\\.[A-Za-z0-9]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) out.add(m[1]);
  return [...out];
}

function check(root) {
  const problems = [];
  const notes = [];
  let judged = 0;

  const instrDir = path.join(root, '.github', 'instructions');
  const agentDir = path.join(root, '.github', 'agents');
  const hasInstr = fs.existsSync(instrDir);
  const hasAgents = fs.existsSync(agentDir);

  if (!hasInstr) {
    notes.push('instruction checks SKIPPED — .github/instructions/ is not on this machine');
  }
  if (!hasAgents) {
    notes.push('agent checks SKIPPED — .github/agents/ is not on this machine');
  }

  const files = [
    ...listMarkdown(instrDir).map((f) => ({ file: f, kind: 'instruction' })),
    ...listMarkdown(agentDir).map((f) => ({ file: f, kind: 'agent' })),
  ];

  for (const { file, kind } of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const body = readIf(file);
    if (body === null) {
      problems.push(\`C0 could not read \${rel} — cannot judge it\`);
      continue;
    }
    judged += 1;
    const fm = frontmatter(body);

    if (!fm) {
      problems.push(\`C1 \${rel} has no YAML frontmatter block (--- … ---)\`);
      continue;
    }

    // C2 — the measured defect: an UNKNOWN camelCase key is silently ignored.
    // ⚠️ \`applyTo\` is camelCase and CORRECT — it is the documented key name. So a known key is
    // accepted whatever its case, and only an unrecognised key is judged on its shape. Flagging
    // \`applyTo\` would have made every correctly-configured project fail on day one.
    for (const key of fm.keys) {
      const lower = key.toLowerCase();
      if (KNOWN_KEBAB.has(lower)) continue;
      if (key.includes('-')) continue;
      problems.push(\`C2 \${rel} frontmatter key "\${key}" is not kebab-case — the client will IGNORE it silently\`);
    }

    // C3 — an instruction with no applyTo may never load.
    if (kind === 'instruction' && !fm.keys.some((k) => k.toLowerCase() === 'applyto')) {
      problems.push(\`C3 \${rel} declares no applyTo — it may never load\`);
    }
    if (kind === 'agent' && !fm.keys.some((k) => k.toLowerCase() === 'description')) {
      problems.push(\`C3 \${rel} declares no description — the picker cannot explain it\`);
    }

    // C4 — a citation to a file that does not exist is a claim nothing backs.
    for (const c of citations(fm.body)) {
      const target = path.join(root, c);
      if (!fs.existsSync(target)) problems.push(\`C4 \${rel} cites "\${c}" which does not exist\`);
    }
  }

  // C5 — open work belongs in an issue, not in a document that reads as a spec.
  const docsDir = path.join(root, 'docs');
  for (const file of listMarkdown(docsDir)) {
    const body = readIf(file);
    if (body === null) continue;
    judged += 1;
    if (/^\\s*[-*]\\s+\\[ \\]/m.test(body) && !body.includes('<!-- doc-tasks-allowed -->')) {
      problems.push(
        \`C5 \${path.relative(root, file).split(path.sep).join('/')} holds an open checkbox — work belongs in an issue\`,
      );
    }
  }

  return { problems, notes, judged, files: files.length, hasInstr, hasAgents };
}

function selfTest() {
  const fsx = fs;
  const osx = require('os');
  const tmp = fsx.mkdtempSync(path.join(osx.tmpdir(), 'agentdocs-'));
  const cases = [];

  const build = (name, build2) => {
    const d = path.join(tmp, name);
    fsx.mkdirSync(d, { recursive: true });
    build2(d);
    return d;
  };
  const write = (d, rel, body) => {
    const full = path.join(d, rel);
    fsx.mkdirSync(path.dirname(full), { recursive: true });
    fsx.writeFileSync(full, body);
  };

  cases.push({
    name: 'no instruction corpus is SKIPPED LOUDLY, never a crash',
    pass: (() => {
      const r = check(build('empty', () => {}));
      return r.problems.length === 0 && r.notes.some((n) => /SKIPPED/.test(n));
    })(),
    detail: 'an absent corpus produced a problem or no notice',
  });
  cases.push({
    name: 'a camelCase frontmatter key is flagged',
    pass: check(build('camel', (d) => write(d, '.github/instructions/a.instructions.md', '---\\nargumentHint: "x"\\napplyTo: "**"\\n---\\nbody\\n'))).problems.some((p) => p.startsWith('C2')),
    detail: 'argumentHint was not flagged',
  });
  cases.push({
    name: 'correct kebab-case keys are accepted',
    pass: check(build('kebab', (d) => write(d, '.github/instructions/a.instructions.md', '---\\ndescription: d\\napplyTo: "**"\\nargument-hint: "x"\\n---\\nbody\\n'))).problems.length === 0,
    detail: 'a correct file was flagged',
  });
  cases.push({
    name: 'a missing applyTo is flagged',
    pass: check(build('noapply', (d) => write(d, '.github/instructions/a.instructions.md', '---\\ndescription: d\\n---\\nbody\\n'))).problems.some((p) => p.startsWith('C3')),
    detail: 'a missing applyTo was not flagged',
  });
  cases.push({
    name: 'a missing frontmatter block is flagged',
    pass: check(build('nofm', (d) => write(d, '.github/instructions/a.instructions.md', 'no frontmatter here\\n'))).problems.some((p) => p.startsWith('C1')),
    detail: 'a file with no frontmatter was not flagged',
  });
  cases.push({
    name: 'a dangling citation is flagged, a real one is not',
    pass: (() => {
      const d = build('cites', (dd) => {
        write(dd, '.github/instructions/a.instructions.md', '---\\napplyTo: "**"\\n---\\nSee \`docs/real.md\` and \`scripts/gone.cjs\`.\\n');
        write(dd, 'docs/real.md', 'x\\n');
      });
      const r = check(d);
      return r.problems.some((p) => p.includes('scripts/gone.cjs')) && !r.problems.some((p) => p.includes('docs/real.md'));
    })(),
    detail: 'either the dangling citation was missed or a real one was flagged',
  });
  cases.push({
    name: 'an open checkbox under docs/ is flagged, an opted-in template is not',
    pass: (() => {
      const bad = check(build('tasks', (dd) => write(dd, 'docs/spec.md', '- [ ] do a thing\\n')));
      const ok = check(build('tasks-ok', (dd) => write(dd, 'docs/tmpl.md', '<!-- doc-tasks-allowed -->\\n- [ ] placeholder\\n')));
      return bad.problems.some((p) => p.startsWith('C5')) && !ok.problems.some((p) => p.startsWith('C5'));
    })(),
    detail: 'the checkbox rule did not fire, or fired on an opted-in template',
  });
  cases.push({
    name: 'this validator does not crash and reports a real verdict on its own repo root',
    pass: (() => {
      try {
        const r = check(ROOT);
        return Array.isArray(r.problems);
      } catch {
        return false;
      }
    })(),
    detail: 'check() threw on the real root',
  });

  try {
    fsx.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* the OS owns its temp dir */
  }

  let failures = 0;
  console.log('\\n[agent-docs] --self-test');
  for (const c of cases) {
    console.log(\`   \${c.pass ? '✅' : '❌'} \${c.name}\${c.pass ? '' : \` — \${c.detail}\`}\`);
    if (!c.pass) failures += 1;
  }
  console.log(\`\\n[agent-docs] \${cases.length - failures}/\${cases.length} passed\`);
  return failures === 0;
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--self-test')) return selfTest() ? 0 : 1;

  const r = check(ROOT);
  for (const n of r.notes) console.log(\`[agent-docs] ℹ \${n}\`);

  if (r.problems.length) {
    console.error(\`[agent-docs] ❌ \${r.problems.length} problem(s):\`);
    for (const p of r.problems) console.error(\`   • \${p}\`);
    return 1;
  }
  if (r.files === 0 && !r.hasInstr && !r.hasAgents) {
    console.log('[agent-docs] ✅ OK — nothing to check here (skipped loudly above, not passed silently)');
    return 0;
  }
  console.log(\`[agent-docs] ✅ OK — \${r.files} file(s) checked, \${r.judged} judged\`);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { check };
`,

};

module.exports = { TEMPLATES };
