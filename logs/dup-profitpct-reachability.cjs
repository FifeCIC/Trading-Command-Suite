/**
 * logs/dup-profitpct-reachability.cjs — is the sign divergence between the four profit% copies
 * REACHABLE in live data, or only theoretical?
 *
 * The four implementations:
 *   peak.ts:82          isShort = (s==='sell'||s==='short')      -> null when uncomputable
 *   exit-consensus:373  side === 'buy' ? long : short            -> 0 when uncomputable
 *   stop-guardian:1541  isBuy  = (pos.type === 'buy')            -> no guard
 *   stop-guardian:1659  isBuy  = (pos.type === 'buy')            -> no guard
 *
 * For side='buy'/'sell' all four agree. For an UNRECOGNISED side the canonical is LONG-signed and
 * the other three are SHORT-signed — opposite. That is only a defect if such a row can exist.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== position.side: every distinct value, with a count ==');
  console.log(await query(
    `SELECT side, COUNT(*) AS n FROM position GROUP BY side ORDER BY n DESC`, c));

  console.log('== position: rows whose side is NOT a recognised long/short token ==');
  console.log(await query(
    `SELECT COUNT(*) AS unrecognised,
            SUM(CASE WHEN side IS NULL THEN 1 ELSE 0 END) AS side_is_null,
            SUM(CASE WHEN priceOpen IS NULL OR priceOpen = 0 THEN 1 ELSE 0 END) AS open_missing_or_zero
     FROM position
     WHERE side IS NULL OR LOWER(side) NOT IN ('buy','sell','long','short')`, c));

  console.log('== trade.side (the closed record) ==');
  console.log(await query(
    `SELECT side, COUNT(*) AS n FROM trade GROUP BY side ORDER BY n DESC`, c));

  console.log('== what the SIGN divergence would do, on any affected row ==');
  console.log(await query(
    `SELECT COUNT(*) AS affected_rows
     FROM position
     WHERE side IS NULL OR LOWER(side) NOT IN ('buy','sell','long','short')`, c));
})();
