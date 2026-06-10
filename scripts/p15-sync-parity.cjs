const fs = require('fs');
const path = 'c:/wamp64/www/trading-command-suite/docs/PLUGIN-REACT-TAB-PARITY-CHECKLIST.md';
let content = fs.readFileSync(path, 'utf8');

// Summary table fixes
content = content.replace(
  '| Total nav views defined in `nav-tree.js` | 86 |',
  '| Total nav views defined in `nav-tree.js` | 107 |'
);
content = content.replace(
  '| Real pages (full implementation) | 11 |',
  '| Real pages (full implementation) | 17 |'
);
content = content.replace(
  '| Skeleton wrappers (FeatureSkeletonPage) | 7 |\n| Framework page (FeatureSkeletonPage.jsx) | 1 |',
  '| Generic skeleton pages (catch-all renderers) | 2 |'
);
content = content.replace(
  '| Views with no page file at all | 67 |',
  '| Views with no dedicated page file | 88 |'
);
content = content.replace(
  '| **% Implemented** | **12.8%** |\n| **% Skeleton or better** | **20.9%** |',
  '| **% Implemented (dedicated page)** | **15.9%** |'
);

// Status update note
content = content.replace(
  '> Status: **Synced to code state as of 2026-06-10**',
  '> Status: **Synced to code state as of 2026-06-10** (updated: 11→17 real, 7 Skeleton→Real reclassified)'
);

// Reclassify skeleton badges to real
content = content.replace(/🟡 Skeleton/g, '✅ Real');

// Fix area summaries - remove Skeleton column
content = content.replace(
  '| Area | Total Views | Real | Skeleton | Missing |',
  '| Area | Total Views | Real | Missing |'
);
// Fix each area row
const areaFixes = [
  ['| Watchlists | 3 | 0 | 0 | 3 |', '| Watchlists | 3 | 0 | 3 |'],
  ['| Automation | 6 | 0 | `ExecutionQueuePage` | 5 |', '| Automation | 6 | `ExecutionQueuePage` | 5 |'],
  ['| Builder (Development) | 20 | `ArchitectureFrameworkPage`, `ThemePage` | 0 | 18 |', '| Builder (Development) | 20 | `ArchitectureFrameworkPage`, `ThemePage` | 18 |'],
  ['| Focus | 4 | 0 | 0 | 4 |', '| Focus | 4 | 0 | 4 |'],
  ['| Platforms | 4 | `PlatformComparisonsPage` | 0 | 3 |', '| Platforms | 4 | `PlatformComparisonsPage` | 3 |'],
  ['| Wizard | 2 | `SetupWizardPage` | 0 | 1 |', '| Wizard | 2 | `SetupWizardPage` | 1 |'],
  ['| Ops | 5 | `SystemStatusPage` | `RiskControlsPage` | 3 |', '| Ops | 8 | `SystemStatusPage`, `RiskControlsPage` | 6 |'],
  ['| Testing | 3 | 0 | 0 | 3 |', '| Testing | 3 | 0 | 3 |'],
  ['| Settings | 9 | `SettingsPage` | 0 | 8 |', '| Settings | 9 | `SettingsPage` | 8 |'],
];
for (const [old, replacement] of areaFixes) {
  content = content.replace(old, replacement);
}

// Fix Real Pages count
content = content.replace('### Real Pages (11)', '### Real Pages (17)');

// Fix Skeleton Pages section
content = content.replace('### Skeleton Pages (7)', '### Generic / Catch-All Pages (2)');

// Move 6 old-skeleton pages up to Real Pages section
const sixRealPages = [
  '| `EventsCalendarPage.jsx` | `events-calendar` | Research |',
  '| `ExecutionQueuePage.jsx` | `execution-queue` | Automation |',
  '| `NewsIntelPage.jsx` | `news-intel` | Research |',
  '| `RiskControlsPage.jsx` | `risk-controls` | Ops |',
  '| `SignalsWorkbenchPage.jsx` | `signals-workbench` | Trading |',
  '| `StrategyBuilderPage.jsx` | `strategy-builder` | Trading |',
];

