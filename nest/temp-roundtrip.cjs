// temp-roundtrip.cjs — PROVE the seed restores VIX, by simulating a reinstall.
// Deletes the VIX symbol_route row, then asks the seeder to rebuild it.
// This is the only honest way to claim "a reinstall restores it".
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const { execSync } = require('child_process');

(async () => {
  const log = (s) => console.log(s);

  // 1. Capture current state
  const before = await p.$queryRawUnsafe(
    `SELECT symbol, brokerId, brokerSymbol, provider, enabled, note FROM symbol_route WHERE symbol='VIX'`
  );
  log('=== 1. BEFORE (as created this session) ===');
  log('  ' + JSON.stringify(before, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));
  if (!before.length) { log('  !! no VIX row — cannot run round-trip'); await p.$disconnect(); return; }

  // 2. Simulate DB loss for this row
  log('\n=== 2. SIMULATE REINSTALL — deleting the VIX route ===');
  await p.$executeRawUnsafe(`DELETE FROM symbol_route WHERE symbol='VIX'`);
  const gone = await p.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM symbol_route WHERE symbol='VIX'`);
  log('  VIX rows now: ' + JSON.stringify(gone, (k, v) => typeof v === 'bigint' ? Number(v) : v));

  // 3. Run the SEEDER (not a manual insert) — this is what a reinstall would do
  log('\n=== 3. RUN THE SEEDER ===');
  try {
    const out = execSync('npx ts-node prisma/seed-symbol-onboarding.ts', {
      cwd: 'C:/wamp64/www/trading-command-suite/nest',
      env: { ...process.env, DATABASE_URL: 'mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs' },
      encoding: 'utf8',
    });
    const vixLine = out.split('\n').find(l => /VIX/.test(l));
    log('  seeder output for VIX: ' + (vixLine ? vixLine.trim() : '(none)'));
  } catch (e) {
    log('  seeder FAILED: ' + (e.stdout || e.message).slice(0, 400));
  }

  // 4. Verify restored
  const after = await p.$queryRawUnsafe(
    `SELECT symbol, brokerId, brokerSymbol, provider, enabled, note FROM symbol_route WHERE symbol='VIX'`
  );
  log('\n=== 4. AFTER re-seed ===');
  log('  ' + JSON.stringify(after, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  const ok = after.length === 1 && after[0].brokerId === 3 && after[0].enabled;
  log('\n' + (ok ? '✅ ROUND-TRIP PASSES — the seeder restores VIX from a clean DB'
                 : '❌ ROUND-TRIP FAILED — the row did not come back correctly'));

  await p.$disconnect();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
