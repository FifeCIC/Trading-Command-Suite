/**
 * measure-pepperstone.cjs — evidence for the 2026-10-05 owner question:
 * "Has TCS spammed Pepperstone — order attempts that cannot fill, or rapid SL edits?"
 *
 * READ-ONLY. Prints raw MySQL CLI output; writes nothing.
 * Uses the ONE shared connection layer (scripts/lib/mysql-cli.cjs).
 *
 * Run: node logs/measure-pepperstone.cjs
 */
'use strict';
const path = require('path');
const { connect, query } = require(
  path.resolve(__dirname, '..', 'scripts', 'lib', 'mysql-cli.cjs'),
);

let conn;
try {
  conn = connect();
} catch (e) {
  console.error('CONNECT FAILED: ' + e.message);
  process.exit(1);
}

function run(label, sql) {
  console.log('\n=== ' + label + ' ===');
  try {
    const out = String(query(sql, conn)).replace(/\s+$/, '');
    console.log(out === '' ? '(empty result)' : out);
  } catch (e) {
    console.log('QUERY FAILED: ' + (e && e.message));
  }
}

run('stop_adjustment — total & range', `
  SELECT COUNT(*) AS total, MIN(adjustedAt) AS firstAdj, MAX(adjustedAt) AS lastAdj
  FROM stop_adjustment`);

run('stop_adjustment — per day (last 35 days)', `
  SELECT DATE(adjustedAt) AS day, COUNT(*) AS edits
  FROM stop_adjustment
  WHERE adjustedAt >= DATE_SUB(NOW(), INTERVAL 35 DAY)
  GROUP BY day ORDER BY day DESC`);

run('stop_adjustment — busiest tickets ever', `
  SELECT tradeTicket, symbol, COUNT(*) AS edits, MIN(adjustedAt) AS firstAdj, MAX(adjustedAt) AS lastAdj
  FROM stop_adjustment GROUP BY tradeTicket, symbol ORDER BY edits DESC LIMIT 20`);

run('stop_adjustment — rapidPairs = consecutive edits on one ticket < 120s apart (all time)', `
  SELECT COUNT(*) AS rapidPairs FROM (
    SELECT tradeTicket, LAG(adjustedAt) OVER (PARTITION BY tradeTicket ORDER BY adjustedAt) AS prevAt, adjustedAt
    FROM stop_adjustment
  ) t WHERE prevAt IS NOT NULL AND TIMESTAMPDIFF(SECOND, prevAt, adjustedAt) < 120`);

run('stop_adjustment — rapidPairs per ticket (top 15)', `
  SELECT tradeTicket, COUNT(*) AS rapidPairs FROM (
    SELECT tradeTicket, LAG(adjustedAt) OVER (PARTITION BY tradeTicket ORDER BY adjustedAt) AS prevAt, adjustedAt
    FROM stop_adjustment
  ) t WHERE prevAt IS NOT NULL AND TIMESTAMPDIFF(SECOND, prevAt, adjustedAt) < 120
  GROUP BY tradeTicket ORDER BY rapidPairs DESC LIMIT 15`);

run('stop_adjustment — last 20 rows (which mechanism, which reason)', `
  SELECT adjustedAt, tradeTicket, symbol, oldSl, newSl, LEFT(reason, 80) AS reason
  FROM stop_adjustment ORDER BY adjustedAt DESC LIMIT 20`);

run('trades by provider/accountId (all time)', `
  SELECT provider, accountId, COUNT(*) AS trades, MIN(openedAt) AS firstOpen, MAX(openedAt) AS lastOpen
  FROM trade GROUP BY provider, accountId ORDER BY trades DESC`);

run('trades opened per day per account — mt5, last 14 days', `
  SELECT DATE(openedAt) AS day, accountId, COUNT(*) AS opened
  FROM trade WHERE provider = 'mt5' AND openedAt >= DATE_SUB(NOW(), INTERVAL 14 DAY)
  GROUP BY day, accountId ORDER BY day DESC, accountId`);

run('trades closed per day per account — mt5, last 14 days', `
  SELECT DATE(closedAt) AS day, accountId, COUNT(*) AS closed
  FROM trade WHERE provider = 'mt5' AND closedAt >= DATE_SUB(NOW(), INTERVAL 14 DAY)
  GROUP BY day, accountId ORDER BY day DESC, accountId`);

run('open positions right now by account', `
  SELECT accountId, COUNT(*) AS openPositions FROM trade WHERE status = 'open' GROUP BY accountId`);

run('stop_adjustment joined to trade.accountId (NULL = ticket never traded in DB)', `
  SELECT t.accountId, COUNT(*) AS edits
  FROM stop_adjustment sa
  LEFT JOIN trade t ON t.ticket = sa.tradeTicket
  GROUP BY t.accountId ORDER BY edits DESC`);
