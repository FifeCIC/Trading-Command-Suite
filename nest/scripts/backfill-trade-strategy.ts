/**
 * backfill-trade-strategy.ts — one-off repair for #949.
 * =======================================================
 * Why: of 186 closed trades, 184 carry NO `strategy` in the column while the MT5 comment that
 * names it IS persisted on the same rows. The column is what the Strategy Comparison page and the
 * bot rating (#894) group by, so the history was unreadable for reasons of EXTRACTION, not of data.
 *
 * Decision (recorded on #949): yes, reach back — but conservatively:
 *   - only rows with status='closed' and an empty/absent strategy;
 *   - only when the comment yields a NON-EMPTY name through the canonical parser
 *     (`extractStrategyFromComment`) — a row whose comment says nothing useful stays UNTAGGED
 *     rather than acquiring a guess;
 *   - idempotent: re-running changes nothing (the `where` excludes rows already tagged).
 *
 * Not a seeder: trades are runtime data and are not restored by a reinstall. This repairs rows
 * that already exist; new closes are tagged in-line by the four close paths (see
 * `validate-close-attribution.cjs`, which fails the build if a path forgets).
 *
 * Usage (from the repo root):
 *   $env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
 *   npx --prefix nest ts-node nest/scripts/backfill-trade-strategy.ts
 */
import { PrismaClient } from '@prisma/client';
import { extractStrategyFromComment } from '../src/modules/providers/mt5-comment.util';

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) AS closed_total,
            SUM(CASE WHEN strategy IS NOT NULL AND strategy <> '' THEN 1 ELSE 0 END) AS tagged,
            SUM(CASE WHEN exitPrice IS NOT NULL THEN 1 ELSE 0 END) AS priced,
            SUM(CASE WHEN strategy IS NOT NULL AND strategy <> '' AND exitPrice IS NOT NULL THEN 1 ELSE 0 END) AS usable
     FROM trade WHERE status='closed'`,
  );
  console.log('BEFORE:', JSON.stringify(before[0], (k, v) => (typeof v === 'bigint' ? Number(v) : v)));

  const rows = await prisma.trade.findMany({
    where: { status: 'closed', OR: [{ strategy: null }, { strategy: '' }] },
    select: { id: true, symbol: true, brokerComment: true },
  });

  let written = 0;
  const unresolved: string[] = [];
  for (const r of rows) {
    const name = extractStrategyFromComment(r.brokerComment);
    if (!name) {
      unresolved.push(`${r.symbol}`);
      continue;
    }
    await prisma.trade.update({ where: { id: r.id }, data: { strategy: name } });
    written++;
  }

  const after = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) AS closed_total,
            SUM(CASE WHEN strategy IS NOT NULL AND strategy <> '' THEN 1 ELSE 0 END) AS tagged,
            SUM(CASE WHEN strategy IS NOT NULL AND strategy <> '' AND exitPrice IS NOT NULL THEN 1 ELSE 0 END) AS usable
     FROM trade WHERE status='closed'`,
  );
  console.log(
    `WROTE ${written} of ${rows.length} untagged row(s); ${unresolved.length} had no usable name in the comment.`,
  );
  console.log('AFTER: ', JSON.stringify(after[0], (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}

main()
  .catch((err) => {
    console.error('backfill failed:', err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
