const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();
  console.log('== did the P&L fix take? live alert rows ==');
  console.log(await query(`
    SELECT title, repeatCount AS firings, lastSeenAt AS last_seen,
           TIMESTAMPDIFF(MINUTE, lastSeenAt, UTC_TIMESTAMP()) AS mins_ago,
           detail
    FROM alert
    WHERE title IN ('Position P&L Alert') OR title LIKE '%P&L Alert%'
    ORDER BY lastSeenAt DESC LIMIT 6`, c));
})();
