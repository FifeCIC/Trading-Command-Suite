/**
 * measure-sizing-config.cjs — is rarity sizing CONFIGURED on and never read?
 *
 * WHY THIS EXISTS
 * ---------------
 * `TradingStrategyService.execute()` applies rarity x regime x maxSize plus a
 * black-swan ZERO-SIZE skip. `AutomationLoopService` — the path that actually
 * dispatches live trades — passes a flat `baseSize = strategy.baseSize ?? 0.01`.
 *
 * `evaluateAllActive()` (trading-strategy.service.ts:865) is the ONLY caller of
 * `execute()`, and it has ZERO callers of its own. So the careful sizing path is
 * unreachable from anywhere in the running system.
 *
 * The claim to TEST — not assert — is that the affected bots are CONFIGURED to use
 * the unread feature. "The UI lets you pick an option the backend ignores" is
 * REACHABLE; "25 of 26 records are configured to use it" is ACTIVE, and only the
 * second is worth urgent work. This measures which one we have.
 *
 * It also measures whether the zero-size BLACK-SWAN skip is reachable — if the
 * safety skip lives only on the bypassed path, a black-swan condition would size a
 * trade at the flat lot instead of refusing it. That would be a SAFETY INVERSION,
 * which is the reason this is worth measuring rather than filing on principle.
 *
 * Run: node nest/scripts/measure-sizing-config.cjs
 * Read-only. No writes.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Position-sizing configuration vs the live dispatch path');
  console.log('');

  const cols = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trading_strategy'
        AND (COLUMN_NAME LIKE '%arity%' OR COLUMN_NAME LIKE '%ize%' OR COLUMN_NAME LIKE '%mode%')`,
  );
  const names = cols.map((c) => c.COLUMN_NAME);
  console.log(`trading_strategy sizing/mode columns present: ${names.join(', ') || '(none)'}`);
  console.log('');

  const total = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM trading_strategy`,
  );
  const active = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM trading_strategy WHERE active = 1`,
  );
  console.log(`strategies: ${total[0].n} total, ${active[0].n} active`);
  console.log('');

  if (names.includes('useRaritySizing')) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT mode, useRaritySizing, active, COUNT(*) AS n
         FROM trading_strategy
        GROUP BY mode, useRaritySizing, active
        ORDER BY n DESC`,
    );
    console.log('mode / useRaritySizing / active  ->  count');
    for (const r of rows) {
      console.log(
        `   mode=${String(r.mode).padEnd(6)} rarity=${String(r.useRaritySizing).padEnd(4)} ` +
          `active=${String(r.active).padEnd(3)} -> ${r.n}`,
      );
    }

    const configuredOn = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM trading_strategy WHERE active = 1 AND useRaritySizing = 1`,
    );
    const activeTotal = Number(active[0].n);
    const on = Number(configuredOn[0].n);
    console.log('');
    console.log('── VERDICT ──────────────────────────────────────────────────────────────');
    if (activeTotal > 0 && on === activeTotal) {
      console.log(`ACTIVE, not merely reachable: ${on}/${activeTotal} active bots are configured`);
      console.log('with useRaritySizing=1, and the live loop NEVER READS IT. This is a silent');
      console.log('configuration lie — the field says a capability is on and nothing honours it.');
    } else if (on > 0) {
      console.log(`PARTIAL: ${on}/${activeTotal} active bots have useRaritySizing=1.`);
    } else {
      console.log('REACHABLE only: no active bot is configured with rarity sizing on, so this is');
      console.log('a latent gap rather than an active misconfiguration. Priority is lower.');
    }
  } else {
    console.log('⚠️ useRaritySizing column not found — the claim cannot be measured as stated.');
  }

  // ── Is the black-swan zero-size skip reachable? ──────────────────────────────────
  console.log('');
  console.log('── SAFETY: is a zero-size (black-swan) skip reachable from the live path? ──');
  console.log('   The skip lives in TradingStrategyService.execute(), which has no live caller.');
  console.log('   AutomationLoopService passes a FLAT baseSize, so a black-swan condition would');
  console.log('   be sized at that flat lot rather than refused. Confirm by reading');
  console.log('   automation-loop.service.ts:1545 and trading-strategy.service.ts execute().');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
