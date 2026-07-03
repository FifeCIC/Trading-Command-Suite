const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();
p.macroSnapshot.findMany({ orderBy: { createdAt: 'desc' }, take: 3 })
  .then(r => { console.log(JSON.stringify(r, null, 2)); p.$disconnect(); })
  .catch(e => { console.error(e.message); p.$disconnect(); });
