/**
 * Seed watchlists from JSON files into the DB.
 *
 * Reads all .json files from src/data/watchlists/ and upserts them
 * into the watchlist table with kind='system'.
 *
 * Run: npx ts-node prisma/seed-watchlists.ts
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, basename } from 'path';

const prisma = new PrismaClient();
const WATCHLISTS_DIR = resolve(__dirname, '../../src/data/watchlists');

async function main() {
  if (!existsSync(WATCHLISTS_DIR)) {
    console.log(`No watchlists directory at ${WATCHLISTS_DIR}`);
    await prisma.$disconnect();
    return;
  }

  const files = readdirSync(WATCHLISTS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} watchlist JSON files`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const file of files) {
    const name = basename(file, '.json');
    try {
      const raw = readFileSync(resolve(WATCHLISTS_DIR, file), 'utf-8');
      const data = JSON.parse(raw);
      const symbols = Array.isArray(data)
        ? data.map((s: any) => typeof s === 'string' ? s : s.ticker || s.symbol).filter(Boolean)
        : (data.symbols && Array.isArray(data.symbols))
          ? data.symbols.map((s: any) => typeof s === 'string' ? s : s.ticker || s.symbol).filter(Boolean)
          : [];

      if (symbols.length === 0) {
        console.log(`  ${name}: empty — skipping`);
        skipped++;
        continue;
      }

      // Try update first, then create
      const existing = await prisma.watchlist.findFirst({ where: { name } });
      if (existing) {
        await prisma.watchlist.update({
          where: { id: existing.id },
          data: { symbols: symbols as any, kind: 'system', updatedAt: new Date() },
        });
        console.log(`  ${name}: updated (${symbols.length} symbols)`);
        updated++;
      } else {
        await prisma.watchlist.create({
          data: { name, symbols: symbols as any, kind: 'system', isDefault: name === 'primary' },
        });
        console.log(`  ${name}: created (${symbols.length} symbols)`);
        created++;
      }
    } catch (err) {
      console.error(`  ${name}: ERROR — ${(err as Error).message}`);
    }
  }

  console.log(`\nDone: ${created} created, ${updated} updated, ${skipped} skipped`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
