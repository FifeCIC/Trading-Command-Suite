import "dotenv/config";
import { PrismaClient } from '@prisma/client';
import { seedFaq } from './seed-faq';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Trading Command Suite database…');

  const symbols = [
    { ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'stock' },
    { ticker: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', type: 'stock' },
    { ticker: 'TSLA', name: 'Tesla Inc.', exchange: 'NASDAQ', type: 'stock' },
  ];

  for (const symbol of symbols) {
    const existing = await prisma.symbol.findUnique({
      where: { ticker: symbol.ticker },
    });

    if (existing) {
      console.log(`  • ${symbol.ticker} already exists, skipping.`);
      continue;
    }

    await prisma.symbol.create({ data: symbol });
    console.log(`  ✓ ${symbol.ticker}`);
  }

  console.log('Seed complete.');

  // Seed FAQ entries
  const faqCount = await seedFaq(prisma);
  console.log(`  ✓ ${faqCount} FAQ entries seeded.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