// Find the last real page entry and insert 6 more before the blank line
const insertMarker = '| `TradingPlatformsPage.jsx` | `trading-platforms` | Data |';
for (const page of sixRealPages) {
  content = content.replace(insertMarker, insertMarker + '\n' + page);
}

// Remove the old skeleton section entries (they're now duplicates in Real)
// These 6 lines appear in the old Skeleton section; remove them
for (const page of sixRealPages) {
  // Remove second occurrence (in skeleton section)
  const firstIdx = content.indexOf(page);
  const secondIdx = content.indexOf(page, firstIdx + 1);
  if (secondIdx > -1) {
    content = content.slice(0, secondIdx) + content.slice(secondIdx + page.length + 1);
  }
}

// Remove PluginTabSkeletonPage from skeleton section (it's the generic catch-all)
content = content.replace(
  '| `PluginTabSkeletonPage.jsx` | _generic catch-all_ | — |\n',
  ''
);

// Update footer
content = content.replace(
  '*End of parity checklist. Synced to code state: 2026-06-10.*',
  '*End of parity checklist. Synced to code state: 2026-06-10. Changes: 11→17 real pages, 7 reclassified Skeleton→Real (EventsCalendar, NewsIntel, SignalsWorkbench, StrategyBuilder, RiskControls, ExecutionQueue).*'
);

// Add real pages that were missing from the 11 list
const missingRealPages = [
  '| `DirectivesManagerPage.jsx` | `directives-manager` | Scoring |',
];
for (const page of missingRealPages) {
  // Check if already present
  if (!content.includes(page)) {
    content = content.replace(insertMarker, insertMarker + '\n' + page);
  }
}

// Fix Phase Mapping section — replace the old summary table
const oldPhaseMapping = `## Phase Mapping (from \`skeleton-rollout.js\`)

| Phase | Label | Views Mapped | Status |
|---|---|---|---|
| Phase 0 | Foundation | 4 (\`api-endpoints\`, \`api-activity\`, \`data-elements\`, \`active-symbols\`) | All missing |
| Phase 1 | Decision | 3 (\`configure-directives\`, \`algorithm-lab\`, \`create-scoring-strategies\`) | All missing |
| Phase 2 | Execution | 2 (\`trading-strategies\`, \`manual-trading\`) | All missing |
| Phase 3 | Controls | 2 (\`trade-history\`, \`platform-comparisons\`) | \`platform-comparisons\` DONE |
| Phase 4 | Intelligence/Validation | 2 (\`focus-priority\`, \`performance-lab\`) | All missing |
| Legacy (Phase 1-3) | Original roadmap | 6 (\`eventsCalendar\`, \`newsIntel\`, \`signalsWorkbench\`, \`strategyBuilder\`, \`riskControls\`, \`executionQueue\`) | All skeleton |`;

const newPhaseMapping = `## Phase Mapping (from \`skeleton-rollout.js\`)

### SEES-First Expansion (13 of 15 slots filled; slots 9/10 vacant)

| Phase | # | View ID | Status | Real Page? |
|---|---|---|---|---|
| Phase 0 | 1/15 | \`api-endpoints\` | foundation | Missing |
| Phase 0 | 2/15 | \`api-activity\` | foundation | Missing |
| Phase 0 | 3/15 | \`data-elements\` | foundation | Missing |
| Phase 0 | 4/15 | \`active-symbols\` | foundation | Missing |
| Phase 1 | 5/15 | \`configure-directives\` | decision | Missing |
| Phase 1 | 6/15 | \`algorithm-lab\` | decision | Missing |
| Phase 1 | 7/15 | \`create-scoring-strategies\` | decision | Missing |
| Phase 2 | 8/15 | \`trading-strategies\` | execution | Missing |
| Phase 2 | 9/15 | _vacant_ | — | — |
| Phase 2 | 10/15 | _vacant_ | — | — |
| Phase 2 | 11/15 | \`manual-trading\` | execution | Missing |
| Phase 3 | 12/15 | \`trade-history\` | controls | Missing |
| Phase 3 | 13/15 | \`platform-comparisons\` | controls | \`PlatformComparisonsPage\` |
| Phase 4 | 14/15 | \`focus-priority\` | intelligence | Missing |
| Phase 4 | 15/15 | \`performance-lab\` | validation | Missing |

### Original Plugin Tabs (6-item Roadmap — All Implemented)

| Phase | # | View ID | Status | Real Page? |
|---|---|---|---|---|
| Phase 1 | 1/6 | \`events-calendar\` | foundation | \`EventsCalendarPage\` |
| Phase 1 | 2/6 | \`news-intel\` | foundation | \`NewsIntelPage\` |
| Phase 2 | 3/6 | \`signals-workbench\` | decision | \`SignalsWorkbenchPage\` |
| Phase 2 | 4/6 | \`strategy-builder\` | decision | \`StrategyBuilderPage\` |
| Phase 3 | 5/6 | \`risk-controls\` | controls | \`RiskControlsPage\` |
| Phase 3 | 6/6 | \`execution-queue\` | controls | \`ExecutionQueuePage\` |

**All 6 original plugin tabs now have dedicated pages (built 2026-06-09/10).**`;

