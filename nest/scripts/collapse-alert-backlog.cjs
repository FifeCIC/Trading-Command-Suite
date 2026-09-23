#!/usr/bin/env node
/**
 * collapse-alert-backlog.cjs — one-off reconciliation of historic alert spam (2026-09-23).
 * ===========================================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * `AlertsService.addAlert()` used to INSERT unconditionally, so every poll window in which a
 * condition was true wrote another row. Measured 2026-09-23, before this ran:
 *
 *     alert table: 13,120 rows — 12,865 undismissed covering 1,121 distinct conditions
 *     "1 MT5 Bridge(s) Down"                × 2,210
 *     "Provider FAILED: finnhub"            ×   434
 *     `R3NK loss: …` (argument-shift era)   × ~5,000
 *
 * The notification bell counted those rows (via a consecutive-dedupe hack) and showed **9,818**,
 * while its own popup — which never read the table — said "All clear". Neither number was wrong
 * about the rows; both were wrong about what the user needed to see.
 *
 * The runtime fix is in `addAlert()` (a recurrence now COLLAPSES into the existing undismissed
 * row: `lastSeenAt` moves, `repeatCount` increments) and in `autoDismissStale()` (the declared
 * `autoDismissDays` is now enforced). This script reconciles the rows that were written BEFORE
 * those changes: for each distinct condition it keeps the NEWEST row, stamps it with the last
 * observation time and the number of occurrences, and DISMISSES the older copies.
 *
 * ⚠️ NOTHING IS DELETED. Dismissed rows remain retrievable through `getHistory()`, which is what
 * the dismiss flag has always meant. Age-based dismissal is left to the RUNTIME owner
 * (`AlertsService.autoDismissStale()`, run hourly) — this script does not duplicate that rule.
 *
 * USAGE
 * -----
 *   $env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
 *   node nest/scripts/collapse-alert-backlog.cjs --dry-run    # report only
 *   node nest/scripts/collapse-alert-backlog.cjs              # apply
 *
 * Idempotent: a second run finds no group with > 1 undismissed row and reports 0.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CHUNK = 500;
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const rows = await prisma.alert.findMany({
    where: { dismissed: false },
    select: { id: true, type: true, title: true, detail: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`[collapse-alerts] undismissed rows read: ${rows.length}`);
  if (rows.length === 0) {
    console.log('[collapse-alerts] nothing to do.');
    return;
  }

  // Group by (type, title) — the key addAlert() collapses on. ⚠️ NOT detail: condition messages
  // embed changing numbers ("612,223 bars" → "612,224"), so a detail-keyed collapse treats every
  // observation as a new condition (measured: 514 "active" rows after the first attempt, ~150 of
  // them `Market Data Stale` with a different bar count each).
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.type}\u0000${r.title}`;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(r);
  }

  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  const dupRows = dupGroups.reduce((n, g) => n + g.length, 0);
  console.log(
    `[collapse-alerts] distinct conditions: ${groups.size}; ` +
    `conditions with copies: ${dupGroups.length} holding ${dupRows} row(s)`,
  );
  if (dupGroups.length > 0) {
    const worst = [...dupGroups].sort((a, b) => b.length - a.length).slice(0, 5);
    for (const g of worst) {
      console.log(`  ×${String(g.length).padStart(5)}  ${g[0].title} — ${String(g[0].detail ?? '').slice(0, 80)}`);
    }
  }

  let dismissed = 0;
  let stamped = 0;
  for (const g of dupGroups) {
    // Newest row describes the condition's current state — it is the keeper.
    const keeper = g[g.length - 1];
    const losers = g.slice(0, -1).map((r) => r.id);

    if (!DRY_RUN) {
      await prisma.alert.update({
        where: { id: keeper.id },
        data: { lastSeenAt: keeper.createdAt, repeatCount: g.length },
      });
      for (let i = 0; i < losers.length; i += CHUNK) {
        await prisma.alert.updateMany({
          where: { id: { in: losers.slice(i, i + CHUNK) } },
          data: { dismissed: true },
        });
      }
    }
    stamped += 1;
    dismissed += losers.length;
  }

  console.log(
    `[collapse-alerts] ${DRY_RUN ? 'WOULD stamp' : 'stamped'} ${stamped} condition(s); ` +
    `${DRY_RUN ? 'WOULD dismiss' : 'dismissed'} ${dismissed} duplicate row(s)`,
  );

  if (!DRY_RUN) {
    const remaining = await prisma.alert.count({ where: { dismissed: false } });
    console.log(`[collapse-alerts] undismissed rows now: ${remaining}`);
    console.log(
      '[collapse-alerts] NOTE: rows not observed within autoDismissDays are dismissed by ' +
      'AlertsService.autoDismissStale() (hourly, in the running API) — not by this script.',
    );
  }
}

main()
  .catch((err) => { console.error(`[collapse-alerts] FAILED: ${err.message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
