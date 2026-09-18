/**
 * verify-strategy-derivation.ts — Gate 4 (behaviour) for #876.
 *
 * Drives the REAL StrategyDerivationService against the REAL database, rather than replicating its
 * logic. A replication would only prove the SQL was understood; this proves the shipped code works.
 *
 * Run:  npx ts-node scripts/verify-strategy-derivation.ts      (from nest/)
 * Exit: 0 = all assertions hold, 1 = an assertion failed
 *
 * ⚠️ EXPECTED VALUES ARE THE FIXTURE. If they move, that is a finding, not a test to update —
 * the numbers below were measured independently in SQL before this service existed:
 *   26 bots, 25 (protocol,bot) pairs, 15 distinct strategies, FX family = 3.
 */
import { PrismaClient } from '@prisma/client';
import { StrategyDerivationService } from '../src/modules/scoring/strategy-derivation.service';

const prisma = new PrismaClient();
// The service only touches `tradingStrategy`, so a bare PrismaClient satisfies it.
const svc = new StrategyDerivationService(prisma as never);

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${actual}, expected ${expected}`);
}

async function main() {
  const res = await svc.deriveAll();

  console.log('\n=== derived strategies ===');
  console.log(`  strategies:   ${res.totalStrategies}`);
  console.log(`  bots:         ${res.totalBots}`);
  console.log(`  duplicates:   ${res.duplicateGroups}`);
  console.log(`  orphans:      ${res.orphans.length}${res.orphans.length ? ' -> ' + res.orphans.join(', ') : ''}`);

  console.log('\n=== assertions against the measured fixture ===');
  // ⚠️ CORRECTED TWICE, 2026-09-18. Both corrections are recorded because each was a real error:
  //
  //  #1 — the count said 15. The counting query omitted `sessionWindow` even though the query that
  //       produced the raw rows had printed it (`EURGBP ... london`, `AUDUSD ... asian`). A gated
  //       bot and an ungated bot act at different hours, so it IS identity.
  //  #2 — the identity EXCLUDED `symbol`, on the reasoning that "symbols are scope, not identity".
  //       That is backwards. The owner's rule: "Different markets. Is different configuration
  //       therefore the end result is a unique strategy." Six FX bots on six markets are six
  //       strategies, not one.
  //
  // Both shared one shape: treating a field that happened to be UNCHANGED as not part of the
  // identity. The rule now is: every field contributes; any difference is a different strategy.
  check('totalBots', res.totalBots, 26);
  check('totalStrategies (one per bot)', res.totalStrategies, 26);

  // A reachable strategy is one whose bot has a real `strategy_protocol` subscription.
  const reachable = res.strategies.filter((s) => s.unreachableBotNames.length === 0);
  check('reachable strategies (excludes the #874 bot)', reachable.length, 25);

  // The FX family: 14 bots, 14 markets, 14 strategies. It must NOT be 1 (the old blended-rating
  // bug) and must NOT be fewer than the number of markets.
  const fx = res.strategies.filter((s) => s.protocolIds.includes('forex-session-v1'));
  check('forex-session-v1 strategies (= 14 markets)', fx.length, 14);

  // Every strategy is exactly ONE bot on ONE market, unless a duplicate is flagged.
  check('every strategy has exactly one bot', res.strategies.every((s) => s.botCount === 1), true);
  check('every strategy has exactly one market', res.strategies.every((s) => s.symbolCount === 1), true);
  check('no strategy spans multiple markets', res.strategies.every((s) => s.symbols.length === 1), true);

  // ⚠ THE DUPLICATE RULE. Two byte-identical bots are a DEFECT ("should never have bots that do
  // the exact same thing"), NOT a single merged strategy. Measured: none exist today, so this must
  // stay 0. If it becomes non-zero, the failure is REAL and the fix is to remove a bot — do not
  // update this number to make the test pass.
  check('duplicate groups (must be 0; a non-zero value is a real defect)', res.duplicateGroups, 0);
  check('no strategy carries more than one bot name', res.strategies.every((s) => s.botNames.length === 1), true);

  // Each market is distinguishable — the fields that differ between the FX bots.
  check('  USDCAD timeframe', fx.find((s) => s.symbols.includes('USDCAD'))?.treatment.timeframe ?? 'none', '5s');
  check('  NZDJPY baseSize', fx.find((s) => s.symbols.includes('NZDJPY'))?.treatment.baseSize ?? 0, 0.1);
  check('  USDJPY timeframe', fx.find((s) => s.symbols.includes('USDJPY'))?.treatment.timeframe ?? 'none', '1h');
  check('  EURGBP session gate', fx.find((s) => s.symbols.includes('EURGBP'))?.treatment.sessionWindow ?? 'none', 'london');
  check('  AUDUSD session gate', fx.find((s) => s.symbols.includes('AUDUSD'))?.treatment.sessionWindow ?? 'none', 'asian');

  // #874 — the bot with no subscription must be FOUND, not vanish, so the silent-never-trades
  // defect is visible on the strategy surface rather than buried.
  check('unreachable bots found (#874)', res.orphans.length, 0);
  check('legacy-only bots flagged (#874)', res.strategies.flatMap((s) => s.unreachableBotNames).length, 1);

  // Every gold/silver protocol is its own strategy — the owner's "4 protocols for gold" case.
  const gold = res.strategies.filter((s) => s.symbols.includes('XAUUSD') || s.protocolIds.some((p) => p.startsWith('xau-')));
  check('gold/silver strategies', gold.length, 5);

  console.log('\n=== all strategies (one per bot) ===');
  for (const s of res.strategies) {
    const flag = s.unreachableBotNames.length ? '  [NO SUBSCRIPTION]' : '';
    const dup = s.botCount > 1 ? '  [DUPLICATE]' : '';
    const t = s.treatment;
    console.log(
      `  ${s.strategyKey}  ${s.protocolIds.join('+').padEnd(16)} ${String(s.symbols[0] ?? '?').padEnd(7)} ` +
        `role=${s.protocolRoles.join('/').padEnd(6)} tf=${String(t?.timeframe).padEnd(4)} ` +
        `min=${String(t?.minComposite).padEnd(3)} size=${String(t?.baseSize).padEnd(5)} ` +
        `sess=${String(t?.sessionWindow ?? 'ungated').padEnd(8)} ${s.botNames[0]}${flag}${dup}`,
    );
  }

  // ── Why is the FX family 14 and not 1 or 13? ──
  // The old rating machinery treated one `scoring_strategy` row as one MetaStack, so all 13 FX bots
  // sharing `auto-forex-session-v1` produced ONE blended rating. Under the owner's rule each market
  // is its own strategy. This dump shows what actually distinguishes them.
  console.log('\n=== forex-session-v1 detail (all one bot, one market) ===');
  const fxAll = res.strategies.filter((s) => s.protocolIds.includes('forex-session-v1'));
  for (const s of fxAll) {
    console.log(
      `  ${String(s.symbols[0]).padEnd(7)} sess=${String(s.treatment.sessionWindow ?? 'ungated').padEnd(8)} ` +
        `tf=${String(s.treatment.timeframe).padEnd(4)} size=${String(s.treatment.baseSize).padEnd(5)} ` +
        `min=${String(s.treatment.minComposite).padEnd(3)} sl/tp=${s.treatment.slPct}/${s.treatment.tpPct}`,
    );
  }

  console.log('\n=== no-subscription bots (reachable only via legacy link) ===');
  for (const s of res.strategies.filter((x) => x.unreachableBotNames.length)) {
    console.log(`  ${s.strategyKey}  protocols=[${s.protocolIds.join(', ')}]  bots=[${s.unreachableBotNames.join(', ')}]`);
  }

  console.log(`\n${failures === 0 ? '✅ ALL ASSERTIONS PASS' : `🛑 ${failures} ASSERTION(S) FAILED`}\n`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('verification script error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
