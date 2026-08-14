// Seed capability table from CapabilityMapPage embedded data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Mirror of KNOWN_FEATURES from CapabilityMapPage (plus additional rows)
const capabilities = [
  // Directives
  { name:'dxy-regime', category:'Directive', area:'Scoring', type:'Directive', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:1, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'gold-macro-correlation', category:'Directive', area:'Scoring', type:'Directive', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:0, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'earnings-momentum', category:'Directive', area:'Scoring', type:'Directive', status:'LIVE', dataPersistence:'stored', uiSurfaces:0, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'rsi-divergence', category:'Directive', area:'Scoring', type:'Directive', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:0, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'macd-divergence', category:'Directive', area:'Scoring', type:'Directive', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:0, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'obv-divergence', category:'Directive', area:'Scoring', type:'Directive', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:0, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'vwap-confluence-simple', category:'Directive', area:'Scoring', type:'Directive', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:0, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'gap-scanner', category:'Directive', area:'Scoring', type:'Directive', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:0, pipelineIntegration:'scoring', devCompletion:'complete' },
  // Backend Services
  { name:'SEES Scoring Engine', category:'Service', area:'Scoring', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:4, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'Speed Scan Service', category:'Service', area:'Scoring', type:'Service', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:1, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'Gated Scoring Pipeline', category:'Service', area:'Scoring', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:3, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'Protocol System (32 protocols)', category:'Service', area:'Scoring', type:'Service', status:'LIVE', dataPersistence:'config', uiSurfaces:3, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'Directive Registry (99 directives)', category:'Service', area:'Scoring', type:'Service', status:'LIVE', dataPersistence:'config', uiSurfaces:2, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'ExitSignalService (Multi-factor)', category:'Service', area:'Scoring', type:'Service', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:1, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'Automation Loop (9 endpoints)', category:'Service', area:'Automation', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'both', devCompletion:'complete' },
  { name:'Risk Service (Drawdown Alerts)', category:'Service', area:'Risk', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'trading', devCompletion:'complete' },
  { name:'Alert Service', category:'Service', area:'Alerts', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'both', devCompletion:'complete' },
  { name:'Portfolio Service (T212)', category:'Service', area:'Trading', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:2, pipelineIntegration:'both', devCompletion:'complete' },
  { name:'Backtest Service', category:'Service', area:'Backtest', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'scoring', devCompletion:'partial' },
  { name:'Correlation Service', category:'Service', area:'Research', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'Seasonal Affinity Service', category:'Service', area:'Scoring', type:'Service', status:'LIVE', dataPersistence:'config', uiSurfaces:0, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'MarketContextService (7-Day)', category:'Service', area:'Trading', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'both', devCompletion:'complete' },
  { name:'Provider Degradation Service', category:'Service', area:'Providers', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:2, pipelineIntegration:'both', devCompletion:'complete' },
  { name:'Scoring Degradation Monitor', category:'Service', area:'Scoring', type:'Service', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:2, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'PerformanceService (equity curve)', category:'Service', area:'Performance', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'both', devCompletion:'complete' },
  // Platform
  { name:'MT5 Bridge', category:'Platform', area:'Trading', type:'Bridge', status:'LIVE', dataPersistence:'stored', uiSurfaces:2, pipelineIntegration:'trading', devCompletion:'complete' },
  { name:'Trading212 API', category:'Platform', area:'Trading', type:'Provider', status:'LIVE', dataPersistence:'stored', uiSurfaces:2, pipelineIntegration:'trading', devCompletion:'complete' },
  { name:'Finnhub API', category:'Platform', area:'Providers', type:'Provider', status:'LIVE', dataPersistence:'stored', uiSurfaces:0, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'DeepSeek AI', category:'Platform', area:'AI', type:'Provider', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:1, pipelineIntegration:'none', devCompletion:'complete' },
  { name:'Binance Adapter', category:'Platform', area:'Providers', type:'Provider', status:'LIVE', dataPersistence:'stored', uiSurfaces:0, pipelineIntegration:'scoring', devCompletion:'complete' },
  // Frontend
  { name:'Market Status Ticker', category:'Frontend', area:'UI', type:'Component', status:'LIVE', dataPersistence:'cached', uiSurfaces:1, pipelineIntegration:'none', devCompletion:'complete' },
  { name:'Market Context Page', category:'Frontend', area:'UI', type:'Page', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'both', devCompletion:'complete' },
  { name:'Exit Signals Page', category:'Frontend', area:'UI', type:'Page', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'Speed Scanner', category:'Frontend', area:'UI', type:'Page', status:'LIVE', dataPersistence:'ephemeral', uiSurfaces:1, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'QA Testing Page', category:'Frontend', area:'UI', type:'Page', status:'LIVE', dataPersistence:'localStorage', uiSurfaces:1, pipelineIntegration:'none', devCompletion:'complete' },
  { name:'Dashboard', category:'Frontend', area:'UI', type:'Page', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'both', devCompletion:'complete' },
  { name:'Hot Stock Picks Lab', category:'Frontend', area:'UI', type:'Page', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'scoring', devCompletion:'complete' },
  { name:'Theme System (10+ packs)', category:'Frontend', area:'UI', type:'System', status:'LIVE', dataPersistence:'config', uiSurfaces:1, pipelineIntegration:'none', devCompletion:'complete' },
  { name:'Form Standard CSS (src/core/forms.css)', category:'Frontend', area:'UI', type:'System', status:'LIVE', dataPersistence:'config', uiSurfaces:2, pipelineIntegration:'none', devCompletion:'complete' },
  // 2026-07-14 additions
  { name:'Architecture DB API', category:'Service', area:'Architecture', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:0, pipelineIntegration:'none', devCompletion:'complete' },
  { name:'Accessibility Policy (WCAG 2.2 AA)', category:'Governance', area:'Accessibility', type:'Policy', status:'LIVE', dataPersistence:'config', uiSurfaces:1, pipelineIntegration:'none', devCompletion:'complete' },
  { name:'High Contrast Mode', category:'Frontend', area:'Accessibility', type:'Feature', status:'LIVE', dataPersistence:'localStorage', uiSurfaces:1, pipelineIntegration:'none', devCompletion:'complete' },
  { name:'Reduced Motion Support', category:'Frontend', area:'Accessibility', type:'Feature', status:'LIVE', dataPersistence:'config', uiSurfaces:0, pipelineIntegration:'none', devCompletion:'complete' },
  { name:'Capability Map DB API', category:'Service', area:'Architecture', type:'Service', status:'LIVE', dataPersistence:'stored', uiSurfaces:1, pipelineIntegration:'none', devCompletion:'complete' },
];

async function seed() {
  console.log(`Seeding ${capabilities.length} capabilities...`);
  for (const c of capabilities) {
    await prisma.capability.upsert({
      where: { id: require('crypto').randomUUID() },
      update: {},
      create: {
        name: c.name, category: c.category, area: c.area, type: c.type,
        status: c.status, dataPersistence: c.dataPersistence,
        uiSurfaces: c.uiSurfaces, pipelineIntegration: c.pipelineIntegration,
        devCompletion: c.devCompletion,
      },
    });
    // Since upsert requires unique criteria and we don't have a natural key,
    // just create. Delete existing first for idempotent re-seed.
  }
  console.log('Seed complete.');
  await prisma.$disconnect();
}

// Clear + seed
async function run() {
  await prisma.capability.deleteMany();
  await seed();
}
run().catch(e => { console.error(e); process.exit(1); });
