/**
 * logs/r37-erase-deactivated-bars.cjs — the owner authorised this: "If not delete the 89k".
 *
 * WHY IT IS SAFE. The rows belong to symbols that are `active = 0` AND have no bot, no protocol
 * assignment and no route. Nothing reads their bars:
 *   - scoring     resolves from active-strategies
 *   - news        resolves from all-active, and these are now inactive
 *   - bar refresh skips them (verified live: "9 not active and not protected — skipped")
 * And per the owner, bars are recoverable: "I don't care about past data that can be easily
 * recovered." They can be re-fetched from the bridge at any time.
 *
 * ⚠️ WHAT IT DOES NOT TOUCH: the 57 active symbols (39 core + 18 held) and every row of theirs.
 *
 * Usage:  node logs/r37-erase-deactivated-bars.cjs            (report only)
 *         node logs/r37-erase-deactivated-bars.cjs --apply
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

const APPLY = process.argv.includes('--apply');

const TARGET = `
  b.symbolId IN (SELECT id FROM symbol WHERE active = 0)`;

(async () => {
  const c = await connect();

  console.log(`== rows to erase (${APPLY ? 'APPLY' : 'DRY RUN'}) ==`);
  console.log(await query(
    `SELECT COUNT(*) AS rows_to_erase, COUNT(DISTINCT b.symbolId) AS symbols,
            MIN(b.timestamp) AS oldest, MAX(b.timestamp) AS newest
     FROM marketbar b WHERE ${TARGET}`, c));

  console.log('== SAFETY: any of these symbols held or traded? (must be 0) ==');
  console.log(await query(
    `SELECT COUNT(*) AS must_be_zero FROM symbol s
     WHERE s.active = 0
       AND (UPPER(s.ticker) IN (SELECT UPPER(p.symbol) FROM position p)
         OR UPPER(s.ticker) IN (SELECT UPPER(ts.symbol) FROM trading_strategy ts WHERE ts.active = 1))`, c));

  console.log('== what SURVIVES (the active set must be untouched) ==');
  console.log(await query(
    `SELECT COUNT(*) AS rows_kept, COUNT(DISTINCT b.symbolId) AS symbols
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId WHERE s.active = 1`, c));

  if (!APPLY) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --apply.');
    return;
  }

  console.log('== erasing ==');
  console.log(await query(`DELETE b FROM marketbar b WHERE ${TARGET}`, c));

  console.log('== verify ==');
  console.log(await query(
    `SELECT COUNT(*) AS rows_remaining,
            SUM(CASE WHEN s.active = 0 THEN 1 ELSE 0 END) AS left_for_deactivated
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId`, c));

  console.log('== verify: the tradeable set still has its full daily depth ==');
  console.log(await query(
    `SELECT COUNT(*) AS daily_bars_for_XAUUSD FROM marketbar b JOIN symbol s ON s.id = b.symbolId
     WHERE UPPER(s.ticker) = 'XAUUSD' AND b.timeframe = '1d'`, c));
})();
