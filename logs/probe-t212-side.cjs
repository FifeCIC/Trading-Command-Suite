// SCRATCH — what do the Trading 212 position rows actually hold? (#1069 option C)
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

const conn = connect();
const sql = `
  SELECT provider,
         IFNULL(side, '(null)') AS side,
         COUNT(*) AS rows_,
         MIN(quantity) AS min_qty,
         MAX(quantity) AS max_qty,
         SUM(quantity < 0) AS negative_qty,
         SUM(quantity = 0) AS zero_qty,
         SUM(avgPrice IS NULL OR avgPrice = 0) AS no_avg_price
  FROM position
  GROUP BY provider, IFNULL(side, '(null)')
  ORDER BY provider, side`;

console.log('--- position by provider/side ---');
console.log(query(sql, conn));

console.log('--- every trading212 row ---');
console.log(query(`
  SELECT id, symbol, side, quantity, avgPrice, currentPrice
  FROM position WHERE provider = 'trading212' ORDER BY symbol`, conn));
