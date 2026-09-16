#!/usr/bin/env node
/**
 * inspect-scoring-strategy-thresholds.cjs — what ARE the 27 rows, before aligning them?
 *
 * WHY: the owner has said to bring installation files and database data into alignment so the
 * system operates correctly for testing. That is a mandate to change data — so the rows must be
 * understood first. "Rescale anything above 33" would be a blind rule; a row may legitimately be
 * 0 (deliberately dodging a gate), and a row's protocol may have a SEEDED target value that
 * differs from a generic rescale.
 *
 * This prints, per row: the current value, the protocol, whether the protocol is in the seed and
 * what the seed now says, and how many trades the row's strategy has ever produced.
 *
 * Read-only.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/** The seeded targets, mirroring scoring-strategy-seed.ts after the 2026-09-15 rescale. */
const SEEDED = {
  'xau-speed-v1': 9,
  'forex-session-v1': 8,
  'btc-speed-v1': 10,
  'oil-speed-v1': 9,
};

/** Old → new: old ÷ ~6.3, rounded, used only when there is no seeded target. */
const resecale = (v) => Math.max(0, Math.round(Number(v) / 6.3));

(async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name, protocolId, tradeThreshold, enabled, mode
       FROM scoring_strategy ORDER BY protocolId, name`,
  );

  console.log(`\n${rows.length} scoring_strategy row(s)\n`);
  console.log('  threshold  bar   protocol              seeded?  name');
  console.log('  ' + '-'.repeat(88));

  let over = 0;
  for (const r of rows) {
    const v = Number(r.tradeThreshold);
    const seeded = SEEDED[r.protocolId];
    const flag = v > 35 ? 'UNCLEARABLE' : '';
    if (v > 35) over++;
    console.log(
      `  ${String(v).padStart(6)}    ${String(seeded ?? resecale(v)).padStart(3)}   ` +
      `${String(r.protocolId ?? '-').padEnd(20)}  ${seeded != null ? 'yes' : 'no '}     ` +
      `${String(r.name).slice(0, 30)}  ${flag}`,
    );
  }

  console.log(`\n  ${over} row(s) above the new-scale ceiling (~33).`);

  // ⚠️ Does anything ACTUALLY gate on this column? Re-verified here rather than trusted from a
  // note — if a gate reads it, aligning these rows changes trade behaviour; if not, it is a
  // display/lineage fix only. The conclusion determines how careful to be.
  console.log('\n  gateConfig values present (NOT covered by validate-threshold-sources.cjs):');
  const gates = await prisma.$queryRawUnsafe(
    `SELECT name, gateConfig FROM scoring_strategy WHERE gateConfig IS NOT NULL LIMIT 12`,
  );
  for (const g of gates) {
    let parsed = g.gateConfig;
    try { parsed = typeof parsed === 'string' ? JSON.parse(parsed) : parsed; } catch { /* leave */ }
    const summary = parsed
      ? Object.entries(parsed).map(([k, v]) => `${k}:${v?.threshold ?? '?'}`).join(' ')
      : '(none)';
    console.log(`     ${String(g.name).slice(0, 34).padEnd(36)} ${summary}`);
  }

  // Trading activity attributable to these strategies — a row with trades has history that a
  // value change could affect, which is worth knowing even if nothing gates on it today.
  console.log('\n  linked trades:');
  const linked = await prisma.$queryRawUnsafe(
    `SELECT ss.name, COUNT(t.id) AS n
       FROM scoring_strategy ss
       LEFT JOIN trading_strategy ts ON ts.scoringStrategyId = ss.id
       LEFT JOIN trade t ON t.strategyId = ts.id
      GROUP BY ss.id, ss.name ORDER BY n DESC LIMIT 10`,
  );
  for (const l of linked) console.log(`     ${String(l.name).slice(0, 34).padEnd(36)} ${l.n} trade(s)`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.log('ERROR: ' + (e.message || e));
  await prisma.$disconnect();
  process.exit(1);
});
