/**
 * validate-collation-consistency.cjs — #842. Stop the collation split coming back.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * The split was FIXED in the live database (124 tables, one collation), but that alone
 * is not durable. Four `raw-managed/*.sql` files still declared
 * `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`, and those files are what
 * RECREATE their tables on a reinstall. So the split would have returned silently, on
 * the four tables that include `strategy_signal_queue` — the trade execution queue.
 *
 * That is the same shape as the seed-discipline rule: **a fix applied only to the live
 * database is a fix to one machine.** The repo is the durable artefact.
 *
 * WHAT THIS CHECKS
 * ----------------
 *   1. No DDL in the repo declares a collation other than the majority one.
 *   2. Every `CREATE TABLE ... ENGINE=InnoDB` carries an EXPLICIT collation, so a future
 *      table cannot inherit whatever the server default happens to be. MySQL 8's server
 *      default is `utf8mb4_0900_ai_ci`, which is exactly how the split began — a bare
 *      CREATE TABLE on a MySQL-8 server silently differs from the rest of the schema.
 *
 * ⚠️ THE SECOND CHECK IS THE ONE THAT PREVENTS RECURRENCE. The first only catches a
 * repeat of the known mistake; the second catches the CAUSE, which is relying on a
 * server default that differs between MySQL 5.x and 8.x.
 *
 * Deliberately ALLOWED, and not flagged:
 *   - `COLLATE utf8mb4_unicode_ci` pins in hand-written JOINs. These coerce both sides to
 *     a common collation. Now that the schema is uniform they are redundant, but they are
 *     harmless and they were load-bearing when written. Removing them changes query
 *     semantics, so that is a separate decision, not something a guard should force.
 *   - A pin to `utf8mb4_0900_ai_ci` is ALSO still allowed to exist for the same reason
 *     (MySQL coerces), but it is now stale — it names a collation the schema no longer
 *     uses. Reported as a WARNING so it is visible without failing the build.
 *
 * Run: node nest/scripts/validate-collation-consistency.cjs
 * Exit 1 on violation — safe for prebuild.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const MAJORITY = 'utf8mb4_unicode_ci';

const SCAN_ROOTS = [
  path.join(REPO, 'nest', 'prisma'),
  path.join(REPO, 'nest', 'src'),
  path.join(REPO, 'nest', 'scripts'),
];

const EXTS = new Set(['.sql', '.ts', '.js', '.cjs', '.mjs']);

const SELF = path.basename(__filename);

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__pycache__') continue;
      walk(full, out);
    } else if (EXTS.has(path.extname(e.name))) {
      // ⚠️ Exclude THIS file. Its own docstring explains the rule with example DDL, and a
      // bare scan matched those quoted statements as violations — the guard failing on
      // its own documentation. Stripping comments below is the general fix; excluding
      // self is belt-and-braces, because a match here is never a real finding.
      if (e.name === SELF) continue;
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments so a CREATE TABLE QUOTED IN A COMMENT is not treated as real DDL.
 *
 * ⚠️ Learned the hard way: without this the guard reported two violations in its own
 * source, because its docstring contains example DDL. A validator that cannot tell a
 * documented example from an enforced declaration will produce false positives until
 * someone allow-lists it — and an allow-listed guard is worse than none.
 *
 * SQL `--` and `#` line comments, and JS/TS `//` line and block comments, are removed.
 * String literals are NOT protected, which is acceptable here: a collation name inside a
 * string literal has no effect on DDL, but flagging one is a false positive a human can
 * see immediately, whereas missing real DDL is the failure that matters.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/^[ \t]*(?:--|#)[^\n]*$/gm, '') // SQL line comments
    .replace(/^[ \t]*\/\/[^\n]*$/gm, ''); // JS line comments
}

const files = SCAN_ROOTS.flatMap((r) => walk(r));

if (files.length === 0) {
  // ⚠️ A check that inspects nothing and reports OK is worse than no check.
  console.error(
    '[validate-collation-consistency] FAIL - scanned ZERO files.\n' +
      '      The scan roots are wrong or the extensions filter excludes everything.\n' +
      '      Refusing to report success from a check that established nothing.',
  );
  process.exit(1);
}

const violations = [];
const stalePins = [];
let explicitCollations = 0;
let createStatements = 0;
let innodbStatements = 0;

/**
 * Extract each `CREATE TABLE` statement WITHOUT depending on a terminator.
 *
 * ⚠️ WHY NOT A REGEX WITH A REQUIRED `;`
 * -------------------------------------
 * The first version used:
 *
 *     /CREATE\s+TABLE[^;]*?ENGINE\s*=\s*InnoDB[^;]*?(?:;|`)/gis
 *
 * That matched **nothing** in the real DDL, because these `raw-managed/*.sql` files end
 * their final statement WITHOUT a trailing semicolon. So the guard silently scanned zero
 * statements and reported OK — and BOTH canaries failed to fire, which is how it was
 * caught. A guard whose zero-match case looks identical to a pass is worse than no guard.
 *
 * The repair is NOT a cleverer pattern. It is to stop requiring a terminator: find each
 * `CREATE TABLE`, then take the text up to the next one (or EOF). That cannot silently
 * match nothing, because a file containing `CREATE TABLE` always yields a slice.
 */