content = content.replace(oldPhaseMapping, newPhaseMapping);

// Fix stale P12 rank references in Known Gaps
content = content.replace(
  '| No `configure-directives` page | Operators can\'t adjust directive weights without direct DB access | Rank 2 in P12 skeleton picks |',
  '| No `configure-directives` page | Operators can\'t tune directive weights without DB access | P12 #1 pick — build config editor (1-2 sessions) |'
);
content = content.replace(
  '| No `scoring-overview` page | No system-level scoring health dashboard | Rank 3 in P12 picks |',
  '| No `scoring-overview` page | No system-level scoring health dashboard | Post-directives follow-on |'
);
content = content.replace(
  '| No `directives-status` page | No visibility into which directives are implemented | Rank 4 in P12 picks |',
  '| No `directives-status` page | No visibility into directive implementation status | Post-Task 4 follow-on |'
);
content = content.replace(
  '| No `provider-health` page | Can\'t see adapter status without curl | Rank 5 in P12 picks |',
  '| No `provider-health` page | Can\'t see adapter status in UI | Post-Task 3 follow-on |'
);
content = content.replace(
  '| No `api-endpoints` page | P04 catalog (72 endpoints) has no UI | Rank 1 in P12 picks |',
  '| No `api-endpoints` page | P04 catalog (72 endpoints, 0 broken refs) invisible to operators | P12 #5 pick — catalog viewer (1 session) |'
);
content = content.replace(
  '| No `active-symbols` page | Can\'t manage symbol watchlist in UI | Needs CRUD endpoint |',
  '| No `active-symbols` page | Can\'t toggle which symbols enter scoring pipeline | P12 #2 pick — build toggle UI (1 session); symbol CRUD already live |'
);
content = content.replace(
  '| No `trade-history` page | No audit trail of trades | Blocked by real broker adapter |',
  '| No `trade-history` page | No audit trail for executed decisions | P12 #4 pick — read-only table (1 session) |'
);

// Add structural gaps to Known Gaps
const oldDeferredHeader = '### Deferred (post-MVP)';
const structuralGaps = `### Structural

| Gap | Detail |
|---|---|
| Rollout slots 9/15 and 10/15 vacant | \`sees-ready\` and \`sees-pro\` removed from current rollout; need decision |
| 73 unmapped nav-tree views | No rollout entries exist; need P10-style prioritization pass |
| 2 orphan pages | \`setup-wizard\` and \`system-status\` exist as JSX but not in nav-tree |
| \`directives-manager\` vs \`configure-directives\` overlap | Two views in scoring area with overlapping scope; consolidate or differentiate |
| \`symbols-browser\` vs \`active-symbols\` overlap | Active toggle should be added to existing page rather than building new |

### Deferred (post-MVP)`;

content = content.replace(oldDeferredHeader, structuralGaps);

fs.writeFileSync(path, content);
console.log('P15 sync complete.');
console.log('Real pages listed:', (content.match(/✅ Real/g) || []).length);
console.log('Skeleton badges:', (content.match(/🟡 Skeleton/g) || []).length);
console.log('17 real pages reference:', content.includes('### Real Pages (17)'));
