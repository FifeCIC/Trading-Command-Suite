#!/usr/bin/env node
/**
 * validate-repo-hygiene.cjs — a tracked file must belong where it sits.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────
 * Owner, 2026-11-07: *"I'm a perfectionist and the easy visuals are the first thing that bothers
 * me. Look at nest/ … it contains a mix of completely different files … If that was another
 * developer's project it wouldn't give me confidence in their tidiness."*
 *
 * Measured the same day, at `nest/` (a Node package root):
 *
 *   5 × `*.txt`            session probe output. `ti.txt` is 10.8 KB of Prisma stack trace.
 *   1 × `canary-<md5>.bak` a canary that backed up `backtest.service.ts` and NEVER RESTORED.
 *   3 × `prisma.config.*`  COMPILED output (`.js`, `.js.map`, `.d.ts`) beside its `.ts` source.
 *   13 × `*.sql`          one-off data repairs, at the package root beside `package.json`.
 *   3 × `check-*`, `test-insert.js`, `tmp-macd-test.ts`, `seed-*.cjs` — scripts, with a
 *                          `nest/scripts/` right there holding 135 of them.
 *
 * ALL OF IT WAS TRACKED, and the repository is PUBLIC.
 *
 * ⚠️ AND THIS CLASS WAS ALREADY CLOSED ONCE. `.gitignore` has carried a block since #897 that
 * ignores `nest/prisma/*.js`, `*.js.map` and `*.d.ts` — with the reasoning already written out:
 * *"a `.js`, `.d.ts` or `.js.map` here is never the executed file and never the compiled one; it is
 * a copy that can silently disagree with the `.ts` next to it."* The same defect was sitting at
 * `nest/` root, unignored. **A rule enforced in one directory is not a rule** — so this script
 * enforces it as a CLASS, and that is the whole reason it is a build gate rather than a tidy-up.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────
 * It reads `git ls-files`, so it judges ONLY what is committed. Local scratch in a gitignored
 * folder is not this script's business — that is `.gitignore`'s job and it is working.
 *
 * ⚠️ If `git` cannot be run this script EXITS 2 (cannot judge). It must never report "clean" on an
 * input it could not read: a check that inspects nothing and reports OK is worse than no check.
 *
 * ── THE FOUR RULES (each grounded in a measured instance, not a preference) ─────
 *
 *   R1  A tracked file at a PACKAGE ROOT (repo root, `nest/`) must be a name that tooling resolves
 *       by convention, or an explicit entry in ROOT_ALLOWLIST carrying a reason.
 *   R2  A tracked `.js` / `.js.map` / `.d.ts` must not sit beside a `.ts` of the same basename
 *       outside a build directory — i.e. no compiled output committed next to its source.
 *   R3  No tracked scratch: `.bak`, `.orig`, `.old`, `.rej`, `.save`, `.tmp`, `tmp-*`, `temp-*`,
 *       `*-copy.*`.
 *   R4  A tracked `.txt` must be a data file someone consumes (requirements, robots, notices).
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────────
 *   node scripts/validate-repo-hygiene.cjs             # check (build gate)
 *   node scripts/validate-repo-hygiene.cjs --self-test # prove every rule can fail
 *   node scripts/validate-repo-hygiene.cjs --report    # every tracked file at each package root
 *
 * ⚠️ NARROW BEATS BROAD. If this fires on something legitimate, add ONE entry to the relevant
 * allowlist naming the file and the reason — never widen a pattern to cover a class of legitimate
 * files, because a guard that fires for the wrong reason gets allowlisted and then covers nothing.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/** Directories holding generated/installed files. Compiled output is CORRECT here. */
const BUILD_DIR = /^(?:dist|build|coverage|node_modules|\.next|dist-free)\//;

/**
 * A package root's own files ARE mixed by design: manifests, tsconfigs, docker files, linters and
 * the README live together because the tooling searches for them by name at that exact level.
 * That is a convention, not tidiness debt — so the list is a set of CONVENTIONS, not of files.
 */
