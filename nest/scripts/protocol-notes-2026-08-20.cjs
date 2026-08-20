// 2026-08-20 — Protocol state clarity: disable unconfigured protocols and
// record explanatory notes (why disabled / why no symbols). Additive ALTER
// also runs in PrismaService.bootstrapSchema, but run it now for immediacy.
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  await p.$connect();

  try {
    await p.$executeRawUnsafe('ALTER TABLE protocol ADD COLUMN note TEXT NULL');
    console.log('protocol.note column added');
  } catch {
    console.log('protocol.note already exists');
  }

  const updates = [
    ['eurusd-macro-v1', 0,
      'Parked 2026-08-20 — macro framework pending development. No symbols/watchlist configured yet; will re-enable when assigned.'],
    ['usdjpy-risk-v1', 0,
      'Parked 2026-08-20 — risk model pending development. No symbols/watchlist configured yet; will re-enable when assigned.'],
    ['gbpusd-news-v1', 0,
      'Parked 2026-08-20 — news ingestion not yet wired into scoring. No symbols/watchlist configured yet; will re-enable when assigned.'],
    ['signals-workbench', 1,
      'Sandbox protocol for signal testing — intentionally not wired to live symbols.'],
  ];

  for (const [slug, active, note] of updates) {
    const res = await p.$executeRawUnsafe(
      'UPDATE protocol SET active = ?, note = ? WHERE slug = ?',
      active, note, slug,
    );
    console.log(`${slug}: active=${active}, note set (${res} row)`);
  }

  await p.$disconnect();
})();
