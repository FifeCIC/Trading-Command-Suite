// Quick seed: reads the backup data file and inserts sections/entries into DB.
// Run: node nest/seed-arch.cjs
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Minimal section + entry data (the backup file is ES modules, can't require() directly)
const SECTIONS = [
  { key: 'status', title: 'Status Snapshot', desc: 'What exists now — current state of the system', order: 1 },
  { key: 'tree', title: 'Architecture Tree', desc: 'System spine, domains, and data flow', order: 2 },
  { key: 'schema', title: 'Database Schema', desc: 'Entities, relationships, planned tables', order: 3 },
  { key: 'workflow', title: 'Decision Workflow', desc: '6-step architecture decision process', order: 4 },
  { key: 'contracts', title: 'Contract Inventory', desc: 'Route, queue, storage, provider, and UI contracts', order: 5 },
  { key: 'register', title: 'Contract Register', desc: 'Active route contracts with status', order: 6 },
  { key: 'scoring', title: 'Scoring & Strategy Contract', desc: 'Directive input/output, protocol aggregation, testing', order: 7 },
  { key: 'calibration', title: 'Calibration System', desc: 'Symbol-specific weight overrides', order: 8 },
  { key: 'activation-gate', title: 'Activation Gate', desc: 'Pre-scoring condition detection and directive gating', order: 9 },
  { key: 'exit-signals', title: 'Exit Signal System', desc: 'Four exit directives for position management', order: 10 },
  { key: 'alerts', title: 'Alert Center', desc: 'Centralized notification system with lifecycle', order: 11 },
  { key: 'governance', title: 'Governance & Guardrails', desc: 'AI rules, verification, definition of done', order: 12 },
  { key: 'gaps', title: 'Known Gaps', desc: 'Technical debt, limitations, and risks', order: 13 },
];

async function seed() {
  console.log('Seeding architecture sections...');
  
  for (const s of SECTIONS) {
    await prisma.architectureSection.upsert({
      where: { sectionKey: s.key },
      update: { title: s.title, description: s.desc, sortOrder: s.order },
      create: { sectionKey: s.key, title: s.title, description: s.desc, sortOrder: s.order },
    });
  }

  // Insert a status entry
  const statusSection = await prisma.architectureSection.findUnique({ where: { sectionKey: 'status' } });
  if (statusSection) {
    await prisma.architectureEntry.deleteMany({ where: { sectionId: statusSection.id } });
    const statusEntries = [
      'Architecture DB migration completed (2026-07-15). API at /api/architecture/*. Backup at architecture-framework.data.backup-2026-07-15.js.',
      'Frontend: React 18 + Vite on port 5173. 50+ pages. CSS variables for all colors.',
      'Backend: NestJS on port 3201. 37+ modules registered. Prisma ORM with MySQL.',
      'Bridge: Python MT5 bridge v2 on port 5000. Multi-account support.',
      '50+ scoring directives live. Protocol risk gating with multiplicative scoring.',
      'Accessibility policy: WCAG 2.2 AA. Contrast tokens all pass. Reduced motion supported. High contrast mode available via Screen Options.',
      'Form standard CSS: src/core/forms.css with .ff-* classes. Applied to Create Strategy and Create Protocols forms.',
      'Hot Stock Picks Lab at /lab/hot-stock-picks. Dashboard widget at /dashboard.',
      'Architecture Framework page at /builder/architecture-framework. 21 sections with search.',
      'GitHub Issues are the canonical task tracking system. Label-based domain mapping.',
    ];
    for (let i = 0; i < statusEntries.length; i++) {
      await prisma.architectureEntry.create({
        data: { sectionId: statusSection.id, sortOrder: i, content: statusEntries[i], tags: 'status,active,built' },
      });
    }
  }

  // Insert governance entries
  const govSection = await prisma.architectureSection.findUnique({ where: { sectionKey: 'governance' } });
  if (govSection) {
    await prisma.architectureEntry.deleteMany({ where: { sectionId: govSection.id } });
    const govEntries = [
      'DO FIRST: Search existing systems before creating new files. Identify data flow and contract before implementing UI.',
      'DO NOT: Call external providers during page rendering. Bypass auth/logging rules. Add duplicate systems without documenting the gap.',
      'UI DATA HONESTY: Every number must come from storage or a live endpoint. Use "—" when no data exists. Never hardcode demo values.',
      'SECURITY: Name the permission mechanism for every endpoint. Sanitize input. Redact secrets. Token-authenticated routes as integration boundary.',
      'DEFINITION OF DONE: Ownership confirmed, contract updated, data flow preserved, security preserved, UI state honest, verification recorded.',
    ];
    for (let i = 0; i < govEntries.length; i++) {
      await prisma.architectureEntry.create({
        data: { sectionId: govSection.id, sortOrder: i, content: govEntries[i], tags: 'governance,active' },
      });
    }
  }

  console.log('Seed complete.');
  await prisma.$disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
