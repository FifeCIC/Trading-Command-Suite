#!/usr/bin/env node
/**
 * fix-local-time-sources.cjs — replace MySQL `NOW()` and `DEFAULT CURRENT_TIMESTAMP` in SQL.
 *
 * ⚠️ TWO SOURCES OF LOCAL TIME, ONE CAUSE (#844). MySQL evaluates BOTH `NOW()` and
 * `CURRENT_TIMESTAMP` in the SESSION timezone, which is `SYSTEM` = **UTC+1** on this machine, while
 * the application stores UTC (JavaScript `new Date()`).
 *
 *   1. `NOW()` in a query — writes an hour in the future, or measures against the wrong clock.
 *   2. `DEFAULT CURRENT_TIMESTAMP` in DDL — every row that OMITS the column is stamped an hour
 *      ahead. 113 live columns had this, including `position.openedAt`, `trade.openedAt` and
 *      `strategy_signal_queue.createdAt` on the trade execution queue.
 *
 * ⚠️ FIXING ONLY THE LIVE DATABASE IS NOT ENOUGH — hence the DDL pass. Converting columns without
 * converting the DDL that creates them means a reinstall, or any table created by this code,
 * silently reintroduces the defect: the fix would survive only until the next fresh database.
 *
 * ⚠️ SAME FIX FOR WRITES AND COMPARISONS. Both are wrong for the same reason and both are fixed by
 * the same substitution:
 *   • a WRITE should be UTC                              → `VALUES (…, UTC_TIMESTAMP())`
 *   • a COMPARISON against an app-written column (UTC)   → `… WHERE ts > DATE_SUB(UTC_TIMESTAMP(), …)`
 * A comparison against a column that was itself written from a DB default is also correct after
 * this change, because those defaults are converted to UTC by `fix-local-time-defaults.cjs` in the
 * same change. There is no case in this codebase where `NOW()` should stay local.
 *
 * ⚠️ WHY NOT JUST SET THE SERVER TIMEZONE. `SET GLOBAL time_zone='+00:00'` would fix every default
 * and every `NOW()` in one move — and would also silently change the clock for EVERY OTHER project
 * on this shared WAMP/MySQL instance (Intranet, OmniCore, StreamerOps). A cross-project change made
 * to fix one project's bug is exactly the pattern this repo keeps paying for. The fix is contained
 * to `tradingcs` and this codebase instead.
 *
 * Idempotent: a second run finds nothing to change. Reports every site it touched.
 *
 * Usage:  node nest/scripts/fix-local-time-writes.cjs [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const NEST = path.resolve(__dirname, '..');
const REPO = path.resolve(NEST, '..');
const DRY = process.argv.includes('--dry-run');

/** Directories to scan, relative to the repo root. Specs are excluded — they are fixtures. */
const SCOPES = ['nest/src', 'nest/prisma'];

/** `NOW()` as SQL — not `Date.now()`, not a comment. Case-sensitive, and not preceded by `.`/word. */
const SQL_NOW = /(^|[^A-Za-z_.])NOW\(\)/g;

/**
 * DDL defaults: `DEFAULT CURRENT_TIMESTAMP(n)` → `DEFAULT (UTC_TIMESTAMP(n))`.
 *
 * ⚠️ THIS IS A SECOND, INDEPENDENT SOURCE OF LOCAL TIME (#844). Converting the LIVE columns without
 * converting the DDL that creates them means a reinstall, or any table created by this code,
 * silently reintroduces the defect — the fix would survive only until the next fresh database.
 *
 * MySQL evaluates `CURRENT_TIMESTAMP` in the session timezone; `UTC_TIMESTAMP` does not. Both are
 * accepted as an expression default, verified on a scratch table.
 *
 * ⚠️ `ON UPDATE CURRENT_TIMESTAMP` is deliberately NOT rewritten: MySQL cannot express `ON UPDATE`
 * as a function, and rewriting it would be rejected. Those columns are reported by
 * `fix-local-time-defaults.cjs` instead, because their update path needs an application-level fix.
 */
const DDL_LOCAL_DEFAULT = /DEFAULT\s+CURRENT_TIMESTAMP(\((\d+)\))?/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(p, out);
    } else if (/\.(ts|sql|js)$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) {
      // ⚠️ `.js` is in scope because `nest/prisma/` keeps hand-transpiled twins of the
      // `manual-migration-*.ts` files. Fixing only the `.ts` half would leave a runnable copy that
      // reintroduces the defect — the same "two copies, one gets the fix" shape as the retention map.
      out.push(p);
    }
  }
  return out;
}

const touched = [];
let totalReplacements = 0;

for (const scope of SCOPES) {
  const abs = path.join(REPO, scope);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // Skip lines that are pure comments — a comment may legitimately mention NOW().
    const lines = src.split(/\r?\n/);
    let nowChanged = 0;
    let ddlChanged = 0;
    const next = lines.map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return line;
      let out = line.replace(SQL_NOW, (m, lead) => {
        nowChanged++;
        return `${lead}UTC_TIMESTAMP()`;
      });
      out = out.replace(DDL_LOCAL_DEFAULT, (m, _paren, digits) => {
        ddlChanged++;
        return `DEFAULT (UTC_TIMESTAMP${digits ? `(${digits})` : '()'})`;
      });
      return out;
    });
    const changed = nowChanged + ddlChanged;
    if (changed === 0) continue;

    const out = next.join(src.includes('\r\n') ? '\r\n' : '\n');
    if (out === src) continue;

    if (!DRY) fs.writeFileSync(file, out, 'utf8');
    touched.push({ file: path.relative(REPO, file).replace(/\\/g, '/'), count: changed, nowChanged, ddlChanged });
    totalReplacements += changed;
  }
}

console.log(`fix-local-time-sources${DRY ? ' (dry run)' : ''}\n`);
if (touched.length === 0) {
  console.log('  ✅ nothing to do — no SQL NOW() and no CURRENT_TIMESTAMP default remain.');
} else {
  console.log('  now  ddl  file');
  for (const t of touched) {
    console.log(`  ${String(t.nowChanged).padStart(3)}  ${String(t.ddlChanged).padStart(3)}  ${t.file}`);
  }
}
const totalNow = touched.reduce((a, t) => a + t.nowChanged, 0);
const totalDdl = touched.reduce((a, t) => a + t.ddlChanged, 0);
console.log(`\n  ${totalNow} SQL NOW() -> UTC_TIMESTAMP(),  ${totalDdl} DDL DEFAULT CURRENT_TIMESTAMP -> (UTC_TIMESTAMP()),  ${touched.length} file(s).`);
if (!DRY && totalReplacements > 0) {
  console.log('\n  Next: node nest/scripts/fix-local-time-defaults.cjs  (LIVE column defaults)');
}
