const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.$connect();

  try {
    const assign = await p.$queryRawUnsafe(
      "SELECT * FROM symbol_protocol_assignment WHERE protocolId='vix-spike-v1' LIMIT 20"
    );
    console.log('assignments:', JSON.stringify(assign));
  } catch (e) { console.log('assign err:', e.message); }

  try {
    const wl = await p.$queryRawUnsafe(
      "SELECT id, name, protocolId, JSON_LENGTH(symbols) n, LEFT(JSON_UNQUOTE(symbols), 300) syms FROM watchlist WHERE protocolId='vix-spike-v1' LIMIT 10"
    );
    console.log('watchlists:', JSON.stringify(wl));
  } catch (e) { console.log('wl err:', e.message); }

  try {
    const t = await p.$queryRawUnsafe("SHOW TABLES LIKE '%run%'");
    console.log('run-ish tables:', JSON.stringify(t));
  } catch (e) { console.log('tables err:', e.message); }

  await p.$disconnect();
})();
