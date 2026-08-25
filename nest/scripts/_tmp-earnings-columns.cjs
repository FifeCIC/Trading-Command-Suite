const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const cols = await p.$queryRawUnsafe('SHOW COLUMNS FROM earnings_event');
  const names = cols.map((c) => c.Field);

  if (!names.includes('last_year_eps')) {
    await p.$executeRawUnsafe('ALTER TABLE earnings_event ADD COLUMN last_year_eps DOUBLE NULL');
    console.log('added last_year_eps');
  }
  if (!names.includes('last_year_date')) {
    await p.$executeRawUnsafe('ALTER TABLE earnings_event ADD COLUMN last_year_date DATETIME NULL');
    console.log('added last_year_date');
  }
  if (!names.includes('market_cap')) {
    await p.$executeRawUnsafe('ALTER TABLE earnings_event ADD COLUMN market_cap DOUBLE NULL');
    console.log('added market_cap');
  }

  const after = await p.$queryRawUnsafe('SHOW COLUMNS FROM earnings_event');
  console.log('columns now:', after.map((c) => c.Field).join(', '));
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
