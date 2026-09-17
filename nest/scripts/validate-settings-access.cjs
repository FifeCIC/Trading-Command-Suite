#!/usr/bin/env node
/**
 * validate-settings-access.cjs — fail the build when a setting is read without going through the registry.
 *
 * WHY THIS EXISTS (#849)
 * ----------------------
 * The defect that produced #849 was not a wrong value. It was that **four stores held overlapping ideas
 * of "a setting"**, so a control could save successfully into one that nothing enforces.
 * `settings-registry.ts` plus `SettingsResolverService` fixed the *current* instances. Nothing stopped the
 * next site being added — and that happens in one of two forms:
 *
 *   1. `process.env.SOME_LIMIT` — a variable that was the source of truth before it was migrated.
 *   2. a raw `prisma.globalSetting.<method>(...)` outside the settings module — reading the table
 *      directly instead of asking the resolver, bypassing provenance and the declared default.
 *
 * This gate closes both. Same class as `validate-threshold-sources.cjs`: a rule learned once, enforced
 * mechanically thereafter.
 *
 * TWO RULES, AND WHY THEY ARE DIFFERENT STRENGTHS
 * -----------------------------------------------
 * **Rule A (absolute) — a migrated env var must not be read.**
 *   Names are DERIVED from `migratedFrom` in the registry, so the rule maintains itself: declare a
 *   setting's origin and the old read becomes a build failure. Zero occurrences permitted.
 *
 * **Rule B (ratchet) — raw `globalSetting` access outside the settings module.**
 *   There are 25 pre-existing sites in service code. A blanket ban would fail immediately with 25
 *   violations, and a guard that cannot pass gets ignored. So this is a RATCHET, like
 *   `notice-ui-surfaces.json`: the count per file is recorded, may only go DOWN, and
 *   `--update-allowance` records progress.
 *
 * ⚠️ This is deliberately NOT "ban process.env". Most environment variables are not settings
 * (`DATABASE_URL`, `PORT`, credentials), and a broad rule would be allowlisted into uselessness —
 * an allowlisted guard is worse than none. Rule A names specific variables.
 *
 * 🛑 THE HARDEST REQUIREMENT: IT MUST NOT MISS A VIOLATION
 * -------------------------------------------------------
 * A false negative is invisible — it is indistinguishable from a clean result, which is the entire
 * failure mode this repo keeps re-finding ("plausible numbers, no error"). **A false positive is cheap
 * and visible; a false negative is neither.** So this scanner is built to over-report:
 *
 *   - **Line-local, with NO state carried between lines.** An earlier version used a file-wide state
 *     machine to track strings and comments. An apostrophe inside a template literal (`` `don't` ``)
 *     desynced it, and it then blanked the remainder of a file — reporting OK on four genuine
 *     violations in `earnings-import-settings.service.ts`. Line-local state cannot do that.
 *   - **When unsure, it does not blank.** An unterminated quote leaves the rest of the line verbatim,
 *     which can only ever produce extra reports, never hide one.
 *
 * USAGE
 * -----
 *   node nest/scripts/validate-settings-access.cjs                  # gate (runs in prebuild)
 *   node nest/scripts/validate-settings-access.cjs --list           # report every site, change nothing
 *   node nest/scripts/validate-settings-access.cjs --update-allowance
 *   node nest/scripts/validate-settings-access.cjs --self-test
 */

const fs = require('fs');
const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(NEST_ROOT, '..');
const REGISTRY = path.join(NEST_ROOT, 'src', 'common', 'settings', 'settings-registry.ts');
const ALLOWANCE = path.join(__dirname, 'settings-access-allowance.json');

/** The settings module is where direct access is the POINT — it IS the access path. */
const EXEMPT_PREFIXES = [path.join(NEST_ROOT, 'src', 'common', 'settings')];

const SCAN_DIRS = [path.join(NEST_ROOT, 'src'), path.join(NEST_ROOT, 'prisma')];

