const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  console.log('Checking table row counts...');
  const tables = [
    ['MarketBar', 'market_bar'],
    ['Score', 'score'],
    ['Signal', 'signal'],
    ['Symbol', 'symbol'],
    ['Directive', 'directive'],
    ['MarketSnapshot', 'market_snapshot'],
    ['NewsArticle', 'news_article'],
    ['Position', 'position'],
    ['Strategy', 'strategy'],
    ['Watchlist', 'watchlist'],
  ];
  for (const [name, label] of tables) {
    try {
      const r = await p.$queryRawUnsafe('SELECT COUNT(*) AS cnt FROM `' + name + '`');
      console.log(label + ': ' + r[0].cnt + ' rows');
    } catch(e) { console.log(label + ': ERROR - ' + e.message.substring(0, 80)); }
  }
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
