/**
 * validate-archive-default-column.cjs — the archive endpoint's DEFAULT prune column
 * must come from the single owner (`retention.config.ts`).
 *
 * THE BUG THIS GUARDS AGAINST
 * ---------------------------
 * `BacktestArchiveController.exportTable()` used to declare:
 *
 *     @Query('dateCol') dateCol: string = 'predictedAt'
 *
 * For `directiveoutcome`, `predictedAt` is a DERIVED value — written from the
 * evaluated bar's OPEN time (`#827`) — whereas the retention config prunes on
 * `createdAt`, an intrinsic write-time column. So an API call that omitted
 * `dateCol` — the easiest call to make, and the one a script is most likely to
 * make — pruned by the derived column and silently destroyed evidence the config
 * was written to protect.
 *
 * That is exactly the failure `retention.config.ts` exists to prevent, so a second
 * hardcoded owner of the column in a controller's decorator defeated the point of it.
 *
 * ⚠️ WHY THIS READS SOURCE AND DOES NOT `require('dist')`
 * -----------------------------------------------------
 * This runs in the `prebuild` chain, which begins with `npx rimraf dist` and is
 * followed by `tsc` — so at the moment this executes, `dist/` is deliberately EMPTY.
 * The first version of this file required the built config and therefore always failed
 * with "cannot load the built retention config", which would have been read as a broken
 * REPO rather than a broken CHECK. Reading the source removes the ordering constraint
 * entirely, so this runs before the build, after the build, or standalone.
 *
 * The trade-off: this parses TypeScript with regexes. That is acceptable ONLY because
 * `retention.config.ts` is a flat declarative table of literals with no computation.
 * It is NOT a general-purpose TS parser. If the config ever becomes computed, move this
 * check to a compiled-context run instead of growing cleverer regexes.
 *
 * ⚠️ `predictedAt` REMAINS VALID as an EXPLICIT `dateCol`. Reads are not writes, and
 * slicing archived data by prediction date is meaningful (see the header of
 * retention.config.ts). Only the DEFAULT must never be the derived column, so this
 * check tests the resolved default, not the whitelist.
 *
 * Run: node nest/scripts/validate-archive-default-column.cjs
 * Exit 1 on violation — safe for prebuild.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const CONFIG = path.join(REPO, 'nest', 'src', 'modules', 'system', 'retention.config.ts');
const CONTROLLER = path.join(REPO, 'nest', 'src', 'modules', 'system', 'backtest-archive.controller.ts');

function fail(msg) {
  console.error(`[validate-archive-default-column] FAIL - ${msg}`);
  process.exit(1);
}

function read(file, label) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(`cannot read the ${label} source (${e.message}).\n      Looked at: ${file}`);
  }
}

const configSrc = read(CONFIG, 'retention config');
const controllerSrc = read(CONTROLLER, 'backtest-archive controller');

// -- 1. Locate the RETENTION_TABLES block ---------------------------------------------
// Guarantees we read the table, not a comment quoting the old shape.
const tablesStart = configSrc.indexOf('export const RETENTION_TABLES');
if (tablesStart === -1) {
  fail(
    'RETENTION_TABLES is not declared in retention.config.ts - the single owner is gone.\n' +
      '      This is the file that makes the prune column consistent; if it has been renamed\n' +
      '      or moved, update this check rather than deleting it.',
  );
}

const afterTables = configSrc.slice(tablesStart);
const nextExport = afterTables.slice(1).search(/\nexport (const|function|interface|type)\b/);
const tablesBlock = nextExport === -1 ? afterTables : afterTables.slice(0, nextExport + 1);

// -- 2. Extract every `<table>: { ... }` entry and its dateCol -------------------------
// Anchored on the two-space-indented key so one table's config cannot bleed into the next.
const starts = [];
const entryRe = /^\s{2}(\w+)\s*:\s*\{/gm;
let m;
while ((m = entryRe.exec(tablesBlock)) !== null) {
  starts.push({ table: m[1], index: m.index });
}

const entries = [];
for (let i = 0; i < starts.length; i++) {
  const end = i + 1 < starts.length ? starts[i + 1].index : tablesBlock.length;
  const body = tablesBlock.slice(starts[i].index, end);
  const colMatch = body.match(/dateCol\s*:\s*'([^']+)'/);
  const daysMatch = body.match(/defaultDays\s*:\s*(\d+)/);
  const envMatch = body.match(/envKey\s*:\s*'([^']+)'/);
  entries.push({
    table: starts[i].table,
    dateCol: colMatch ? colMatch[1] : null,
    defaultDays: daysMatch ? Number(daysMatch[1]) : null,
    envKey: envMatch ? envMatch[1] : null,
  });
}

if (entries.length === 0) {
  fail(
    'parsed ZERO retention tables out of RETENTION_TABLES.\n' +
      '      A check that inspects nothing and reports OK is worse than no check, so this\n' +
      '      refuses to pass. Either the config shape changed (update this parser) or the\n' +
      '      regex stopped matching - which is itself the failure this guard exists to notice.',
  );
}

// -- 3. RETENTION_DAYS must stay DERIVED from RETENTION_TABLES -------------------------
//
// ⚠️ An earlier version of this check asserted that every table had a matching key in
// RETENTION_DAYS. That check COULD NEVER FAIL, because the map is built with
// `Object.fromEntries(Object.entries(RETENTION_TABLES).map(([t, c]) => [t, c.defaultDays]))`
// — it is derived from the same table by construction, so the two cannot drift. Testing it
// was a DECORATION: it inspected nothing and reported OK.
//
// The assertion that CAN fail is the one below — that it remains derived. If someone
// replaces it with a hand-written literal map, a table added to RETENTION_TABLES would
// silently have no day count (or, if looked up by envKey, silently fall back to a default),
// and nothing else in the build would notice.
//
// Verified in the built config: keys are directiveoutcome, score, score_snapshot, marketbar,
// strategy_evaluation, decision_log, automation_event, portfolio_snapshot, order, bridge_event.
const daysStart = configSrc.indexOf('export const RETENTION_DAYS');
if (daysStart === -1) {
  fail('RETENTION_DAYS is not declared - the single owner is gone');
}
const daysDecl = (() => {
  // ⚠️ NARROW THE WINDOW TO THE DECLARATION ITSELF.
  //
  // The first version of this check sliced 400 characters from `daysStart`. That is
  // BROADER than the declaration: `RETENTION_DAYS` is ~100 chars, so the window ran on
  // into `TABLE_DATE_COLUMN`, which is ALSO built with `Object.fromEntries(
  // Object.entries(RETENTION_TABLES)...)`. Replacing `RETENTION_DAYS` with a hand-written
  // literal therefore still matched — the canary reported PASS on a deliberately broken
  // config. A canary that cannot fail is not evidence.
  //
  // The window now ends at the statement terminator (or 200 chars, whichever is sooner).
  const semi = configSrc.indexOf(';', daysStart);
  const end = semi === -1 ? daysStart + 200 : Math.min(semi + 1, daysStart + 200);
  return configSrc.slice(daysStart, end);
})();
const isDerived =
  daysDecl.includes('Object.fromEntries') && daysDecl.includes('Object.entries(RETENTION_TABLES)');
if (!isDerived) {
  fail(
    'RETENTION_DAYS is no longer derived from RETENTION_TABLES with Object.fromEntries.\n' +
      '      A hand-written parallel map CAN drift from RETENTION_TABLES, and a table missing\n' +
      '      from it would resolve to a fallback day count with no error. If the derivation was\n' +
      '      removed deliberately, update this check to compare the two lists explicitly rather\n' +
      '      than removing it - the drift it would allow is silent.\n' +
      `      Declared as: ${daysDecl.replace(/\s+/g, ' ').slice(0, 120)}`,
  );
}
const daysKeys = entries.map((e) => e.table);

// -- 4. The controller must NOT re-declare a literal default for dateCol ---------------
//
// The assertion that would have caught the original bug. A hardcoded string default in
// the decorator is a second owner of a value the config already owns, and the two can
// disagree silently - which is exactly what happened.
if (/@Query\(\s*'dateCol'\s*\)\s*\w+\s*:\s*string\s*=\s*'/.test(controllerSrc)) {
  fail(
    "BacktestArchiveController re-declares a literal default for 'dateCol'.\n" +
      '      The default prune column MUST come from retention.config.ts - that file is the\n' +
      '      single owner. A literal here is a second owner that can silently disagree with it,\n' +
      "      which is how `predictedAt` (a DERIVED column) ended up as the prune key.",
  );
}

if (!/from\s+'\.\/retention\.config'/.test(controllerSrc)) {
  fail(
    'BacktestArchiveController does not import from ./retention.config - it cannot be\n' +
      '      using the single owner, and is resolving the prune column some other way.',
  );
}

// -- 5. Every table must declare an intrinsic column, with a resolvable day count ------
// Columns that must never be the DEFAULT: derived values the application computes and
// can therefore get wrong. `predictedAt` is written from the evaluated bar's open time
// (#827). It stays valid as an EXPLICIT archive slice.
const NEVER_A_DEFAULT = { directiveoutcome: 'predictedAt' };

const problems = [];
for (const e of entries) {
  if (!e.dateCol) {
    problems.push(`${e.table}: dateCol is not declared`);
    continue;
  }
  if (NEVER_A_DEFAULT[e.table] === e.dateCol) {
    problems.push(
      `${e.table}: dateCol is the DERIVED column '${e.dateCol}' - it can be stamped ` +
        `wrongly and then delete evidence`,
    );
    continue;
  }
  if (!daysKeys.includes(e.table)) {
    problems.push(`${e.table}: missing from RETENTION_TABLES (cannot derive a day count)`);
    continue;
  }
  if (e.defaultDays === null) {
    problems.push(`${e.table}: defaultDays is not declared`);
  }
}

if (problems.length) {
  fail(`retention config problems:\n      - ${problems.join('\n      - ')}`);
}

// -- 6. The specific resolution the controller performs -------------------------------
const doc = entries.find((e) => e.table === 'directiveoutcome');
if (!doc) {
  fail("'directiveoutcome' is no longer in RETENTION_TABLES - the controller defaults to it");
}
if (doc.dateCol !== 'createdAt') {
  fail(
    `directiveoutcome's prune column is '${doc.dateCol}', expected 'createdAt'.\n` +
      "      A request omitting dateCol would prune the wrong column. 'createdAt' is the\n" +
      "      intrinsic write-time column; 'predictedAt' is derived from the evaluated bar.",
  );
}

console.log('[validate-archive-default-column] OK - the archive endpoint has ONE owner of the');
console.log('   prune column: retention.config.ts. A request omitting dateCol resolves to');
console.log(`   directiveoutcome.${doc.dateCol}, NOT the derived 'predictedAt'.`);
console.log(`   tables checked: ${entries.length}; day counts derived for all of them`);
