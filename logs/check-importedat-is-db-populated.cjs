/**
 * logs/check-importedat-is-db-populated.cjs
 *
 * `validate-retention-columns.cjs` permits extending INTRINSIC_COLUMNS "only with a column the
 * database itself populates". `newsarticle.importedAt` needs adding, so this proves the criterion
 * holds for EVERY column with that name — not just the one I want.
 *
 * If any table's `importedAt` is application-set (no DEFAULT_GENERATED), adding it to a global
 * whitelist would let a future retention bound sit on an app-written value, which is the exact
 * defect the guard exists to prevent. Widening a guard is the one thing to be careful about.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== every `importedAt` column in the database, and HOW it is populated ==');
  console.log(await query(
    `SELECT TABLE_NAME AS tbl, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            EXTRA AS extra, COLUMN_DEFAULT AS col_default
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = 'tradingcs' AND COLUMN_NAME = 'importedAt'
     ORDER BY TABLE_NAME`, c));

  console.log('== verdict input: how many are DB-populated (extra carries DEFAULT_GENERATED)? ==');
  console.log(await query(
    `SELECT
       SUM(CASE WHEN EXTRA LIKE '%DEFAULT_GENERATED%' THEN 1 ELSE 0 END) AS db_populated,
       SUM(CASE WHEN EXTRA NOT LIKE '%DEFAULT_GENERATED%' THEN 1 ELSE 0 END) AS app_populated,
       COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = 'tradingcs' AND COLUMN_NAME = 'importedAt'`, c));
})();
