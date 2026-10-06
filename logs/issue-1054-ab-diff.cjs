/**
 * Scratch measurement for #1054 — WHAT ACTUALLY DIFFERS between an A/B test's two arms?
 *
 * The issue's remaining question is whether the arms behave identically because of the attribution
 * (a plumbing fault) or because of identical scoring (R18). The answer is decided by the config diff:
 * if the only differing field is one the scorer ignores, the arms cannot differ, whatever the
 * attribution does.
 *
 * ⚠️ Diffs by VALUE, not by a hand-written field list — a field nobody thought to check is exactly
 * the one that matters here.
 *
 * Read-only. logs/ on purpose (a file in scripts/ stales docs/TOOLS-INDEX.md).
 */
// ⚠️ Absolute require — node resolves `@prisma/client` from the SCRIPT's directory, not the cwd.
const { PrismaClient } = require('c:/wamp64/www/trading-command-suite/nest/node_modules/@prisma/client');
const prisma = new PrismaClient();

const flat = (o, prefix = '') => {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) Object.assign(out, flat(v, key));
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : (v instanceof Date ? v.toISOString() : v);
  }
  return out;
};

(async () => {
  const tests = await prisma.abTest.findMany();
  console.log(`ab_test rows: ${tests.length}\n`);

  for (const t of tests) {
    console.log('='.repeat(90));
    console.log(`TEST ${t.id}\n  name=${t.name}\n  status=${t.status}  symbols=${JSON.stringify(t.symbols)}`);
    console.log(`  controlStackId=${t.controlStackId}\n  variantStackId=${t.variantStackId}`);

    const [c, v] = await Promise.all([
      prisma.metaStackSnapshot.findUnique({ where: { id: t.controlStackId } }).catch(() => null),
      prisma.metaStackSnapshot.findUnique({ where: { id: t.variantStackId } }).catch(() => null),
    ]);
    if (!c || !v) { console.log(`  ⚠️ could not load both stacks (control=${!!c} variant=${!!v})`); continue; }

    const fc = flat(c), fv = flat(v);
    const keys = [...new Set([...Object.keys(fc), ...Object.keys(fv)])].sort();
    const diff = keys.filter((k) => fc[k] !== fv[k]);

    console.log(`  control.version=${fc.version ?? '-'}  variant.version=${fv.version ?? '-'}`);
    console.log(`  total comparable fields: ${keys.length}`);
    console.log(`  FIELDS THAT DIFFER: ${diff.length}`);
    for (const k of diff) {
      console.log(`    • ${k}\n        control: ${String(fc[k]).slice(0, 90)}\n        variant: ${String(fv[k]).slice(0, 90)}`);
    }
    if (diff.length === 0) console.log('    (NONE — the two arms are field-for-field identical)');
  }

  await prisma.$disconnect();
})().catch(async (e) => { console.error('FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
