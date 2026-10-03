/**
 * logs/retention-check.cjs — R38: does the declared retention window actually get applied?
 *
 * `retention.config.ts` declares directiveoutcome at 3 days. The review queue says the table is
 * 4 days old. If both are true, the PRUNE IS NOT RUNNING — which is a defect, not a policy choice,
 * and it changes what R38 is asking.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== tables with NO declared retention window, by size ==');
  console.log(await query(
    `SELECT TABLE_NAME AS tbl, TABLE_ROWS AS est_rows,
            ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576) AS mb
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = 'tradingcs'
       AND TABLE_NAME NOT IN ('directiveoutcome','score','score_snapshot','marketbar',
                              'strategy_evaluation','decision_log','automation_event',
                              'portfolio_snapshot','order','bridge_event')
     ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC LIMIT 10`, c));

  console.log('== directiveoutcome: declared window is 3 DAYS. How old is the data really? ==');
  console.log(await query(
    `SELECT COUNT(*) AS rows_now, MIN(createdAt) AS oldest,
            TIMESTAMPDIFF(DAY, MIN(createdAt), UTC_TIMESTAMP()) AS age_days,
            TIMESTAMPDIFF(HOUR, MIN(createdAt), UTC_TIMESTAMP()) AS age_hours
     FROM directiveoutcome`, c));

  console.log('== how many rows are PAST the 3-day window (should be 0 if the prune runs) ==');
  console.log(await query(
    `SELECT COUNT(*) AS should_have_been_pruned
     FROM directiveoutcome
     WHERE createdAt < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 DAY)`, c));

  console.log('== is the prune switched on? ==');
  console.log(await query(
    `SELECT \`key\`, value FROM global_setting
     WHERE \`key\` LIKE '%retention%' OR \`key\` LIKE '%prune%'`, c));
})();