/** Rule B's pattern: any `<expr>.globalSetting.<method>(`. */
const RULE_B = /\.globalSetting\s*\.\s*\w+\s*\(/g;

/**
 * Produce two renderings of ONE line: comments removed, and string spans either blanked or kept.
 *
 * `blankStrings: true`  → match structure (a mention inside quotes is gone)
 * `blankStrings: false` → recover a name that blanking would remove (the `process.env['NAME']` form)
 *
 * ⚠️ Everything here is decided per line. No state escapes this function, so a misread quote can affect
 * at most the remainder of one line — never a later line, which is how the previous version hid four
 * real violations in an unrelated file.
 */
function renderLine(line, blankStrings) {
  const trimmed = line.trimStart();
  // Whole-line comments: `// ...`, and block-comment continuation lines starting with `*` — the JSDoc
  // that documents a variable is not a read of it, and flagging documentation is how a guard gets
  // allowlisted.
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';

  let out = '';
  let i = 0;
  while (i < line.length) {
    const c = line[i];

    if (c === "'" || c === '"') {
      // Find the closing quote ON THIS LINE.
      let j = i + 1;
      let closed = false;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === c) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) {
        // Unterminated on this line (a template's text, an apostrophe in prose). Keep the rest
        // verbatim: over-reporting is safe, blanking would be able to hide code.
        return out + line.slice(i);
      }
      // Blank only the CONTENTS, keeping both quote delimiters. Two reasons: the length is preserved
      // (so reported columns stay correct), and the delimiters are the STRUCTURE that proves
      // `process.env['NAME']` is a bracket read rather than a quoted mention.
      out += blankStrings ? c + ' '.repeat(j - i - 1) + line[j] : line.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (c === '/' && line[i + 1] === '/') return out; // trailing comment
    if (c === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) return out; // block comment opening, closing on a later line
      i = end + 2;
      continue;
    }

    out += c;
    i += 1;
  }
  return out;
}

/**
 * Read the env variables the registry declares as migrated.
 *
 * Regex-parsed, not imported: the registry is TypeScript and this is plain CJS — the same reason
 * `validate-notices.cjs` parses the backend catalogue rather than importing it. The format is therefore
 * a contract (`migratedFrom: 'NAME',` on ONE line), and the floor check makes a broken parse an ERROR
 * rather than a silent pass. A guard that inspects nothing and reports OK is worse than no guard.
 */
function readMigratedEnvVars(src) {
  const found = [...src.matchAll(/^\s*migratedFrom:\s*'([A-Z0-9_]+)'\s*,/gm)].map((m) => m[1]);
  if (!found.length) {
    throw new Error(
      `could not read any migratedFrom entries from ${path.relative(REPO_ROOT, REGISTRY)}. ` +
        `Expected lines of the form:  migratedFrom: 'MT5_MAX_OPEN_POSITIONS',  — if the format changed, ` +
        `update this parser. Refusing to report OK on a parse that found nothing.`,
    );
  }
  return [...new Set(found)].sort();
}

/**
 * Rule A matching for one line, using both renderings.
 *
 *   process.env.NAME      → a read; no quotes involved, so the blanked line is authoritative
 *   process.env['NAME']   → a read; blanking removes the NAME, so structure comes from the blanked
 *                           line (proving it is code) and the name from the string-preserving one
 *   'process.env.NAME'    → a mention, not a read: blanked, so nothing is found
 */
