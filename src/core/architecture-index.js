/**
 * Architecture Framework — Orientation Index
 * ===========================================
 * THIS IS THE SIGN-POST. The full architecture content lives in the DB.
 * Agents: query /api/architecture/* instead of reading large data files.
 * 
 * This file is ~2KB. The old static data was ~600KB (114KB source).
 * For the full archive, see: architecture-framework.data.backup-2026-07-15.js
 */

export const ARCHITECTURE_MAP = {
  sections: [
    { key: 'status',        title: 'Status Snapshot',             topics: ['what exists', 'what is built', 'current state'] },
    { key: 'tree',          title: 'Architecture Tree',            topics: ['system spine', 'domains', 'data flow'] },
    { key: 'schema',        title: 'Database Schema',              topics: ['entities', 'relationships', 'planned tables'] },
    { key: 'workflow',      title: 'Decision Workflow',            topics: ['classify', 'find existing', 'data flow', 'contracts'] },
    { key: 'matrix',        title: 'Feature Decision Matrix',      topics: ['feature type', 'owner', 'contract'] },
    { key: 'intake',        title: 'Intake Template',              topics: ['classification', 'architecture fit', 'data contract'] },
    { key: 'discovery',     title: 'Discovery & Sources',          topics: ['routes', 'queues', 'storage', 'providers'] },
    { key: 'context',       title: 'System Context',               topics: ['runtime', 'extensions', 'bridge', 'providers'] },
    { key: 'owners',        title: 'Owner Directory',              topics: ['who owns what', 'responsibilities'] },
    { key: 'contracts',     title: 'Contract Inventory',           topics: ['route', 'queue', 'storage', 'provider', 'UI'] },
    { key: 'register',      title: 'Contract Register',            topics: ['active routes', 'flow contracts'] },
    { key: 'queue',         title: 'Queue & Provider Contract',    topics: ['data states', 'provider selection', 'freshness'] },
    { key: 'scoring',       title: 'Scoring & Strategy Contract',  topics: ['directives', 'protocols', 'gating', 'calibration'] },
    { key: 'calibration',   title: 'Calibration System',           topics: ['weight overrides', 'symbol-specific'] },
    { key: 'activation-gate',title: 'Activation Gate & Conditions',topics: ['condition detection', 'triggers', 'suitability'] },
    { key: 'exit-signals',  title: 'Exit Signal System',           topics: ['exit directives', 'urgency', 'momentum'] },
    { key: 'alerts',        title: 'Alert Center Architecture',    topics: ['notifications', 'severity', 'lifecycle'] },
    { key: 'governance',    title: 'Governance & Guardrails',      topics: ['AI guardrails', 'verification', 'done', 'handoff'] },
    { key: 'issues',        title: 'GitHub Issues Backlog',        topics: ['broken pages', 'open issues', 'domain mapping'] },
    { key: 'gaps',          title: 'Known Gaps & Revision Log',    topics: ['debt', 'limitations', 'risks', 'history'] },
    { key: 'roadmap',       title: 'Roadmap',                      topics: ['planned', 'in-progress', 'done'] },
  ],

  // Critical system boundaries — every agent must know these
  boundaries: {
    frontend:  'React 18 + Vite, port 5173. Pages in src/pages/. Nav in src/core/nav-tree.js. CSS variables in src/index.css.',
    backend:   'NestJS, port 3201. Modules in nest/src/modules/. Prisma ORM. 37+ modules registered.',
    bridge:    'Python MT5 bridge v2 (http.server), port 5000. Scripts in scripts/mt5-bridge/.',
    database:  'MySQL via Prisma. Connection in nest/.env. Schema in nest/prisma/schema.prisma.',
    docs:      'Google Drive: G:\\My Drive\\Project Management\\Live\\Trading-Command-Suite-Documentation\\.',
    issues:    'GitHub: https://github.com/FifeCIC/Trading-Command-Suite/issues',
  },

  // How to query the architecture DB
  apiBase: 'http://localhost:3201/api/architecture',
  endpoints: {
    index:      'GET /index                          — Section list with entry counts',
    section:    'GET /section/:key                    — All entries for a section',
    search:     'GET /search?q=scoring&tag=active     — Full-text search across entries',
    entries:    'GET /entries?status=active&tag=auto  — Filtered entry list',
    add:        'POST /entries?section=key&content=.. — Add new entry (agents use this)',
    update:     'PATCH /entries/:id                   — Update an entry',
    archive:    'DELETE /entries/:id                   — Archive an entry',
    revisions:  'GET /revisions/:entryId               — Audit trail',
    boundaries: 'GET /boundaries                       — System boundaries',
  },

  // Token savings reference
  tokenInfo: {
    oldFileSize: '~600KB bundled, ~114KB source',
    newIndexSize: '~2KB',
    estimatedSavings: '~140K tokens per agent session that reads architecture context',
    howToQuery: 'Use the /api/architecture/* endpoints above. Only fetch the section you need.',
  },
};

// Backward compatibility: re-export existing data until AF page is fully migrated.
// The full data file is still available for direct import but agents should prefer the API.
export { STATUS_SNAPSHOT, CURRENT_SLICE, REVISION_LOG } from './architecture-framework.data.backup-2026-07-15';
