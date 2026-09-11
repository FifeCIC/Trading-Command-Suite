// temp-step3b.cjs — why is an INACTIVE protocol (usdcad-oil-v1) producing live scores?
// findAllActive() should exclude active=0. Confirm the mechanism before writing a decision.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const log = (s) => console.log(s);

  log('=== usdcad-oil-v1 latest scores ===');
  const r = await p.$queryRawUnsafe(
    `SELECT strategyId, value, timestamp FROM score WHERE strategyId='usdcad-oil-v1'
     ORDER BY timestamp DESC LIMIT 12`
  );
  log('  ' + JSON.stringify(r, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  log('\n=== is it in protocol_score_status? (loop records only active protocols) ===');
  const st = await p.$queryRawUnsafe(
    `SELECT * FROM protocol_score_status WHERE protocolId LIKE '%usdcad%'`
  );
  log('  ' + JSON.stringify(st, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  log('\n=== which protocols DID the loop score this tick? (status rows) ===');
  const all = await p.$queryRawUnsafe(
    `SELECT protocolId, state, symbolsScored, lastTickAt FROM protocol_score_status ORDER BY protocolId`
  );
  log('  ' + JSON.stringify(all, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  log('\n=== recent score rows grouped, to see WHO is writing right now ===');
  const recent = await p.$queryRawUnsafe(
    `SELECT strategyId, COUNT(*) AS n, MAX(timestamp) AS last FROM score
     WHERE timestamp > NOW() - INTERVAL 10 MINUTE GROUP BY strategyId ORDER BY n DESC`
  );
  log('  ' + JSON.stringify(recent, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  log('\n=== usdcad-oil-v1 active flag + is there a WATCHLIST named usdcad-oil? ===');
  const w = await p.$queryRawUnsafe(
    `SELECT id, name, protocolId FROM watchlist WHERE name LIKE '%usdcad%' OR protocolId LIKE '%usdcad%'`
  ).catch(async () => {
    const c = await p.$queryRawUnsafe(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='watchlist'`);
    return [{ cols: c.map(x => x.COLUMN_NAME).join(', ') }];
  });
  log('  ' + JSON.stringify(w, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  await p.$disconnect();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
