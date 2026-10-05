/**
 * logs/retention-recheck.cjs — the row count dropped ~3,600 in minutes. Re-measure before trusting
 * the claim I filed in #1070 ("the 60-day marketbar window is NOT applied").
 *
 * If a prune IS running, MIN(timestamp) should sit near 60 days. It measured 295 days earlier,
 * which is the evidence the bound is not enforced. Either that changed, or rows are going somewhere
 * else — and #1070 is wrong if it changed.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== marketbar depth and total, right now ==');
  console.log(await query(
    `SELECT COUNT(*) AS rows_now, MIN(timestamp) AS oldest,
            TIMESTAMPDIFF(DAY, MIN(timestamp), UTC_TIMESTAMP()) AS oldest_age_days,
            MAX(importedAt) AS newest_import
     FROM marketbar`, c));

  console.log('== rows older than 60 days (if the bound were applied this would be 0) ==');
  console.log(await query(
    `SELECT COUNT(*) AS older_than_60d FROM marketbar
     WHERE timestamp < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 DAY)`, c));

  console.log('== is there a retention marker or prune log? ==');
  console.log(await query(
    `SELECT \`key\`, value FROM global_setting
     WHERE \`key\` LIKE '%retention%' OR \`key\` LIKE '%prune%' OR \`key\` LIKE '%DATA_RETENTION%'`, c));

  console.log('== rows per timeframe (a prune usually hits the bulk timeframe first) ==');
  console.log(await query(
    `SELECT timeframe, COUNT(*) AS n, MIN(timestamp) AS oldest
     FROM marketbar GROUP BY timeframe ORDER BY n DESC`, c));
})();
