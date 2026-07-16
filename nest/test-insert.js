const {PrismaClient} = require("@prisma/client");
const p = new PrismaClient();
(async()=>{
  await p.$connect();
  const sym = await p.symbol.findFirst({where:{ticker:"EURUSD"}});
  const now = new Date();
  const mid = 1.149;
  
  const count = await p.$executeRaw`
    INSERT INTO marketbar (symbolId, provider, timeframe, timestamp, open, high, low, close, volume)
    VALUES (${sym.id}, "mt5", "5m", ${now}, ${mid}, ${mid}, ${mid}, ${mid}, 3)
  `;
  console.log("Insert count:", count);
  
  const rows = await p.$queryRaw`SELECT timestamp, close FROM marketbar WHERE symbolId=${sym.id} AND timeframe="5m" ORDER BY timestamp DESC LIMIT 2`;
  console.log("Latest bars:", JSON.stringify(rows));
  await p.$disconnect();
})().catch(e=>console.error("ERR:", e.message));