function extractCreateStatements(code) {
  const out = [];
  const re = /CREATE\s+TABLE/gi;
  const starts = [];
  let m;
  while ((m = re.exec(code)) !== null) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : code.length;
    out.push(code.slice(starts[i], end));
  }
  return out;
}

const COLLATION_DECL = /COLLATE\s*=\s*(utf8mb4_\w+)/i;
const ANY_COLLATE = /COLLATE\s+(?:=\s*)?(utf8mb4_\w+)/gi;

for (const file of files) {
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const rel = path.relative(REPO, file).replace(/\\/g, '/');

  // Scan CODE, not prose. See stripComments() — a documented example is not a violation.
  const code = stripComments(src);

  // ── 1. Any CREATE TABLE that declares a non-majority collation is a violation ─────
  const creates = extractCreateStatements(code);
  createStatements += creates.length;
  for (const stmt of creates) {
    // Only statements that are actually InnoDB tables carry a collation to check.
    if (!/ENGINE\s*=\s*InnoDB/i.test(stmt)) continue;
    innodbStatements += 1;
    const m = stmt.match(COLLATION_DECL);
    if (!m) {
      // ── 2. No explicit collation at all → inherits the SERVER default ─────────────
      violations.push({
        rel,
        why:
          'CREATE TABLE ... ENGINE=InnoDB with NO explicit COLLATE — it inherits the server ' +
          `default. MySQL 8's default is utf8mb4_0900_ai_ci, which is how this split began. ` +
          `Add:  COLLATE=${MAJORITY}`,
      });
      continue;
    }
    explicitCollations += 1;
    if (m[1] !== MAJORITY) {
      violations.push({
        rel,
        why: `CREATE TABLE declares COLLATE=${m[1]} — the majority is ${MAJORITY}. A reinstall would recreate this table on the divergent collation and cross-set joins would throw 1267 again.`,
      });
    }
  }

  // ── 3. Stale COLLATE pins (warn only — see the header) ───────────────────────────
  let pm;
  ANY_COLLATE.lastIndex = 0;
  while ((pm = ANY_COLLATE.exec(code)) !== null) {
    if (pm[1] !== MAJORITY) {
      const line = code.slice(0, pm.index).split('\n').length;
      stalePins.push(`${rel}:~${line} pins ${pm[1]}`);
    }
  }
}

console.log(
  `[validate-collation-consistency] scanned ${files.length} file(s), ` +
    `${createStatements} CREATE TABLE statement(s), ${innodbStatements} InnoDB, ` +
    `${explicitCollations} explicit COLLATE declaration(s)`,
);
console.log(`   majority collation: ${MAJORITY}`);

// ⚠️ SELF-CHECK — refuse to pass on an empty scan.
//
// This is the check whose ABSENCE let the first version report OK while matching ZERO
// statements: its regex required a trailing semicolon that these DDL files do not have,
// so it inspected nothing and both canaries passed silently. An inspection count of zero
// must be an ERROR, never a pass — the same rule as a canary that cannot make its edit.
if (innodbStatements === 0) {
  console.error('');
  console.error('[validate-collation-consistency] FAIL - found 0 InnoDB CREATE TABLE statements.');
  console.error('   A check that inspects nothing and reports OK is worse than no check. Either');
  console.error('   the DDL moved, or the extraction has stopped matching — fix the extraction,');
  console.error('   do not accept this as success.');
  process.exit(1);
}

if (stalePins.length) {
  console.log('');
  console.log(`   ⚠️ ${stalePins.length} stale COLLATE pin(s) to a non-majority collation.`);
  console.log('      These still WORK (MySQL coerces) but they now name a collation the schema');
  console.log('      no longer uses, so the comment beside them is probably out of date too.');
  for (const s of stalePins.slice(0, 8)) console.log(`        ${s}`);
  if (stalePins.length > 8) console.log(`        … +${stalePins.length - 8} more`);
  console.log('      NOT a failure — removing a pin changes query semantics and is a decision.');
}

if (violations.length) {
  console.error('');
  console.error(`[validate-collation-consistency] FAIL - ${violations.length} violation(s):`);
  for (const v of violations) {
    console.error(`   ${v.rel}`);
    console.error(`      ${v.why}`);
  }
  console.error('');
  console.error('   Fix: every CREATE TABLE in the repo must declare');
  console.error(`        ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${MAJORITY}`);
  process.exit(1);
}

console.log('');
console.log('✅ OK — no DDL declares a divergent collation, and every CREATE TABLE is explicit');
console.log('   about its collation rather than inheriting a server default that varies by');
console.log('   MySQL major version. The split cannot return through a reinstall.');
