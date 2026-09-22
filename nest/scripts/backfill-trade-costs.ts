/**
 * backfill-trade-costs.ts — one-off capture of broker-itemised costs for rows closed before the
 * writer existed (#777 criterion 2).
 * =================================================================================================
 * `position-sync.finalizeClosedPosition()` now persists commission/swap/fee from the CLOSING DEALS.
 * Rows closed before 2026-09-22 carry NULL. The deal history the bridge exposes covers a rolling
 * window (30 days), so this script reaches exactly as far back as the broker still reports — and
 * nothing further, because a cost that is not in the deal history cannot be invented.
 *
 * ⚠️ A written 0 means "the broker itemised nothing" (commission 0 / swap 0 / fee 0 is a real
 * reading on this account). A NULL means "not captured". Those are different claims and this
 * script only ever writes the first when the deals actually say so.
 *
 * ⚠️ SPREAD IS NOT IN THIS DATA. Commission/swap/fee are deal FIELDS; spread is embedded in the
 * fill prices themselves and cannot be recovered from a deal list. So `grossPnl` = net + itemised
 * costs — it is NOT a spread-free figure, and the endpoint says so.
 *
 * Usage (repo root):
 *   $env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
 *   npx --prefix nest ts-node nest/scripts/backfill-trade-costs.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BRIDGES = ['http://localhost:5000', 'http://localhost:5001'];

interface DealRow {
  positionId?: string | number | null;
  profit?: number; commission?: number; swap?: number; fee?: number;
}

async function fetchDeals(base: string): Promise<DealRow[]> {
  try {
    const res = await fetch(`${base}/history/deals?days=30`);
    if (!res.ok) {
      console.log(`  ${base}: HTTP ${res.status} — skipped`);
      return [];
    }
    const json: any = await res.json();
    return Array.isArray(json?.deals) ? json.deals : [];
  } catch (err) {
    console.log(`  ${base}: unreachable (${(err as Error).message}) — skipped`);
    return [];
  }
}

async function main() {
  const byPosition = new Map<string, { commission: number; swap: number; fee: number }>();
  for (const base of BRIDGES) {
    const deals = await fetchDeals(base);
    console.log(`${base}: ${deals.length} deal(s) in the 30-day window`);
    for (const d of deals) {
      if (d.positionId == null) continue;
      const key = String(d.positionId);
      const acc = byPosition.get(key) || { commission: 0, swap: 0, fee: 0 };
      acc.commission += Number(d.commission || 0);
      acc.swap += Number(d.swap || 0);
      acc.fee += Number(d.fee || 0);
      byPosition.set(key, acc);
    }
  }
  console.log(`distinct positions with deal history: ${byPosition.size}`);

  const rows = await prisma.trade.findMany({
    where: { status: 'closed', brokerTicket: { not: null }, commission: null },
    select: { id: true, symbol: true, brokerTicket: true },
  });
  console.log(`closed rows missing costs: ${rows.length}`);

  let written = 0;
  let notInWindow = 0;
  for (const r of rows) {
    const costs = byPosition.get(String(r.brokerTicket));
    if (!costs) {
      notInWindow++;
      continue;
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    await prisma.trade.update({
      where: { id: r.id },
      data: { commission: r2(costs.commission), swap: r2(costs.swap), fee: r2(costs.fee) },
    });
    written++;
  }

  const after = await prisma.$queryRawUnsafe<any[]>(
    `SELECT SUM(commission IS NULL) AS still_null, SUM(commission IS NOT NULL) AS captured
     FROM trade WHERE status='closed' AND brokerTicket IS NOT NULL`,
  );
  console.log(`WROTE ${written} row(s); ${notInWindow} outside the deal window (stay NULL — not captured is not zero).`);
  console.log('COVERAGE:', JSON.stringify(after[0], (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}

main()
  .catch((err) => {
    console.error('cost backfill failed:', err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