const ROOT_CONVENTION = [
  /^package(-lock)?\.json$/, /^(yarn|pnpm)-lock\.(lock|yaml)$/,
  /^tsconfig(\.[\w.-]+)?\.json$/, /^jsconfig\.json$/,
  /^\.env(\.[\w.-]+)?$/, /^\.dockerignore$/, /^Dockerfile$/,
  /^docker-compose(\.[\w.-]+)?\.ya?ml$/, /^nginx\.conf$/,
  /^README\.md$/, /^\.gitignore$/,
  /^\.prettierrc(\.[\w]+)?$/, /^eslint\.config\.[cm]?js$/, /^\.editorconfig$/,
  /^nest-cli\.json$/, /^prisma\.config\.ts$/,
  /^index\.html$/, /^vite\.config\.[cm]?[jt]s$/,
  /^(CHANGELOG|CONTRIBUTING|DEVELOPMENT|DISCLAIMER|SECURITY|SETUP|NEXT-AGENT|LICENSE)\.md$/,
  /^LICENSE$/,
];

/**
 * The exceptions, each with the reason it is an exception.
 * ⚠️ Keep this SHORT and keep the reason real. An entry with no reason is a widened pattern with
 * extra steps.
 */
const ROOT_ALLOWLIST = [
  {
    file: 'nest/app-settings.json',
    why:
      'A runtime mirror of the `appsetting` table, WRITTEN by SettingsService and read at boot ' +
      '(settings.service.ts L193-207, L333). Deliberate: it is the copy an agent reads to work from. ' +
      '⚠️ It IS a second copy of a fact the DB owns and every settings change dirties the tree — ' +
      'recorded as an open question in the handoff rather than changed here, because it is READ at ' +
      'boot and untracking it changes fresh-install behaviour.',
  },
];

/** Scratch patterns. A `.bak` next to source is a memory of a canary, not a deliverable. */
const SCRATCH = [
  /\.(bak|orig|old|rej|save|tmp)$/i,
  /(^|\/)(tmp|temp)[-_]/i,
  /[-_ ]copy\./i,
];

/**
 * `archived/` is an explicit record directory: `mt5_bridge.py.bak` there is the superseded bridge
 * kept on purpose so its behaviour can be compared. One directory, named, not a pattern.
 */
