#!/usr/bin/env node
/**
 * align-scoring-strategy-thresholds.cjs — bring scoring_strategy.tradeThreshold onto the live scale.
 *
 * ⚠️ WHY THIS IS A ONE-OFF LATERAL MIGRATION, NOT A REUSABLE FIX
 *
 * The 2026-09-15 rescale divided every strength percentage by ~6.3. Target values were fixed in the
 * CODE (`style-thresholds.ts`) and in the SEED (`scoring-strategy-seed.ts`), but **already-persisted
 * rows were not rewritten** — so 25 of 27 rows held 50/55/60, which the live scale (~10-33) can
 * never clear. That is a data/installation mismatch, and the owner has asked for it aligned so the
 * system operates correctly for testing.
 *
 * SAFETY — this touches LIVE TRADING CONFIG, so it is deliberately cautious:
 *
 *   1. **Backup first.** Every row's prior value is written to nest/data-repairs/ before any write.
 *      (Pattern established by the #780/#832 repairs.)
 *   2. **Uses the OWNER FUNCTION, not a copy.** The target comes from the compiled
 *      `style-thresholds.js resolveStyleThreshold()` — the same function the running app uses.
 *      Re-implementing "÷6.3" here would be a second owner, i.e. the very defect being fixed.
 *   3. **Dry run by default.** Pass `--apply` to write.
 *   4. **Verifies after writing** by re-reading, rather than trusting the UPDATE.
 *   5. **Idempotent.** A row already on-scale is left alone, so re-running is safe.
 *
 * ⚠️ This column is NOT gated on any more (verified: nothing compares
 * `scoringStrategy.tradeThreshold` in a gate — the layer was retired from the trading loop
 * 2026-08-27). It is read for display/lineage. So this aligns config with the installation; it does
 * not change which trades fire.
 *
 * USAGE (from nest/):
 *   node scripts/align-scoring-strategy-thresholds.cjs           # dry run
 *   node scripts/align-scoring-strategy-thresholds.cjs --apply
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/** The owner — loaded from the COMPILED output so this uses the same logic the API runs. */
const owner = require('../dist/src/common/utils/style-thresholds.js');

/** Above this, a bar cannot be cleared by any protocol's measured composite. */
const CEILING = 35;

const BACKUP_DIR = path.join(__dirname, '..', 'data-repairs');

(async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name, protocolId, tradeThreshold FROM scoring_strategy ORDER BY protocolId, name`,
  );

  // Protocol styles — the owner function needs them to resolve a bar.
  let styles = new Map();
  try {
    const protos = await prisma.$queryRawUnsafe(
      `SELECT id, slug, tradingStyle FROM protocol`,
    );
    for (const p of protos) {
      if (p.slug) styles.set(p.slug, p.tradingStyle ?? null);
      if (p.id) styles.set(p.id, p.tradingStyle ?? null);
    }
  } catch (e) {
    console.log(`⚠️  could not read protocol.tradingStyle (${String(e.message).slice(0, 70)})`);
  }

  const plan = [];
  for (const r of rows) {
    const current = Number(r.tradeThreshold);
    if (current <= CEILING && current > 0) continue; // already on-scale — leave it
    if (current === 0) continue;                     // 0 is DELIBERATE (dodges the gate) — leave it

    const style = styles.get(r.protocolId) ?? null;
    const resolved = owner.resolveStyleThreshold(style, owner.BOT_BAR_DEFAULT);
    plan.push({
      id: r.id,
      name: r.name,
      protocolId: r.protocolId,
      from: current,
      to: resolved.threshold,
      why: style
        ? `${resolved.label}`
        : `no style on protocol -> BOT_BAR_DEFAULT (${owner.BOT_BAR_DEFAULT})`,
    });
  }

  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — pass --apply to write'}`);
  console.log(`${plan.length} row(s) need rescaling (of ${rows.length})\n`);
  for (const p of plan) {
    console.log(`  ${String(p.from).padStart(3)} -> ${String(p.to).padStart(2)}   ${String(p.protocolId).padEnd(22)} ${String(p.name).slice(0, 30)}`);
    console.log(`            ${p.why}`);
  }

  if (!APPLY) {
    console.log('\nNo changes made.\n');
    await prisma.$disconnect();
    return;
  }

  // 1. BACKUP — before the first write, so an interrupted run is still recoverable.
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(BACKUP_DIR, `${stamp}-scoring-strategy-tradeThreshold.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    takenAt: new Date().toISOString(),
    reason: 'Align scoring_strategy.tradeThreshold with the post-rescale style owner (#839).',
    table: 'scoring_strategy', column: 'tradeThreshold',
    rows: rows.map((r) => ({ id: r.id, name: r.name, protocolId: r.protocolId, tradeThreshold: Number(r.tradeThreshold) })),
  }, null, 2));
  console.log(`\n  ✅ backup written: ${path.relative(process.cwd(), backupPath)}`);

  // 2. WRITE
  let updated = 0;
  for (const p of plan) {
    await prisma.$executeRawUnsafe(
      `UPDATE scoring_strategy SET tradeThreshold = ? WHERE id = ?`, p.to, p.id,
    );
    updated++;
  }
  console.log(`  ${updated} row(s) updated`);

  // 3. VERIFY by re-reading — do not trust the UPDATE's own success.
  const after = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM scoring_strategy WHERE tradeThreshold > ${CEILING}`,
  );
  const remaining = Number(after[0].n);
  console.log(`  verification: ${remaining} row(s) still above ${CEILING}` +
    (remaining === 0 ? '  ✅' : '  ✖ INVESTIGATE'));

  await prisma.$disconnect();
})().catch(async (e) => {
  console.log('ERROR: ' + (e.message || e));
  await prisma.$disconnect();
  process.exit(1);
});