function ruleAEnvMatches(blankedLine, intactLine, envVars) {
  const found = [];
  for (const name of envVars) {
    if (new RegExp(`process\\.env\\.${name}\\b`).test(blankedLine)) {
      found.push(name);
      continue;
    }
    if (/process\.env\s*\[\s*['"]/.test(blankedLine)) {
      const m = intactLine.match(/process\.env\s*\[\s*['"]([A-Z0-9_]+)['"]/);
      if (m && m[1] === name) found.push(name);
    }
  }
  return found;
}

/** Scan one source string. Pure, so `--self-test` can feed it fixtures. */
function scanSource(src, envVars, relLabel) {
  const ruleA = [];
  const ruleB = new Map();
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const blanked = renderLine(lines[i], true);
    const intact = renderLine(lines[i], false);

    for (const name of ruleAEnvMatches(blanked, intact, envVars)) {
      ruleA.push({ file: relLabel, line: i + 1, text: intact.trim(), name });
    }

    const hits = blanked.match(RULE_B);
    if (hits) ruleB.set(relLabel, (ruleB.get(relLabel) ?? 0) + hits.length);
  }

  return { ruleA, ruleB };
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, acc);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/** Every violation in the repo, with the settings module excluded. */
function findViolations(envVars) {
  const ruleA = [];
  const ruleB = new Map();
  for (const file of SCAN_DIRS.flatMap((d) => walk(d))) {
    if (EXEMPT_PREFIXES.some((p) => file.startsWith(p))) continue;
    const rel = path.relative(NEST_ROOT, file).replace(/\\/g, '/');
    const result = scanSource(fs.readFileSync(file, 'utf8'), envVars, rel);
    ruleA.push(...result.ruleA);
    for (const [f, c] of result.ruleB) ruleB.set(f, (ruleB.get(f) ?? 0) + c);
  }
  return { ruleA, ruleB };
}

function loadAllowance() {
  if (!fs.existsSync(ALLOWANCE)) return { files: {} };
  try {
    return JSON.parse(fs.readFileSync(ALLOWANCE, 'utf8'));
  } catch (e) {
    throw new Error(`allowance file is unreadable (${path.relative(REPO_ROOT, ALLOWANCE)}): ${e.message}`);
  }
}

/** Compare measured counts against the recorded allowance. Returns [] when clean. */
function compareRatchet(ruleB, allowance) {
  const problems = [];
  const allowed = allowance.files || {};

  for (const [file, count] of [...ruleB.entries()].sort()) {
    const was = allowed[file];
    if (was === undefined) {
      problems.push(
        `  ${file} has ${count} raw globalSetting access(es) and is NOT in the allowance — read the ` +
          `value through SettingsResolverService instead. If direct access is genuinely required here, ` +
          `record it deliberately: node nest/scripts/validate-settings-access.cjs --update-allowance`,
      );
    } else if (count > was) {
      problems.push(
        `  ${file} went UP from ${was} to ${count} raw globalSetting access(es). New direct access is the ` +
          `defect this gate exists for — use the resolver.`,
      );
    } else if (count < was) {
      problems.push(
        `  ${file} is DOWN to ${count} from ${was} — record the improvement: ` +
          `node nest/scripts/validate-settings-access.cjs --update-allowance`,
      );
    }
  }

  for (const file of Object.keys(allowed).sort()) {
    if (!ruleB.has(file)) {
      problems.push(
        `  ${file} no longer accesses globalSetting but is still in the allowance — remove its entry: ` +
          `node nest/scripts/validate-settings-access.cjs --update-allowance`,
      );
    }
  }
  return problems;
}

// ── --self-test: prove the checker rejects bad input, on fixtures ──────────────

/**
 * A guard that has never been observed to fail is a decoration. These fixtures assert that each rule
 * FIRES on a real violation, does NOT fire on a comment or a string, and — the one that matters most —
 * that an apostrophe earlier in a file cannot hide a violation later in it.
 */
function selfTest() {
  const ENV = ['MT5_MAX_OPEN_POSITIONS'];
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });
  const A = (code) => scanSource(code, ENV, '<fixture>').ruleA.length;
  const B = (code) => scanSource(code, ENV, '<fixture>').ruleB.size;

  // Rule A fires
  ok('Rule A fires on a dotted read', A('const a = process.env.MT5_MAX_OPEN_POSITIONS;') === 1);
  ok('Rule A fires on the bracket form', A('const a = process.env["MT5_MAX_OPEN_POSITIONS"];') === 1);
  ok('Rule A fires on the single-quoted bracket form', A("const a = process.env['MT5_MAX_OPEN_POSITIONS'];") === 1);
  // Rule A does not fire on non-reads
  ok('Rule A ignores a line comment', A('// was process.env.MT5_MAX_OPEN_POSITIONS') === 0);
  ok('Rule A ignores a JSDoc line', A(' * The cap is MT5_MAX_OPEN_POSITIONS, broker-wide.') === 0);
  ok('Rule A ignores a block comment on one line', A('/* uses process.env.MT5_MAX_OPEN_POSITIONS */') === 0);
  ok('Rule A ignores a trailing comment', A('const a = 1; // see process.env.MT5_MAX_OPEN_POSITIONS') === 0);
  ok('Rule A ignores a different env var', A('const a = process.env.PORT;') === 0);
  ok('Rule A ignores a longer name', A('const a = process.env.MT5_MAX_OPEN_POSITIONS_EXTRA;') === 0);
  ok('Rule A ignores a quoted mention', A("const s = 'process.env.MT5_MAX_OPEN_POSITIONS';") === 0);
  ok('Rule A ignores a quoted bracket mention', A("const s = 'process.env[\"MT5_MAX_OPEN_POSITIONS\"]';") === 0);
  // ⚠️ The regression fixtures — these are the ones that caught the real bugs.
  ok(
    'an apostrophe in a template does NOT hide a later env read',
    A("const m = `don't`;\nconst a = process.env.MT5_MAX_OPEN_POSITIONS;") === 1,
  );
  ok(
    'an apostrophe in a template does NOT hide a later globalSetting call',
    B("const m = `don't`;\nawait this.prisma.globalSetting.upsert({});") === 1,
  );
  ok(
    'an unterminated quote does NOT hide a later globalSetting call',
    B("const broken = 'oops\nawait this.prisma.globalSetting.upsert({});") === 1,
  );
  ok('a real read AFTER an unclosed block comment is still found', A('/* open\n*/\nconst a = process.env.MT5_MAX_OPEN_POSITIONS;') === 1);

  // Rule B
  ok('Rule B fires on prisma.globalSetting.upsert', B('await this.prisma.globalSetting.upsert({});') === 1);
  ok('Rule B fires on the cast form', B('await (this.prisma as any).globalSetting.create({});') === 1);
  ok('Rule B ignores a comment', B('// previously this.prisma.globalSetting.upsert(...)') === 0);
  ok('Rule B ignores a quoted mention', B('const t = "prisma.globalSetting.upsert(";') === 0);
  ok('Rule B counts two calls on one line', scanSource('a.globalSetting.update({}); b.globalSetting.create({});', ENV, '<f>').ruleB.get('<f>') === 2);

  // The parser must refuse to pass on an empty read
  let threw = false;
  try {
    readMigratedEnvVars('no declarations here');
  } catch {
    threw = true;
  }
  ok('a parse finding no migratedFrom entries ERRORS rather than passing', threw);
  ok('readMigratedEnvVars reads the real declarations', readMigratedEnvVars(fs.readFileSync(REGISTRY, 'utf8')).length >= 3);

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`  ${r.pass ? '✅' : '✖ '} ${r.name}`);
  console.log('');
  if (failed.length) {
    console.error(`[settings-access] ✖ self-test FAILED — ${failed.length}/${results.length} check(s) failed\n`);
    return 1;
  }
  console.log(`[settings-access] ✅ self-test passed — ${results.length}/${results.length} checks\n`);
  return 0;
}

// ── Entry point ───────────────────────────────────────────────────────────────

(() => {
  const argv = process.argv.slice(2);

  if (argv.includes('--self-test')) process.exit(selfTest());

  let envVars;
  let violations;
  try {
    envVars = readMigratedEnvVars(fs.readFileSync(REGISTRY, 'utf8'));
    violations = findViolations(envVars);
  } catch (e) {
    console.error(`\n[settings-access] ✖ ${e.message}\n`);
    process.exit(1);
  }

  const { ruleA, ruleB } = violations;
  const totalB = [...ruleB.values()].reduce((a, b) => a + b, 0);

  if (argv.includes('--list')) {
    console.log(`[settings-access] migrated env vars (rule A): ${envVars.join(', ')}`);
    console.log(`[settings-access] rule A violations: ${ruleA.length}`);
    for (const v of ruleA) console.log(`  ${v.file}:${v.line}  ${v.name}  ${v.text}`);
    console.log(
      `\n[settings-access] rule B — raw globalSetting access outside the settings module: ${totalB} in ${ruleB.size} file(s)`,
    );
    for (const [file, count] of [...ruleB.entries()].sort()) console.log(`  ${count}\t${file}`);
    return;
  }

  if (argv.includes('--update-allowance')) {
    // The ratchet is written DOWN only: a file whose count ROSE is a regression and must not be recorded.
    const previous = loadAllowance();
    const regressions = [...ruleB.entries()].filter(
      ([f, c]) => previous.files?.[f] !== undefined && c > previous.files[f],
    );
    if (regressions.length) {
      console.error('\n[settings-access] ✖ refusing to record a regression — fix these first:');
      for (const [f, c] of regressions) console.error(`  ${f} is at ${c}, was ${previous.files[f]}`);
      console.error('');
      process.exit(1);
    }
    fs.writeFileSync(
      ALLOWANCE,
      JSON.stringify(
        {
          _comment:
            'Ratchet for RAW globalSetting access outside nest/src/common/settings. A file may only go DOWN. ' +
            'New direct access is the defect validate-settings-access.cjs exists to catch. These keys must be ' +
            'read through SettingsResolverService so provenance and the declared default are not bypassed. ' +
            'A file may legitimately REMAIN here for a DYNAMIC key that cannot be declared at all — currently ' +
            'automation-loop.service.ts, whose remaining 2 sites are the per-broker ' +
            '`automation.brokerTrading.<brokerId>` read and write (brokers are data, so there is no finite ' +
            'list to declare, and the resolver deliberately refuses undeclared keys). Note the consequence: ' +
            'those two reads do NOT fall back to a declared default, which is unchanged behaviour but is not ' +
            'yet covered by provenance reporting.',
          totals: { files: ruleB.size, hits: totalB },
          files: Object.fromEntries([...ruleB.entries()].sort()),
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    console.log(
      `[settings-access] wrote allowance — ${totalB} raw access(es) across ${ruleB.size} file(s), recorded so they can only decrease`,
    );
    return;
  }

  const problems = [];
  if (ruleA.length) {
    problems.push(
      `  ${ruleA.length} read(s) of a MIGRATED env var. These are settings now — read them through ` +
        `SettingsResolverService (see settings-registry.ts for the key):`,
    );
    for (const v of ruleA) problems.push(`    ${v.file}:${v.line}  ${v.name}`);
  }
  problems.push(...compareRatchet(ruleB, loadAllowance()));

  if (problems.length) {
    console.error(`\n[settings-access] ✖ ${problems.length} settings-access problem(s):`);
    for (const p of problems) console.error(p);
    console.error('');
    process.exit(1);
  }

  console.log(
    `[settings-access] ✅ OK — no migrated env var is read (${envVars.length} checked); ` +
      `${totalB} recorded raw globalSetting access(es) in ${ruleB.size} file(s), none increased`,
  );
})();
