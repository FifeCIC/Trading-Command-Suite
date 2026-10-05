/**
 * logs/side-distribution.cjs — the exact `position.side` distribution.
 *
 * #1069 was filed saying the sign divergence was "REACHABLE, not ACTIVE — 0 of 7 positions carry
 * an unrecognised side". A Trading 212 sync has since populated the table. This measures the truth,
 * because a wrong reachability claim changes the priority someone acts on.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== position count and side, by provider ==');
  console.log(await query(
    `SELECT provider,
            CASE WHEN side IS NULL THEN 'NULL' ELSE side END AS side_bucket,
            COUNT(*) AS n
     FROM position GROUP BY provider, side_bucket ORDER BY n DESC`, c));

  console.log('== the number that decides #1069: rows profitPctFor() would sign ONE way and its 3 copies the OPPOSITE way ==');
  console.log(await query(
    `SELECT COUNT(*) AS unrecognised_side_rows,
            SUM(CASE WHEN provider = 'trading212' THEN 1 ELSE 0 END) AS from_trading212
     FROM position
     WHERE side IS NULL OR LOWER(side) NOT IN ('buy','sell','long','short')`, c));

  console.log('== do those rows carry the prices the profit-% path needs? ==');
  console.log(await query(
    `SELECT COUNT(*) AS computable,
            SUM(CASE WHEN avgPrice IS NULL OR avgPrice = 0 THEN 1 ELSE 0 END) AS no_entry,
            SUM(CASE WHEN currentPrice IS NULL THEN 1 ELSE 0 END) AS no_current
     FROM position
     WHERE side IS NULL OR LOWER(side) NOT IN ('buy','sell','long','short')`, c));
})();
