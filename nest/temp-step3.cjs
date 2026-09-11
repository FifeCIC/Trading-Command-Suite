// temp-step3.cjs — STEP 3 of #772: the six unstarted protocols.
// For EACH: is it active? does it resolve a symbol? is it scoring? does it have a bot?
// Verified data only — the issue's own table was wrong for usdcad-oil-v1.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const log = (s) => console.log(s);
  const SLUGS = ['mt5-technical-short','eurusd-macro-v1','usdjpy-risk-v1','gbpusd-news-v1','usdcad-oil-v1','commodity-pairs-v1'];

  log('=== protocol rows ===');
  const protos = await p.$queryRawUnsafe(
    `SELECT id, slug, name, directionMode, active, recommendedTimeframe FROM protocol
     WHERE slug IN (${SLUGS.map(() => '?').join(',')}) ORDER BY slug`, ...SLUGS
  );
  log('  ' + JSON.stringify(protos, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  log('\n=== score history (score.strategyId = slug) ===');
  const scores = await p.$queryRawUnsafe(
    `SELECT strategyId, COUNT(*) AS n, MAX(value) AS maxVal, MAX(timestamp) AS last
     FROM score WHERE strategyId IN (${SLUGS.map(() => '?').join(',')})
     GROUP BY strategyId`, ...SLUGS
  );
  log('  ' + JSON.stringify(scores, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  log('\n=== score from the OTHER form (uuid) too ===');
  const ids = protos.map(x => x.id);
  const scoresUuid = await p.$queryRawUnsafe(
    `SELECT strategyId, COUNT(*) AS n FROM score WHERE strategyId IN (${ids.map(() => '?').join(',')})
     GROUP BY strategyId`, ...ids
  ).catch(() => []);
  log('  ' + JSON.stringify(scoresUuid, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  log('\n=== bots (both forms) ===');
  const cand = [...SLUGS, ...ids];
  const bots = await p.$queryRawUnsafe(
    `SELECT id, name, symbol, protocolId, mode, active FROM trading_strategy
     WHERE protocolId IN (${cand.map(() => '?').join(',')})`, ...cand
  );
  log('  ' + JSON.stringify(bots, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  log('\n=== scoring status (what the loop thinks) ===');
  const st = await p.$queryRawUnsafe(
    `SELECT protocolId, state, reason, symbolsResolved, symbolsScored FROM protocol_score_status
     WHERE protocolId IN (${SLUGS.map(() => '?').join(',')})`, ...SLUGS
  ).catch(e => [{ err: e.message.split('\n')[0] }]);
  log('  ' + JSON.stringify(st, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  log('\n=== symbol assignments ===');
  const asg = await p.$queryRawUnsafe(
    `SELECT protocolId, symbol FROM symbol_protocol_assignment
     WHERE protocolId IN (${cand.map(() => '?').join(',')})`, ...cand
  ).catch(() => []);
  log('  ' + JSON.stringify(asg, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));

  await p.$disconnect();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
