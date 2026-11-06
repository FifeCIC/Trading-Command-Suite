#!/usr/bin/env node
/**
 * audit-protocol-copies.cjs — "which comparison does this copy serve?"
 *
 * ── WHY THIS EXISTS (#1201, 2026-11-06) ──────────────────────────────────────────────────────
 * The maths-change rule (`maths-change-requires-ab.instructions.md`) prescribes a COPIED
 * configuration instead of an in-place edit. The copy is the mechanism — and it is created by
 * `protocol-db.service.duplicate()`, which sets `derivedFrom` to the source slug and then forgets
 * about it. Measured the day this was written:
 *
 *     copy protocols alive            8   (derivedFrom set)
 *     of those, true maths copies     1   (xau-speed-v1-copy-long)
 *     referenced by any ab_test       0
 *     …and trading                    YES (gold-speed-copy-bot, active = 1)
 *
 * A copy could be created, run live signals, and be deleted with nothing recording which comparison
 * it served or whether that comparison ever reported.
 *
 * ── THE RULE, AND WHY IT IS NARROW ──────────────────────────────────────────────────────────
 * ⚠️ **Seven of the eight are NOT maths copies.** `dax-speed-v1-long`, `cac-speed-v1-long`,
 * `xau-speed-{m5,m15,1h,4h}-long` and `vix-spike-v1-short` are MARKET/ROLE variants derived from a
 * template — a legitimate family, each differing in the instrument or side it trades. Requiring an
 * A/B test for those would fail the build on working configuration, and a guard that over-fires gets
 * allowlisted — which is worse than none.
 *
 * So the scope is the repo's own naming convention: a slug containing **`-copy`** is a maths-change
 * copy. Every such slug must be declared in `scripts/protocol-copies.json`, saying which A/B test it
 * serves (or, when the test is over, why it is still here). An ACTIVE `-copy` that is undeclared is
 * a finding.
 *
 * ⚠️ NOT IN `prebuild`, stated rather than implied. This reads the DATABASE, and a gate that fails
 * the build whenever the database is down would be allowlisted within a week. It is on demand
 * (`npm run db:protocol-copies`), the same treatment as `db:check` and `db:schema-drift`.
 *
 * Usage:
 *   node scripts/audit-protocol-copies.cjs                # report, exit 1 on a finding
 *   node scripts/audit-protocol-copies.cjs --json
 *   node scripts/audit-protocol-copies.cjs --self-test    # canary every rule, no DB needed
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST = path.join(__dirname, 'protocol-copies.json');

const isCopySlug = (slug) => /-copy(-|$)/i.test(String(slug || ''));
const has = (n) => process.argv.includes(`--${n}`);

/**
 * assess() — the whole judgement, PURE. Input is the DB rows and the manifest; nothing else.
 *
 * Split out so `--self-test` can prove every rule can fail without a database, which is the only
 * way a guard is ever actually tested.
 */