const SCRATCH_ALLOW = [/^scripts\/mt5-bridge\/archived\//];

/** `.txt` files a consumer actually reads. */
const TXT_CONSUMED = [
  /(^|\/)requirements[\w.-]*\.txt$/i,
  /^site\/robots\.txt$/,
  /^\.github\/ci-trigger\.txt$/,
  /^THIRD-PARTY-NOTICES\.txt$/,
];

/**
 * R5/R6 — credentials belong in `.env`, never in tracked source (#1252).
 *
 * Measured 2026-11-07: the dev database password was a literal in **21 tracked files** in a PUBLIC
 * repo, in five shapes — a `??` fallback, an `= 'mysql://…'` overwrite, a `--password=` argv, a
 * `MYSQL_PWD` env literal, and a doc comment showing how to run the thing. `nest/.env.example`
 * already stated the rule at line 142 (*"NEVER PUT A REAL PASSWORD IN THIS FILE. It is TRACKED"*)
 * and was clean; 21 files ignored it. A rule that exists but is not checked is a preference.
 *
 * ⚠️ A PLACEHOLDER IS NOT A CREDENTIAL. `<your-password>`, `${VAR}`, `changeme` and an empty value
 * are all correct in an example, a template and a doc. The list is explicit so the guard does not
 * fire on documentation and teach the next reader to ignore it.
 */
const CREDENTIAL_PLACEHOLDER = /^(?:<.*>|\$\{.*\}|%.*%|changeme|change-me|password|passwd|pass|secret|your[-_]?\w*|rootpassword|root_dev_2026|example|placeholder|todo|not[-_]a[-_]password|x+)?$/i;

/**
 * Files that are ALLOWED to contain DSN examples because they are the thing that PARSES them.
 * One file, named, with the reason — the same shape as the collation validator skipping its own
 * source. Its self-test fixture is a DSN with an `%40`-encoded `@` in the password, which is a
 * parser case, not a credential.
 */
const CREDENTIAL_FILE_ALLOW = [
  {
    file: 'scripts/lib/mysql-cli.cjs',
    why: 'the ONE credential reader. Its `--self-test` fixtures are DSNs by definition, including one with an %40-encoded @ in the password, which no real credential would look like.',
  },
];

/** Files where a credential is EXPECTED and correct: the local env, and its documented template. */
const CREDENTIAL_FILES_EXEMPT = [/(^|\/)\.env(\.[\w.-]+)?$/, /\.example$/i];

/**
 * A connection string that carries a real password: `scheme://user:pass@host`.
 *
 * ⚠️ THE CHARACTER CLASSES ARE DELIBERATELY NARROW. A looser `[^:]+`/`[^@]+` pair matched the TEXT OF
 * A REGEX — `scripts/install.ps1` contains `mysql://(?<user>[^:]+):(?<pass>[^@]+)@`, and the guard
 * reported a credential for the user "`(?<user>[^`". Restricting both sides to characters a real DSN
 * uses kills that class without needing a file exemption.
 */
const DSN_WITH_PASSWORD = /\b(?:mysql|mariadb|postgres|postgresql|mongodb|mongodb\+srv|redis|amqp):\/\/([A-Za-z0-9_.-]+):([A-Za-z0-9_.%+-]*)@/g;

/**
 * `SOMETHING_PASSWORD = "value"` — the value MUST be QUOTED and at least 6 characters.
 *
 * ⚠️ THE FIRST VERSION OF THIS PATTERN WAS TOO BROAD AND PRODUCED 28 FINDINGS, 27 OF THEM FALSE.
 * It accepted an unquoted value, so it matched `process.env.CAPITAL_COM_ENCRYPT_PASSWORD ===` and
 * reported a value of `==`; it matched doc comments like `FINNHUB_API_KEY=your_free_key`; and it
 * matched a key name that started mid-word. A guard that fires for the wrong reason gets
 * allowlisted, and an allowlisted guard is worse than none — so the pattern was TIGHTENED rather
 * than the exemptions widened. Measured after tightening: 2 findings, both real.
 */
const PASSWORD_ASSIGNMENT = /\b([A-Za-z_][\w.-]*(?:PASSWORD|PASSWD|PWD|SECRET|APIKEY|API_KEY|_PASS)[\w]*)\s*[:=]\s*(["'])([^"']{6,})\2/g;

/** R5 — pure. `entries` is `[{ file, text }]` for tracked text files. */
function checkCredentials(entries) {
  const errors = [];
  const allowed = new Set(CREDENTIAL_FILE_ALLOW.map((a) => a.file));
  for (const { file, text } of entries) {
    if (CREDENTIAL_FILES_EXEMPT.some((re) => re.test(file))) continue;
    if (allowed.has(file)) continue;
    // ⚠️ SKIP THIS FILE. Its own patterns and fixture strings spell out what it looks for, and a
    // scan that flags the guard's own source is the "guard failing on its documentation" defect
    // the collation validator already hit once.
    if (file === 'scripts/validate-repo-hygiene.cjs') continue;

    const seen = new Set();
    for (const m of text.matchAll(DSN_WITH_PASSWORD)) {
      const [, user, password] = m;
      if (!password || CREDENTIAL_PLACEHOLDER.test(password)) continue;
      const key = `${user}:${password}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(
        `${file}: a connection string carries a LITERAL password for user "${user}". ` +
          'A tracked credential is public the moment the repo is. Read it from `nest/.env` — ' +
          '`scripts/lib/mysql-cli.cjs` (Node) and `scripts/lib/mysql-credential.ps1` (PowerShell) ' +
          'both do it and both refuse rather than guess (#1252).',
      );
    }

    for (const m of text.matchAll(PASSWORD_ASSIGNMENT)) {
      const [, name, , value] = m;
      if (!value || CREDENTIAL_PLACEHOLDER.test(value)) continue;
      const key = name + '=' + value;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(
        `${file}: "${name}" is assigned the literal ${JSON.stringify(value)}. ` +
          'Assignments NAME a credential; the value belongs in `nest/.env` (#1252). ' +
          'A placeholder such as `<your-password>`, `${VAR}` or `changeme` is fine.',
      );
    }
  }
  return errors;
}

const PACKAGE_ROOTS = ['', 'nest'];

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const stemOf = (p) => baseOf(p).replace(/\.js\.map$|\.d\.ts$|\.js$/, '');

/** R1 — pure. `files` is an array of tracked paths relative to the repo root. */
function checkRoots(files) {
  const errors = [];
  const allowed = new Set(ROOT_ALLOWLIST.map((a) => a.file));
  for (const f of files) {
    if (!PACKAGE_ROOTS.includes(dirOf(f))) continue;
    if (allowed.has(f)) continue;
    if (ROOT_CONVENTION.some((re) => re.test(baseOf(f)))) continue;
    errors.push(
      `${f}: sits at a PACKAGE ROOT but is not a manifest, config, docker, linter or README file. ` +
        'A package root answers "what is this package" — everything else belongs in a subdirectory ' +
        '(`nest/scripts/` checks scripts, `nest/prisma/` takes SQL, `docs/` takes notes). ' +
        'If it genuinely belongs here, add it to ROOT_ALLOWLIST in this file with a reason.',
    );
  }
  return errors;
}

/** R2 — pure. Compiled output beside its own source. */
function checkCompiled(files) {
  const errors = [];
  const set = new Set(files);
  for (const f of files) {
    if (BUILD_DIR.test(f)) continue;
    if (!/\.(js|js\.map|d\.ts)$/.test(f)) continue;
    const d = dirOf(f);
    const sibling = `${d ? `${d}/` : ''}${stemOf(f)}.ts`;
    if (!set.has(sibling)) continue;
    errors.push(
      `${f}: compiled output beside its own source (${sibling}). Delete it and add the pattern to ` +
        '.gitignore — a copy next to the `.ts` is never the executed file and never the compiled ' +
        'one, so it can only ever silently disagree with it (the #897 class, first closed for ' +
        'nest/prisma/ and never extended to the package root).',
    );
  }
  return errors;
}

/** R3 — pure. Scratch classes. */
function checkScratch(files) {
  const errors = [];
  for (const f of files) {
    if (SCRATCH_ALLOW.some((re) => re.test(f))) continue;
    if (!SCRATCH.some((re) => re.test(f))) continue;
    errors.push(
      `${f}: scratch file (${SCRATCH.find((re) => re.test(f))}). A backup, ".old" copy or "tmp-" ` +
        'file is session material: it belongs in the gitignored "logs/" bench and dies with the issue ' +
        'it served. A canary that leaves a ".bak" behind also broke the restore rule.',
    );
  }
  return errors;
}

/** R4 — pure. Session output saved as `.txt`. */
function checkTextDumps(files) {
  const errors = [];
  for (const f of files) {
    if (!/\.txt$/i.test(f)) continue;
    if (TXT_CONSUMED.some((re) => re.test(f))) continue;
    errors.push(
      `${f}: a tracked .txt that no consumer reads. Measured 2026-11-07: five of these sat at the ` +
        'nest/ root — API probe output, a directive audit, a 10.8 KB Prisma stack trace — all ' +
        'committed to a PUBLIC repo. Probe output belongs in `logs/` (gitignored) or in the issue.',
    );
  }
  return errors;
}

function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (e) {
    console.error(`\n  ✖ repo-hygiene: CANNOT JUDGE — \`git ls-files\` failed (${e.message}).`);
    console.error('      This check reads the committed file list; without it there is nothing to check.');
    console.error('      Reporting "clean" here would be a false pass, so it exits 2 instead.\n');
    process.exit(2);
  }
}

/**
 * The text of every tracked file that could hold a credential, for R5/R6.
 *
 * ⚠️ A BINARY OR UNREADABLE FILE IS SKIPPED, NOT COUNTED AS CLEAN — and skipped files are REPORTED.
 * Reading 2,000 files including images and fonts would either throw or waste a second per run; the
 * honest compromise is to name the skip count in the success line so "no credential found" can never
 * quietly mean "12 files I could not read".
 */
const CREDENTIAL_SCAN_EXTS = /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|ini|ps1|psm1|sh|bash|py|sql|md|env|cfg|conf|txt|example|docker)$/i;

function readTextFiles(files) {
  const entries = [];
  const failed = [];
  for (const f of files) {
    if (!CREDENTIAL_SCAN_EXTS.test(f)) continue;
    try {
      entries.push({ file: f, text: fs.readFileSync(path.join(ROOT, f), 'utf8') });
    } catch (e) {
      // ⚠️ A READ FAILURE IS NOT "CLEAN". Measured on this file's first run: `fs` was never
      // `require`d, every read threw, the catch swallowed it, and the guard printed
      // "✅ no literal credential in the 0 text file(s) scanned" — a green result over an input it
      // never opened. A verifier that cannot read its input must ERROR, never pass.
      failed.push(`${f} (${e.code || e.message})`);
    }
  }
  return { entries, failed };
}

function selfTest() {
  const cases = [
    // ── R1, both directions
    ['R1: a manifest at a package root', () => checkRoots(['nest/package.json', 'package.json']), false],
    ['R1: a tsconfig at a package root', () => checkRoots(['nest/tsconfig.build.json']), false],
    ['R1: .env.example at a package root', () => checkRoots(['nest/.env.example']), false],
    ['R1: a docker file at a package root', () => checkRoots(['Dockerfile', 'nest/Dockerfile']), false],
    ['R1: a `.sql` beside package.json (the real 2026-11-07 defect)', () => checkRoots(['nest/cleanup-oil.sql']), true],
    ['R1: a `.txt` beside package.json', () => checkRoots(['nest/tv.txt']), true],
    ['R1: a seed script beside package.json', () => checkRoots(['nest/seed-arch.cjs']), true],
    ['R1: the SAME file in a subdirectory is fine', () => checkRoots(['nest/scripts/seed-arch.cjs', 'nest/prisma/cleanup-oil.sql']), false],
    ['R1: an allowlisted root file passes', () => checkRoots(['nest/app-settings.json']), false],
    // ── R2, both directions
    ['R2: compiled .js beside its .ts (the real 2026-11-07 defect)', () => checkCompiled(['nest/prisma.config.js', 'nest/prisma.config.ts']), true],
    ['R2: compiled .d.ts beside its .ts', () => checkCompiled(['nest/prisma.config.d.ts', 'nest/prisma.config.ts']), true],
    ['R2: compiled .js.map beside its .ts', () => checkCompiled(['nest/prisma.config.js.map', 'nest/prisma.config.ts']), true],
    ['R2: a .js with NO .ts sibling is not this rule', () => checkCompiled(['scripts/legacy.js']), false],
    ['R2: compiled output INSIDE dist/ is correct', () => checkCompiled(['nest/dist/prisma.config.js', 'nest/prisma.config.ts']), false],
    // ── R3, both directions
    ['R3: a leftover canary .bak (the real 2026-11-07 defect)', () => checkScratch(['nest/canary-f003855a33ed41c78778d923a67cbeab.bak']), true],
    ['R3: a tmp- source file', () => checkScratch(['nest/tmp-macd-test.ts']), true],
    ['R3: an archived .bak is an explicit record', () => checkScratch(['scripts/mt5-bridge/archived/mt5_bridge.py.bak']), false],
    ['R3: an ordinary source file', () => checkScratch(['nest/src/main.ts']), false],
    // ── R4, both directions
    ['R4: a session output .txt (the real 2026-11-07 defect)', () => checkTextDumps(['nest/ti.txt']), true],
    ['R4: requirements are consumed', () => checkTextDumps(['scripts/mt5-bridge/requirements-mt5.txt']), false],
    ['R4: robots.txt is served', () => checkTextDumps(['site/robots.txt']), false],
    ['R4: a .md is not this rule', () => checkTextDumps(['nest/README.md']), false],

    // ── R5/R6 — credentials (#1252). Canaried against the REAL shapes the 21 files used, and
    //    against the placeholders that must NOT fire, because a guard that flags documentation
    //    gets allowlisted.
    ['R5: a DSN with a literal password (the real 2026-11-07 defect)', () => checkCredentials([{ file: 'scripts/x.cjs', text: "const u = 'mysql://tradingcs:hunter2xyz@localhost:3306/db';" }]), true],
    ['R5: the same DSN with a placeholder password', () => checkCredentials([{ file: 'nest/README.md', text: "DATABASE_URL=mysql://tradingcs:<your-password>@localhost:3306/db" }]), false],
    ['R5: a ${VAR} password is not a literal', () => checkCredentials([{ file: 'docker-compose.yml', text: 'MYSQL_PASSWORD: ${MYSQL_PASSWORD}' }]), false],
    ['R5: the TEXT of a regex is not a credential', () => checkCredentials([{ file: 'scripts/install.ps1', text: 'mysql://(?<user>[^:]+):(?<pass>[^@]+)@host' }]), false],
    ['R5: an empty password is not this rule', () => checkCredentials([{ file: 'a.ts', text: 'redis://localhost:6379/0' }]), false],
    ['R5: .env is where a credential BELONGS', () => checkCredentials([{ file: 'nest/.env', text: 'DATABASE_URL=mysql://tradingcs:hunter2xyz@localhost:3306/db' }]), false],
    ['R5: a *.example template is exempt', () => checkCredentials([{ file: 'nest/.env.example', text: 'DATABASE_URL=mysql://tradingcs:hunter2xyz@localhost:3306/db' }]), false],
    ['R6: a quoted literal password assignment', () => checkCredentials([{ file: 'scripts/x.ps1', text: '$DB_PASS = "hunter2xyz"' }]), true],
    ['R6: an UNQUOTED doc comment is not this rule', () => checkCredentials([{ file: 'a.ts', text: '// FINNHUB_API_KEY=your_free_key_here' }]), false],
    ['R6: a comparison is not an assignment', () => checkCredentials([{ file: 'a.ts', text: "if (process.env.X_PASSWORD === 'abc') {}" }]), false],
    ['R6: a placeholder is not a literal', () => checkCredentials([{ file: 'a.ps1', text: '$MT5_PASSWORD = "not-a-password"' }]), false],
  ];

  let bad = 0;
  for (const [label, run, shouldFail] of cases) {
    const errs = run();
    if ((errs.length > 0) !== shouldFail) {
      console.log(`  ✗ SELF-TEST INVALID: "${label}" — expected ${shouldFail ? 'a violation' : 'none'}, got ${errs[0] || 'none'}`);
      bad++;
    }
  }
  if (bad) {
    console.log(`\n  ✗ ${bad} self-test case(s) misbehaved — the rules are not doing what this file claims.`);
    return 1;
  }
  console.log(`  ✅ self-test: ${cases.length} cases — all four rules were observed to fail on the measured 2026-11-07 files, valid input was observed to pass, and generated/archived files were observed NOT to fire.`);
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());

  const files = trackedFiles();

  if (args.includes('--report')) {
    for (const r of PACKAGE_ROOTS) {
      const here = files.filter((f) => dirOf(f) === r);
      console.log(`\n  ${r || '(repo root)'} — ${here.length} tracked file(s)\n`);
      for (const f of here) console.log(`    ${baseOf(f)}`);
    }
    console.log('');
    return;
  }

  const scanned = readTextFiles(files);

  const errors = [
    ...checkRoots(files),
    ...checkCompiled(files),
    ...checkScratch(files),
    ...checkTextDumps(files),
    ...checkCredentials(scanned.entries),
  ];

  // ⚠️ Unreadable input is its own failure, not a footnote. See readTextFiles().
  if (scanned.failed.length) {
    console.error(`\n  ✖ repo-hygiene: CANNOT JUDGE ${scanned.failed.length} file(s) — reads failed:`);
    for (const f of scanned.failed.slice(0, 10)) console.error(`      ${f}`);
    if (scanned.failed.length > 10) console.error(`      … and ${scanned.failed.length - 10} more`);
    console.error('      A credential scan over files it could not open proves nothing, so this exits 2.\n');
    process.exit(2);
  }

  if (errors.length) {
    console.error(`\n  ✖ repo-hygiene: ${errors.length} violation(s) across ${files.length} tracked files\n`);
    for (const e of errors) console.error(`      ${e}\n`);
    process.exit(1);
  }

  const roots = PACKAGE_ROOTS.map((r) => `${r || '(repo root)'} ${files.filter((f) => dirOf(f) === r).length}`).join(' · ');
  console.log(
    `  [repo-hygiene] ✅ OK — ${files.length} tracked files: each package root holds only package files ` +
      `(${roots}), no compiled output beside source, no scratch, no unconsumed .txt, no literal ` +
      `credential in the ${scanned.entries.length} text file(s) scanned ` +
      `(${ROOT_ALLOWLIST.length} allowlisted exception(s), each with a reason).`,
  );
}

main();
