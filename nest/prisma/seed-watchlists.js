"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const fs_1 = require("fs");
const path_1 = require("path");
const prisma = new client_1.PrismaClient();
const WATCHLISTS_DIR = (0, path_1.resolve)(__dirname, '../../src/data/watchlists');
async function main() {
    if (!(0, fs_1.existsSync)(WATCHLISTS_DIR)) {
        console.log(`No watchlists directory at ${WATCHLISTS_DIR}`);
        await prisma.$disconnect();
        return;
    }
    const files = (0, fs_1.readdirSync)(WATCHLISTS_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${files.length} watchlist JSON files`);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const file of files) {
        const name = (0, path_1.basename)(file, '.json');
        try {
            const raw = (0, fs_1.readFileSync)((0, path_1.resolve)(WATCHLISTS_DIR, file), 'utf-8');
            const data = JSON.parse(raw);
            const symbols = Array.isArray(data)
                ? data.map((s) => typeof s === 'string' ? s : s.ticker || s.symbol).filter(Boolean)
                : (data.symbols && Array.isArray(data.symbols))
                    ? data.symbols.map((s) => typeof s === 'string' ? s : s.ticker || s.symbol).filter(Boolean)
                    : [];
            if (symbols.length === 0) {
                console.log(`  ${name}: empty — skipping`);
                skipped++;
                continue;
            }
            const existing = await prisma.watchlist.findFirst({ where: { name } });
            if (existing) {
                await prisma.watchlist.update({
                    where: { id: existing.id },
                    data: { symbols: symbols, kind: 'system', updatedAt: new Date() },
                });
                console.log(`  ${name}: updated (${symbols.length} symbols)`);
                updated++;
            }
            else {
                await prisma.watchlist.create({
                    data: { name, symbols: symbols, kind: 'system', isDefault: name === 'primary' },
                });
                console.log(`  ${name}: created (${symbols.length} symbols)`);
                created++;
            }
        }
        catch (err) {
            console.error(`  ${name}: ERROR — ${err.message}`);
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
//# sourceMappingURL=seed-watchlists.js.map