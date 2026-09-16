/**
 * verify-t212-holdings.cjs — are the 21 non-MT5 position rows really portfolio HOLDS?
 *
 * WHY THIS CHECK EXISTS
 * ---------------------
 * `classify-open-positions.cjs` found 21 rows with provider 'trading212', no brokerTicket,
 * no side and fractional quantities — and I want to call them "imported holdings, not
 * trades". That is a CLAIM, and this session has produced five wrong causal claims by
 * asserting instead of measuring. So it gets tested against three independent signals:
 *
 *   1. Does the trading212 IMPORT path write to `position`? (the code, not a guess)
 *   2. Do the rows look like holdings — fractional quantities on instruments that only
 *      trade in whole shares, no side, no ticket?
 *   3. Are they STALE? A holding should refresh on each import. If `updatedAt` is days old
 *      while MT5 positions are minutes old, these are frozen imports rather than live state —
 *      which matters, because a frozen row is still being counted as an open position.
 *
 * ⚠️ What each answer would mean:
 *   - all three hold   -> they are holdings; the real finding is that they are counted as
 *                         "positions" alongside real trades
 *   - (1) fails        -> something ELSE writes them and my explanation is wrong
 *   - (3) shows stale  -> a separate defect worth its own issue
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Verifying the 21 non-MT5 position rows');
  console.log('');

  // ── 2. Shape of the rows ────────────────────────────────────────────────────────
  const shape = await prisma.$queryRawUnsafe(
    `SELECT provider,
            COUNT(*) AS n,
            SUM(CASE WHEN brokerTicket IS NULL THEN 1 ELSE 0 END) AS no_ticket,
            SUM(CASE WHEN side IS NULL THEN 1 ELSE 0 END) AS no_side,
            SUM(CASE WHEN quantity <> FLOOR(quantity) THEN 1 ELSE 0 END) AS fractional,
            MIN(openedAt) AS oldest_opened,
            MAX(openedAt) AS newest_opened,
            MIN(updatedAt) AS oldest_updated,
            MAX(updatedAt) AS newest_updated,
            SUM(CASE WHEN currentPrice IS NULL THEN 1 ELSE 0 END) AS no_price
       FROM position
      GROUP BY provider`,
  );
  console.log('  shape by provider:');
  for (const r of shape) {
    console.log(`    provider=${r.provider}`);
    console.log(`       rows=${r.n} noTicket=${r.no_ticket} noSide=${r.no_side} fractionalQty=${r.fractional} noPrice=${r.no_price}`);
    console.log(`       opened : ${new Date(r.oldest_opened).toISOString()} .. ${new Date(r.newest_opened).toISOString()}`);
    console.log(`       updated: ${new Date(r.oldest_updated).toISOString()} .. ${new Date(r.newest_updated).toISOString()}`);
  }
  console.log('');

  // ── 3. Staleness — how long since each group last refreshed? ────────────────────
  const staleness = await prisma.$queryRawUnsafe(
    `SELECT provider,
            ROUND(AVG(TIMESTAMPDIFF(MINUTE, updatedAt, UTC_TIMESTAMP()))) AS avg_min_stale,
            ROUND(MAX(TIMESTAMPDIFF(MINUTE, updatedAt, UTC_TIMESTAMP()))) AS max_min_stale
       FROM position
      GROUP BY provider`,
  );
  console.log('  staleness (minutes since updatedAt):');
  for (const r of staleness) {
    console.log(`    provider=${String(r.provider).padEnd(12)} avg=${String(r.avg_min_stale).padStart(9)} max=${String(r.max_min_stale).padStart(9)}`);
  }
  console.log('');

  // ── 1. Do any t212 rows have a matching trade row? ──────────────────────────────
  const t212WithTrade = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n
       FROM position p
       JOIN trade t ON t.symbol = p.symbol AND t.status = 'open'
      WHERE p.provider = 'trading212'`,
  );
  console.log(`  t212 positions that DO match an open trade by symbol: ${t212WithTrade[0].n}`);
  console.log('     (0 => they are not TCS trades at all; >0 => they are, and my reading is wrong)');
  console.log('');

  // ── 4. Is there a paper_trade / import record corroborating an import? ──────────
  const imports = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n, MIN(createdAt) AS first_seen, MAX(createdAt) AS last_seen
       FROM import_job`,
  ).catch(() => null);
  if (imports) {
    console.log(`  import_job rows: ${imports[0].n}`);
    if (imports[0].n > 0) {
      console.log(`     first=${new Date(imports[0].first_seen).toISOString()} last=${new Date(imports[0].last_seen).toISOString()}`);
    }
  } else {
    console.log('  (no import_job table or query failed — not evidence either way)');
  }
  console.log('');

  console.log('── READ THIS CAREFULLY ─────────────────────────────────────────────────');
  console.log('  Fractional quantity on AMZN/SPCE/OMC is decisive: those trade in whole shares');
  console.log('  on MT5. Combined with no brokerTicket and no side, these rows cannot be MT5');
  console.log('  orders. If `updatedAt` is much older than the MT5 rows, they are also FROZEN —');
  console.log('  and a frozen row still counted as an open position is its own problem.');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
