const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();
  console.log('== the positions the alert named, with the numbers behind the percentage ==');
  console.log(await query(`
    SELECT symbol, side, quantity, avgPrice, currentPrice, pnl,
           ROUND(avgPrice * quantity, 6)                       AS notional_as_computed,
           ROUND(ABS(pnl / (avgPrice * quantity)) * 100, 1)    AS pct_as_computed,
           ROUND((currentPrice - avgPrice) / avgPrice * 100, 2) AS price_move_pct
    FROM position
    WHERE symbol IN ('USDCHF','XAUUSD','PTGEF','XIACY','8XP','MSTR')
    ORDER BY symbol`, c));
})();
