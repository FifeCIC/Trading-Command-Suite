const { execSync } = require('child_process');

const issues = [
  {
    num: 510,
    body: `## Pre-Close Checklist — #510

### All 4 Phases Complete
- **Phase 1**: 102 directives seeded to DB via POST /api/directives/seed
- **Phase 2**: loadDirectiveMetadata() overlays DB config on class instances at startup
- **Phase 3**: 44 protocols seeded to DB via POST /api/scoring/gated/protocols/seed
- **Phase 4**: Hardcoded PROTOCOL_REGISTRY removed (~1,810 lines). All consumers DB-only. Standalone seed file preserves install capability.

### Verification
- Build passes (NestJS + Vite)
- GET /api/directives — 102 directives, properly categorized
- GET /api/scoring/gated/protocols — 44 protocols from DB
- Both seed endpoints idempotent
- Zero code references to PROTOCOL_REGISTRY

✅ Ready to close.`
  },
  {
    num: 508,
    body: `## Pre-Close Checklist — #508

### Completed
- **uplot** removed from package.json dependencies (was 12, now 11 runtime deps)
- **UPlotChart** component deleted
- **mermaid** converted to dynamic import (lazy-loaded, not in main bundle)
- Bundle size reduced

### Verification
- npm run build passes
- No remaining uplot imports
- Charts still render via lightweight-charts

✅ Ready to close.`
  },
  {
    num: 498,
    body: `## Pre-Close Checklist — #498

### Completed
- MT5 controller audited: endpoints annotated with @deprecated JSDoc
- Responses include _deprecated:true and _migrateTo fields
- Console warning on any call to deprecated endpoints
- **Zero active callers** confirmed across entire codebase

### Verification
- grep for mt5.controller usage — no non-deprecated consumers
- API health still reports MT5 as healthy provider
- New trade pathway via bridge is canonical

✅ Ready to close.`
  },
  {
    num: 499,
    body: `## Pre-Close Checklist — #499

### Completed
- **NotificationDisc** component deleted (was duplicate of ScreenOptions notification logic)
- Verified no remaining imports of NotificationDisc
- ScreenOptions remains as canonical notification handler

### Verification
- npm run build passes
- Zero references to NotificationDisc in codebase
- Notifications still functional via ScreenOptions

✅ Ready to close.`
  }
];

for (const issue of issues) {
  console.log(`\n--- Issue #${issue.num} ---`);
  try {
    const result = execSync(`gh issue comment ${issue.num} --repo FifeCIC/Trading-Command-Suite --body "${issue.body.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, { encoding: 'utf8', shell: true });
    console.log('Comment:', result.trim());
  } catch(e) {
    console.log('Comment error:', e.message);
  }
  try {
    const result = execSync(`gh issue close ${issue.num} --repo FifeCIC/Trading-Command-Suite --reason completed`, { encoding: 'utf8', shell: true });
    console.log('Close:', result.trim());
  } catch(e) {
    console.log('Close error:', e.message);
  }
}
