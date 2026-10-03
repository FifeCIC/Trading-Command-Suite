/**
 * canary-boot-970.cjs — plant or remove a mismatched bot so the API's BOOT-TIME coverage check can
 * be observed to fire and to clear.
 *
 * ⚠️ Two lessons from the first canary, both re-applied here:
 *   1. `trading_strategy.id` is `varchar(36)` — a longer literal is TRUNCATED by MySQL, so the row
 *      cannot be found again by the literal that created it. The id below is 33 chars, and every
 *      lookup matches on the `CANARY970%` PREFIX.
 *   2. Prove the edit landed from the DATABASE, never from the command exiting 0.
 *
 * Usage:  node logs/canary-boot-970.cjs --plant | --remove | --status
 */
const path = require('path');
const { query, connect } = require(path.resolve(__dirname, '..', 'scripts', 'lib', 'mysql-cli.cjs'));

const ID = 'CANARY970-BOOT-0000-0000-000000'; // 30 chars, safely under varchar(36)
const WHERE = `id LIKE 'CANARY970%'`;
const conn = connect();

const count = () => {
  const lines = query(`SELECT COUNT(*) FROM trading_strategy WHERE ${WHERE};`, conn)
    .replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
  return Number(lines[lines.length - 1].trim());
};

const mode = process.argv[2];

if (mode === '--plant') {
  if (count() !== 0) {
    console.log('[canary] removing a stale row first');
    query(`DELETE FROM trading_strategy WHERE ${WHERE};`, conn);
    if (count() !== 0) throw new Error('stale row could not be removed');
  }
  query(
    `INSERT INTO trading_strategy
       (id, name, symbol, protocolId, timeframe, minComposite, useRaritySizing, maxPositions,
        cooldownMinutes, mode, active, updatedAt, brokerId, version, maxPyramidTiers,
        hotStockEnabled, simTslEnabled)
     VALUES
       ('${ID}', 'CANARY #970 BOOT (temporary)', 'ZZZCANARY', 'spy-speed-v1', '5m', 10, 0, 1,
        5, 'manual', 1, UTC_TIMESTAMP(3), 'mt5', '1.0.0', 1, 0, 0);`,
    conn,
  );
  const n = count();
  if (n !== 1) throw new Error(`the canary row did not land (count=${n}) — refusing to report`);
  console.log(`[canary] PLANTED — ${n} row matches 'CANARY970%' (verified by COUNT)`);
} else if (mode === '--remove') {
  query(`DELETE FROM trading_strategy WHERE ${WHERE};`, conn);
  const n = count();
  console.log(`[canary] REMOVED — ${n} row(s) left matching 'CANARY970%' (expected 0)`);
  if (n !== 0) process.exit(1);
} else if (mode === '--status') {
  console.log(`[canary] ${count()} row(s) matching 'CANARY970%'`);
} else {
  console.error('usage: --plant | --remove | --status');
  process.exit(2);
}
