"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const strategy_seeds_1 = require("../src/modules/strategies/strategy-seeds");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Seeding strategies…\n');
    let created = 0;
    let updated = 0;
    for (const seed of strategy_seeds_1.STRATEGY_SEEDS) {
        const existing = await prisma.strategy.findFirst({
            where: { name: seed.name },
        });
        const config = {
            entryThreshold: 60,
            watchThreshold: 40,
            scope: seed.scope,
            templateType: seed.templateType || null,
            intendedTimeframe: seed.intendedTimeframe || null,
            symbols: seed.symbols || seed.scope,
            category: seed.category,
            riskLevel: seed.riskLevel,
            timeHorizon: seed.timeHorizon,
        };
        if (existing) {
            await prisma.strategy.update({
                where: { id: existing.id },
                data: {
                    description: seed.description,
                    config,
                },
            });
            updated++;
            console.log(`  ↻ ${seed.name} (updated)`);
        }
        else {
            await prisma.strategy.create({
                data: {
                    name: seed.name,
                    description: seed.description,
                    version: '1.0.0',
                    config,
                    active: true,
                },
            });
            created++;
            console.log(`  ✓ ${seed.name}`);
        }
        const strategy = await prisma.strategy.findFirst({ where: { name: seed.name } });
        if (!strategy)
            continue;
        for (const directiveId of seed.directiveIds) {
            const existingDirective = await prisma.directive.findFirst({
                where: { strategyId: strategy.id, type: directiveId },
            });
            if (!existingDirective) {
                await prisma.directive.create({
                    data: {
                        strategyId: strategy.id,
                        name: directiveId,
                        type: directiveId,
                        weight: 1.0,
                        config: {},
                        active: true,
                    },
                });
            }
        }
    }
    console.log(`\nDone: ${created} created, ${updated} updated, ${strategy_seeds_1.STRATEGY_SEEDS.length} total strategies.\n`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed-strategies.js.map