function assess(protocols, manifest, orphans = []) {
  const findings = [];
  const declared = manifest && typeof manifest === 'object' ? manifest : {};
  const copies = protocols.filter((p) => isCopySlug(p.slug));

  const slugsInDb = new Set(protocols.map((p) => String(p.slug)));
  const abTestIds = new Set((manifest && manifest.__abTestIds) || []);

  for (const c of copies) {
    const entry = declared[c.slug];
    if (!entry) {
      findings.push({
        rule: 'UNDECLARED-COPY',
        slug: c.slug,
        message: `'${c.slug}' is a -copy protocol and is not declared in scripts/protocol-copies.json — nothing records which comparison it serves or whether that comparison ever reported.`,
      });
      continue;
    }
    if (entry.serves !== null && entry.serves !== undefined) {
      if (!abTestIds.has(entry.serves)) {
        findings.push({
          rule: 'DANGLING-TEST',
          slug: c.slug,
          message: `'${c.slug}' claims to serve A/B test '${entry.serves}', which does not exist. An allowance that points at nothing is a permission nobody can review.`,
        });
      }
    } else if (!entry.reason || String(entry.reason).trim().length < 20) {
      findings.push({
        rule: 'NO-REASON',
        slug: c.slug,
        message: `'${c.slug}' serves no test and gives no reason (needs ≥20 characters saying why it is still here).`,
      });
    }
    if (Number(c.active) === 1 && entry.active !== true) {
      findings.push({
        rule: 'ACTIVE-UNDECLARED',
        slug: c.slug,
        message: `'${c.slug}' is ACTIVE but the manifest says it should not be — it is trading for a comparison that is not running.`,
      });
    }
    if (Number(c.active) === 0 && entry.active === true) {
      findings.push({
        rule: 'INACTIVE-DECLARED',
        slug: c.slug,
        message: `'${c.slug}' is INACTIVE but the manifest says active — the declaration has drifted from reality.`,
      });
    }
  }

  // An allowance that no longer matches anything rots into a permission nobody remembers granting.
  for (const slug of Object.keys(declared)) {
    if (slug.startsWith('__')) continue; // `__comment`, `__abTestIds` — documentation and injected data
    if (!slugsInDb.has(slug)) {
      findings.push({
        rule: 'STALE-DECLARATION',
        slug,
        message: `scripts/protocol-copies.json declares '${slug}', which is not a protocol in the database.`,
      });
    }
  }

  // ── ORPHANED SCORE HISTORY — the same class, one step later ──────────────────────────────
  // A deleted protocol leaves its `score_snapshot` rows behind, because `protocolId` there is a SLUG
  // with no foreign key. MEASURED 2026-11-06: four deleted `xau-speed-*-copy` slugs hold **10,887**
  // rows between them — the only surviving record of a comparison that never reported.
  //
  // DECISION: KEEP and track, do not delete. They are evidence. They are declared below with their
  // counts; a NEW undeclared orphan slug with more than `tolerance` rows is a finding, because that
  // means another protocol was deleted without anyone recording what it was for.
  const declaredOrphans = declared.__orphanScoreHistory || {};
  const tolerance = 100;
  for (const o of orphans || []) {
    const key = String(o.protocolId);
    if (Object.prototype.hasOwnProperty.call(declaredOrphans, key)) continue;
    if (Number(o.n) <= tolerance) continue;
    findings.push({
      rule: 'NEW-ORPHAN-HISTORY',
      slug: key,
      message: `'${key}' holds ${o.n} score_snapshot rows but no protocol — a protocol was deleted and nothing records what it was for. Declare it in __orphanScoreHistory with the reason.`,
    });
  }
  for (const key of Object.keys(declaredOrphans)) {
    if (key.startsWith('__')) continue; // `__why` — the decision text, not a slug
    const actual = (orphans || []).find((o) => String(o.protocolId) === key);
    if (!actual) {
      findings.push({
        rule: 'ORPHAN-HISTORY-GONE',
        slug: key,
        message: `__orphanScoreHistory declares '${key}', which no longer holds orphaned rows — the declaration has been overtaken by events.`,
      });
    }
  }

  return {
    copies: copies.map((c) => ({ slug: c.slug, active: Number(c.active), derivedFrom: c.derivedFrom ?? null })),
    orphanHistory: (orphans || []).map((o) => ({ slug: String(o.protocolId), rows: Number(o.n) })),
    findings,
  };
}

