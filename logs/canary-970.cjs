/**
 * canary-970.cjs — prove the guard FIRES on real database data, not only on synthetic input.
 *
 * ⚠️ A guard that has never been observed to fail is a decoration. The `--self-test` proves the
 * pure rule; this proves the WIRING — that the live query returns the row, the rule sees it, and
 * the exit code is 1. A one-directional test cannot tell "the guard works" from "the guard never
 * runs".
 *
 * Procedure:
 *   1. INSERT a temporary bot through which `spy-speed-v1` (declares SPY, US500) is asked to trade
 *      `ZZZCANARY` — a symbol the protocol never scores.        → guard must EXIT 1
 *   2. DELETE the row.                                            → guard must EXIT 0
 *   3. Verify the row is gone by counting it.
 *
 * The DELETE is in a `finally`, so a failure between the two runs CANNOT leave the row behind.
 * The row is inert while it exists: it has no `strategy_protocol` subscription, so `syncQueues()`
 * never queues it (#874), and `ZZZCANARY` is scored by nothing.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { query, connect } = require(path.resolve(__dirname, '..', 'scripts', 'lib', 'mysql-cli.cjs'));

// ⚠️ MUST BE ≤ 36 CHARS — `trading_strategy.id` is `varchar(36)`. A longer literal is TRUNCATED by
// MySQL on insert, so a later `WHERE id = '<the long literal>'` matches nothing: the row exists and
// the cleanup cannot see it. (Measured: a 42-char id became
// 'CANARY970-0000-0000-0000-00000000000', and the next run collided with it.)
const ID = 'CANARY970-0000-0000-0000-00000000'; // 33 chars
// Match on a PREFIX as well, so a truncated row from an earlier run is still findable.
const WHERE = `id LIKE 'CANARY970%'`;
const GUARD = path.resolve(__dirname, '..', 'nest', 'scripts', 'validate-protocol-covers-bot-symbol.cjs');
const conn = connect();

const count = () => {
  // ⚠️ `mysql --batch` output ENDS WITH A TRAILING NEWLINE, so `.pop()` returns '' and the count
  // reads as NaN. Filter empties before taking the last line. (This bug made the first run report
  // "the row did not land" when it had — the assertion lied, not the insert.)
  const lines = query(`SELECT COUNT(*) FROM trading_strategy WHERE ${WHERE};`, conn)
    .replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
  return Number(lines[lines.length - 1].trim());
};

const runGuard = () => {
  const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

let ok = true;
/** Delete the canary row and return how many remain. Every exit path goes through this. */
function remove() {
  query(`DELETE FROM trading_strategy WHERE ${WHERE};`, conn);
  return count();
}

let before = { code: null, out: '' };
let after = { code: null, out: '' };
let left = null;

try {
  // A row left by an interrupted earlier run would make the "did it land?" assertion vacuous,
  // so clear it — and SAY SO rather than silently absorbing it.
  if (count() !== 0) {
    console.warn(`[canary] clearing a stale canary row from an earlier run (${count()} found)`);
    if (remove() !== 0) throw new Error('a stale canary row could not be removed — refusing to run');
  }

  console.log('[canary] inserting a bot whose protocol never declares its symbol …');
  query(
    `INSERT INTO trading_strategy
       (id, name, symbol, protocolId, timeframe, minComposite, useRaritySizing, maxPositions,
        cooldownMinutes, mode, active, updatedAt, brokerId, version, maxPyramidTiers,
        hotStockEnabled, simTslEnabled)
     VALUES
       ('${ID}', 'CANARY #970 (temporary)', 'ZZZCANARY', 'spy-speed-v1', '5m', 10, 0, 1,
        5, 'manual', 1, UTC_TIMESTAMP(3), 'mt5', '1.0.0', 1, 0, 0);`,
    conn,
  );

  // ⚠️ Prove the EDIT landed, from the database — never from the INSERT command exiting 0.
  if (count() !== 1) throw new Error('the canary row did not land — refusing to report a result');
  console.log('[canary] row landed (verified by COUNT, not by the command exiting 0)');

  before = runGuard();
} finally {
  // ⚠️ Removal lives in an OUTER `finally` so NO exit path can leave the row behind.
  try {
    left = remove();
    after = runGuard();
  } catch (e) {
    console.error(`❌ CANARY INVALID: cleanup failed — ${e.message}`);
    ok = false;
  }
}

console.log(`\n[canary] guard WITH the planted orphan → exit ${before.code} (expected 1)`);
console.log(before.out.split('\n').filter((l) => l.includes('ZZZCANARY') || l.includes('❌')).slice(0, 4).join('\n'));
if (before.code !== 1) { console.error('❌ CANARY FAILED: the guard did not fire on a real orphan'); ok = false; }

console.log(`\n[canary] rows left behind: ${left} (expected 0)`);
if (left !== 0) { console.error('❌ CANARY INVALID: the row could not be removed — restore by hand'); ok = false; }

console.log(`[canary] guard WITHOUT the orphan → exit ${after.code} (expected 0)`);
if (after.code !== 0) { console.error('❌ CANARY FAILED: the guard did not clear after restore'); ok = false; }

console.log(ok ? '\n✅ CANARY PASSED — the guard fired on a planted orphan and cleared on restore.' : '\n❌ CANARY FAILED');
process.exit(ok ? 0 : 1);
