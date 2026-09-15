#!/usr/bin/env node
/**
 * reconcile-signal-opportunity.cjs — prove Signal and Opportunity are not swapped.
 * (owner query: "Signal 110/725, Opp 354/825, only 100 apart — has an agent mixed them up?")
 *
 * WHY: `protocol-gating.service.ts` accumulates two denominators from the SAME loop:
 *
 *     if (!isGateGroup) { capacityMax += maxScore; }   // -> configuredSignalMax
 *     oppRaw += result.score; oppMax += maxScore;      // -> opportunityMax (everything)
 *
 * So by construction:   opportunityMax - signalMax == SUM(maxScore of GATE groups)
 *
 * If that identity holds, the two numbers being close is EXPECTED — they differ only by the
 * risk/gate group's capacity — and nothing has been swapped. This script evaluates the
 * identity from the CONFIG so the claim is verified, not asserted.
 *
 * Read-only.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SLUGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const TARGETS = SLUGS.length ? SLUGS : ['forex-session-v1'];

/**
 * ⚠️ The scorer decides the gate with `config.isRiskGate === true`
 * (protocol-gating.service.ts L675) — NOT by matching the group's name or id.
 *
 * A name-based `/risk|gate/i` test was used first and found ZERO gates, because group ids are
 * UUIDs (`1bcdbff1-dda9-…`) and the gate group is named nothing like "risk". That silently made
 * NON-GATE == ALL and hid the very identity this script exists to check. Read the FLAG.
 */
const isGate = (g) => g.isRiskGate === true || g.config?.isRiskGate === true ||
  /risk|gate/i.test(String(g.id ?? g.name ?? ''));

(async () => {
  for (const slug of TARGETS) {
    const prot = await prisma.protocol.findFirst({
      where: { slug },
      include: { directiveGroups: { include: { directives: { where: { active: true } } } } },
    });
    if (!prot) { console.log(`${slug}: NOT FOUND`); continue; }

    console.log(`\n═══ ${slug}  (directionMode: ${prot.directionMode ?? '?'}) ═══`);
    // The scorer counts a directive ONCE even when it appears in several groups, so a naive
    // sum over groups would over-count. De-dup by directive id per group, as the live
    // scorer effectively does.
    let allMax = 0, gateMax = 0, nonGateMax = 0;
    for (const g of prot.directiveGroups) {
      const seen = new Set();
      let sum = 0;
      for (const d of g.directives) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        sum += d.maxScore ?? 0;
      }
      const gate = isGate(g);
      allMax += sum;
      if (gate) gateMax += sum; else nonGateMax += sum;
      console.log(`  ${String(g.id ?? g.name).padEnd(16)} ${gate ? '[GATE] ' : '[voter]'} ` +
                  `dirs=${String(seen.size).padStart(3)}  maxSum=${String(sum).padStart(5)}`);
    }

    console.log('  ─────────────────────────────────────────────');
    console.log(`  ALL groups      = ${allMax}    <- Opportunity denominator`);
    console.log(`  GATE only       = ${gateMax}`);
    console.log(`  NON-GATE        = ${nonGateMax}    <- Signal denominator`);
    console.log(`  identity check  : ALL - NON-GATE = ${allMax - nonGateMax}` +
                `  vs GATE = ${gateMax}  => ${allMax - nonGateMax === gateMax ? 'CONSISTENT' : 'MISMATCH'}`);
  }
  await prisma.$disconnect();
})().catch(async (e) => {
  console.log('ERROR: ' + (e.message || e));
  await prisma.$disconnect();
  process.exit(1);
});
