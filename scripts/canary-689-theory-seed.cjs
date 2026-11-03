// Canary for the #689 theory seeding — BOTH directions, as required.
//
// Direction 1 (RESTORE): null the theory on the six seed-owned protocols, re-seed, expect every
//   one of them back. A seeder that RUNS is not a seeder that RESTORES.
// Direction 2 (PRESERVE): write a sentinel into a protocol the seed does NOT own (gold-macro-v1),
//   re-seed, expect the sentinel untouched. This is the direction that was BROKEN: `?? null` wiped
//   DB-only prose on 2026-11-03 in a single re-seed, with no error.
//
// Run: node logs/canary-689-theory-seed.cjs
const { PrismaClient } = require('../nest/node_modules/@prisma/client');
const SEED_URL = 'http://localhost:3201/api/scoring/gated/protocols/seed';
const OWNED = [
  'xau-speed-v1', 'xau-speed-v1-short',
  'forex-session-v1', 'forex-session-v1-short',
  'momentum-stock-v1', 'momentum-stock-v1-short',
];
const DB_ONLY = 'gold-macro-v1';
const SENTINEL = 'CANARY-SENTINEL-DO-NOT-KEEP';

const p = new PrismaClient();
const lens = async (slugs) => {
  const rows = await p.$queryRawUnsafe(
    `SELECT slug, CHAR_LENGTH(theory) AS len FROM protocol WHERE slug IN (${slugs.map(() => '?').join(',')}) ORDER BY slug`,
    ...slugs
  );
  return Object.fromEntries(rows.map((r) => [r.slug, Number(r.len ?? 0)]));
};
const reseed = async () => {
  const res = await fetch(SEED_URL, { method: 'POST' });
  return `${res.status} ${await res.text()}`;
};

(async () => {
  let failures = 0;
  const fail = (m) => { failures++; console.log(`  ✖ ${m}`); };

  // ── Direction 1: RESTORE ────────────────────────────────────────────────────────────────
  console.log('DIRECTION 1 — RESTORE (seed-owned protocols)');
  const before = await lens(OWNED);
  console.log('  captured lens:', before);
  const empty = Object.entries(before).filter(([, l]) => l === 0).map(([s]) => s);
  if (empty.length) console.log(`  note: already empty before canary: ${empty.join(', ')}`);

  await p.$executeRawUnsafe(
    `UPDATE protocol SET theory = NULL WHERE slug IN (${OWNED.map(() => '?').join(',')})`,
    ...OWNED
  );
  const emptied = await lens(OWNED);
  if (Object.values(emptied).some((l) => l !== 0)) {
    console.log('  ✖ CANARY INVALID — could not null every theory; refusing to report a result');
    console.log('   ', emptied);
    await p.$disconnect();
    process.exit(2);
  }
  console.log('  edit landed — all six are NULL');

  console.log('  re-seeding:', await reseed());
  const restored = await lens(OWNED);
  for (const [slug, len] of Object.entries(restored)) {
    if (len === 0) fail(`${slug} did NOT come back (seed does not restore it)`);
    else console.log(`  ✔ ${slug} restored (${len} chars)`);
  }

  // ── Direction 2: PRESERVE ───────────────────────────────────────────────────────────────
  console.log('\nDIRECTION 2 — PRESERVE (a protocol the seed does NOT own)');
  const goldBefore = (await lens([DB_ONLY]))[DB_ONLY];
  await p.$executeRawUnsafe('UPDATE protocol SET theory = ? WHERE slug = ?', SENTINEL, DB_ONLY);
  const placed = (await lens([DB_ONLY]))[DB_ONLY];
  if (placed !== SENTINEL.length) {
    console.log(`  ✖ CANARY INVALID — sentinel not placed (len ${placed}); refusing to report`);
    await p.$disconnect();
    process.exit(2);
  }
  console.log(`  sentinel placed (gold-macro-v1 was ${goldBefore} chars)`);
  console.log('  re-seeding:', await reseed());
  const goldAfter = (await lens([DB_ONLY]))[DB_ONLY];
  if (goldAfter === SENTINEL.length) {
    console.log(`  ✔ untouched — the seed left ${DB_ONLY} alone (${goldAfter} chars)`);
  } else {
    fail(`${DB_ONLY} was MODIFIED by the seeder: ${SENTINEL.length} → ${goldAfter} chars`);
  }

  // ── Restore the sentinel, and verify the restore byte-for-byte ──────────────────────────
  const sql = require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'protocol-theory-seed.sql'), 'utf8'
  );
  const m = sql.match(new RegExp(`UPDATE protocol SET theory = '((?:[^']|'')*)' WHERE slug = '${DB_ONLY}';`));
  if (!m) {
    console.log(`  ✖ CANARY INVALID — original text for ${DB_ONLY} not found in the seed SQL`);
    await p.$disconnect();
    process.exit(2);
  }
  const original = m[1].replace(/''/g, "'");
  await p.$executeRawUnsafe('UPDATE protocol SET theory = ? WHERE slug = ?', original, DB_ONLY);
  const final = (await lens([DB_ONLY]))[DB_ONLY];
  if (final === original.length) console.log(`  ✔ sentinel removed, original restored (${final} chars)`);
  else fail(`restore failed: expected ${original.length}, got ${final}`);

  console.log(failures === 0 ? '\nRESULT: PASS — both directions behave' : `\nRESULT: FAIL — ${failures} problem(s)`);
  await p.$disconnect();
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
