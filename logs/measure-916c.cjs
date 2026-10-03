/**
 * measure-916c.cjs — is the app MOVING stops? `stop_adjustment` is the guardian's record of a
 * stop edit (#1041/#1056). If the winners closed by `broker:terminal` have adjustments, the actor
 * is ours; if the table is empty, the actor is the venue's own trailing stop and no app code wrote it.
 */
const path = require('path');
const { query, connect } = require(path.resolve(__dirname, '..', 'scripts', 'lib', 'mysql-cli.cjs'));
const conn = connect();
const run = (sql) => query(sql, conn).replace(/\r/g, '').trimEnd();

console.log('--- stop_adjustment columns ---');
console.log(run(`SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = 'stop_adjustment' ORDER BY ORDINAL_POSITION;`));

console.log('\n--- total rows ---');
console.log(run(`SELECT COUNT(*) AS rows_total FROM stop_adjustment;`));

console.log('\n--- by direction / reason (top 12) ---');
console.log(run(`SELECT * FROM stop_adjustment ORDER BY 1 DESC LIMIT 3;`));

console.log('\n--- adjustments, grouped by symbol (top 12) ---');
console.log(run(`SELECT symbol, COUNT(*) c, MIN(adjustedAt) first_seen, MAX(adjustedAt) last_seen
                   FROM stop_adjustment GROUP BY symbol ORDER BY c DESC LIMIT 12;`));

console.log('\n--- how many CLOSED trades have ANY stop_adjustment row? ---');
console.log(run(`SELECT COUNT(DISTINCT t.id) AS trades_with_adjustment
                   FROM trade t JOIN stop_adjustment sa ON sa.tradeTicket = t.brokerTicket
                  WHERE t.status = 'closed' AND t.pnlInvalid = 0;`));

console.log('\n--- closed trades WITH an adjustment: outcome by closeReason (DISTINCT trades) ---');
// ⚠️ The join FANS OUT — one trade has many adjustments (1370 rows across 133 trades). Counting
// rows here would overstate by ~10x, so count DISTINCT trades and aggregate in JS.
const linked = query(
  `SELECT DISTINCT t.id, t.closeReason, t.pnl, t.symbol
     FROM trade t JOIN stop_adjustment sa ON sa.tradeTicket = t.brokerTicket
    WHERE t.status = 'closed' AND t.pnlInvalid = 0;`, conn,
).replace(/\r/g, '').trimEnd();
const lines = linked.split('\n').slice(1).map((l) => l.split('\t'));
const agg = new Map();
for (const [, closeReason, pnl] of lines) {
  const k = closeReason || '(NULL)';
  if (!agg.has(k)) agg.set(k, { n: 0, wins: 0, pnlSum: 0 });
  const a = agg.get(k); a.n++; a.pnlSum += Number(pnl); if (Number(pnl) > 0) a.wins++;
}
console.log('reason'.padEnd(22) + 'trades'.padStart(7) + 'wins'.padStart(6) + 'avgPnl'.padStart(9));
for (const [k, a] of [...agg.entries()].sort((x, y) => y[1].n - x[1].n)) {
  console.log(k.padEnd(22) + String(a.n).padStart(7) + String(a.wins).padStart(6) + (a.pnlSum / a.n).toFixed(2).padStart(9));
}
console.log(`  (distinct trades carrying at least one adjustment: ${lines.length})`);