function selfTest() {
  let pass = 0; let fail = 0;
  const t = (n, c) => { if (c) pass++; else { fail++; console.log(`  ✖ ${n}`); } };
  const abs = ['t1'];

  const db = [
    { slug: 'xau-speed-v1-copy-long', active: 1, derivedFrom: 'xau-speed-v1' },
    { slug: 'dax-speed-v1-long', active: 1, derivedFrom: 'ftse-speed-v1' },   // market variant, OUT of scope
  ];

  // 1. UNDECLARED-COPY
  let r = assess(db, { __abTestIds: abs });
  t('an undeclared -copy is a finding', r.findings.some((f) => f.rule === 'UNDECLARED-COPY'));
  t('a market/role variant is NOT in scope', !r.findings.some((f) => f.slug === 'dax-speed-v1-long'));

  // 2. declared + serves a real test + matches active → clean
  r = assess(db, { __abTestIds: abs, 'xau-speed-v1-copy-long': { serves: 't1', active: true, reason: '' } });
  t('a declared copy serving a live test is clean', r.findings.length === 0);

  // 3. DANGLING-TEST
  r = assess(db, { __abTestIds: abs, 'xau-speed-v1-copy-long': { serves: 'gone', active: true } });
  t('a copy pointing at a test that does not exist fails', r.findings.some((f) => f.rule === 'DANGLING-TEST'));

  // 4. NO-REASON
  r = assess(db, { __abTestIds: abs, 'xau-speed-v1-copy-long': { serves: null, active: true, reason: 'done' } });
  t('serving no test needs a real reason', r.findings.some((f) => f.rule === 'NO-REASON'));

  // 5. ACTIVE-UNDECLARED — the 2026-11-06 state
  r = assess(db, { __abTestIds: abs, 'xau-speed-v1-copy-long': { serves: null, active: false, reason: 'retained as evidence for a cancelled run' } });
  t('an ACTIVE copy declared inactive fails', r.findings.some((f) => f.rule === 'ACTIVE-UNDECLARED'));

  // 6. STALE-DECLARATION
  r = assess([{ slug: 'x', active: 0, derivedFrom: null }], { __abTestIds: abs, 'gone-copy': { serves: null, active: false, reason: 'x'.repeat(30) } });
  t('a declaration for a protocol that no longer exists fails', r.findings.some((f) => f.rule === 'STALE-DECLARATION'));

  // 7. The manifest's own documentation must not be read as a declaration — this fired on the first
  //    live run ("declares '__comment', which is not a protocol"), which is a false positive that
  //    would have taught the next reader to ignore the guard.
  r = assess(db, { __abTestIds: abs, __comment: ['documentation'], 'xau-speed-v1-copy-long': { serves: 't1', active: true } });
  t('a __comment key is ignored, not treated as a protocol', r.findings.length === 0);

  // 8. ORPHAN HISTORY — a deleted protocol leaves its score rows behind (no FK on the slug).
  //    Declared ones are tracked; a NEW one above the tolerance is the finding.
  r = assess([{ slug: 'x', active: 0, derivedFrom: null }], { __abTestIds: abs, __orphanScoreHistory: { 'gone-copy': 3315 } }, [{ protocolId: 'gone-copy', n: 3315 }]);
  t('a declared orphan history is not a finding', r.findings.length === 0);
  r = assess([{ slug: 'x', active: 0, derivedFrom: null }], { __abTestIds: abs, __orphanScoreHistory: {} }, [{ protocolId: 'new-copy', n: 500 }]);
  t('a NEW orphan slug above tolerance fails', r.findings.some((f) => f.rule === 'NEW-ORPHAN-HISTORY'));
  r = assess([{ slug: 'x', active: 0, derivedFrom: null }], { __abTestIds: abs, __orphanScoreHistory: {} }, [{ protocolId: 'tiny-copy', n: 3 }]);
  t('a handful of stray rows is below the tolerance, not a finding', r.findings.length === 0);
  r = assess([{ slug: 'x', active: 0, derivedFrom: null }], { __abTestIds: abs, __orphanScoreHistory: { 'gone-copy': 1 } }, []);
  t('a declaration whose rows have gone fails', r.findings.some((f) => f.rule === 'ORPHAN-HISTORY-GONE'));

  console.log(`\n[self-test] ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

(async () => {
  if (has('self-test')) return selfTest();

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  let protocols;
  let orphans = [];
  try {
    const { PrismaClient } = require(path.join(__dirname, '..', 'nest', 'node_modules', '@prisma', 'client'));
    const prisma = new PrismaClient();
    const rows = await prisma.$queryRawUnsafe('SELECT slug, active, derivedFrom FROM protocol');
    const abTests = await prisma.$queryRawUnsafe('SELECT id FROM ab_test');
    orphans = await prisma.$queryRawUnsafe('SELECT s.protocolId, COUNT(*) n FROM score_snapshot s LEFT JOIN protocol pr ON pr.slug = s.protocolId WHERE pr.slug IS NULL GROUP BY s.protocolId');
    manifest.__abTestIds = abTests.map((t) => t.id);
    protocols = rows.map((r) => ({ slug: r.slug, active: Number(r.active), derivedFrom: r.derivedFrom ?? null }));
    await prisma.$disconnect();
  } catch (e) {
    // ⚠️ UNVERIFIED, never a pass. A check that cannot read its input must say so.
    console.error(`🛑 UNVERIFIED — cannot read the database: ${e.message}`);
    process.exit(2);
  }

  const { copies, orphanHistory, findings } = assess(protocols, manifest, orphans);
  if (has('json')) { console.log(JSON.stringify({ copies, orphanHistory, findings }, null, 2)); return; }

  console.log(`\nPROTOCOL COPIES — ${copies.length} slug(s) containing "-copy"\n`);
  for (const c of copies) console.log(`  ${c.slug.padEnd(26)} active=${c.active}  derivedFrom=${c.derivedFrom}`);
  if (!findings.length) { console.log('\n✅ OK — every -copy protocol is declared and matches its manifest entry.\n'); return; }

  console.log(`\n✖ ${findings.length} finding(s):\n`);
  for (const f of findings) console.log(`  [${f.rule}] ${f.message}`);
  console.log('\n  Fix: declare the copy in scripts/protocol-copies.json with the test it serves, or\n' +
    '  deactivate it and give the reason it is still here.\n');
  process.exit(1);
})();
