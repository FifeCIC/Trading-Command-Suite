/**
 * Navigation Tree — Single source of truth for the shell layout.
 *
 * Areas map to footer/quick-menu primary items.
 * Each area's `views` array drives the left sidebar.
 *
 * Current areas (15):
 *   - dashboard  → Dashboard (modular hub)
 *   - accounts   → Accounts (portfolio, stocks ISA)
 *   - watchlists → Watchlists (active symbols, user lists)
 *   - research   → Research (symbols, macro, news, events)
 *   - protocols  → Protocols (registry, assignments, ladders)
 *   - scoring    → Scoring (directives, SEES diagnostics)
 *   - signals    → Signals (overview, workbench, envelopes)
 *   - trading    → Trading (SEES tabs, strategies, portfolio, MT5)
 *   - automation → Automation (execution queue, rules, alerts)
 *   - education  → Education (glossary, patterns, demo trading)
 *   - status     → Status (system health, platform, architecture maps)
 *   - lab        → Lab (THE THEORY & DATA PLAYGROUND — replay, snapshots, charts, theory tests)
 *   - planner    → Planner (finances, trading styles, objectives)
 *   - settings   → Settings (general, database, theme packs, preferences)
 *   - development → Development (engineering tooling + prototypes — absorbed the engineering half of Lab 2026-09-23)
 *
 * ⚠️ NO IMPORTS, ON PURPOSE — this file defines the app's entire page map, and it used to be
 * copied into a filtered "free edition" bundle that must not contain that map. The free edition was
 * cancelled 2026-10-28 (SETTLED-DECISIONS row 96) so there is one build now, but the rule is kept:
 * an import here would drag unrelated modules into every consumer of the map.
 *
 * Deleted 2026-09-23: `getFilteredNavStructure(level)` and the `experience-levels` import it existed
 * for. Nothing imported the function, so `experience-levels.js` (a map of every view id) was already
 * tree-shaken out of the bundle — but the import meant the next caller would pull the whole map in.
 * Removing the dead function removed the import with it.
 */

export const NAV_TREE = {
  /**
   * Dashboard — MODULAR HUB (future)
   * ==================================
   * The Dashboard area is designed to become the primary modular view.
   * Future iterations will support user-configurable widget grids, drag-and-drop
   * layout persistence, and role-based card visibility.
   *
   * Currently renders the existing DashboardPage content inside the shared AppShell
   * layout (sidebar + breadcrumbs + topbar), replacing the previous standalone
   * /dashboard route that used a disconnected header.
   */
  dashboard: {
    label: 'Dashboard',
    views: [
      { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
    ],
  },
  // ── Accounts (was Trading212) ──
  trading212: {
    label: 'Accounts',
    views: [
      { id: 't212-portfolio', label: 'Portfolio', icon: '🏦' },
      // ⚠️ HIDDEN 2026-10-02 (owner: hide now) — "We need a system of displaying each registered
      // account on its own page", so the ISA page waits for that rework instead of being deleted.
      // ⚠️ `order-testing` MOVED to the Status area (see the Status block).
    ],
  },
  watchlists: {
    label: 'Watchlists',
    views: [
      { id: 'active-symbols', label: 'Active Symbols', icon: '★' },
      { id: 'user-watchlists', label: 'Watchlists', icon: '⊞' },
    ],
  },
  // ── Research area (/research/ prefix) ──
  // Restored 2026-08-16: area was removed from the nav (pages remained registered
  // in view-routes.jsx). Individual symbol view: /research/symbol/:ticker.
  research: {
    label: 'Research',
    views: [
      { id: 'symbols-browser', label: 'Symbols Browser', icon: '🔍' },
      { id: 'screener', label: 'Screener', icon: '🧲' },
      { id: 'research-notes', label: 'Notes', icon: '📝' },
      { id: 'earnings-calendar', label: 'Earnings Calendar', icon: '📅' },
      { id: 'earnings-whispers', label: 'Earnings Whispers', icon: '🤫' },
      { id: 'news-intel', label: 'News Intel', icon: '📰' },
      // ⚠️ HIDDEN 2026-10-02 (owner: hide now) — "not a useful page at the moment and should be
      // hidden pending development". Unhiding is one line.
      { id: 'stock-investigation', label: 'Stock Investigation', icon: '🕵️' },
      { id: 'market-correlations', label: 'Market Correlations', icon: '🔗' },
      { id: 'recently-analysed-symbols', label: 'Recently Analysed', icon: '🕘' },
      // MOVED from Development 2026-10-02 (owner: "Move this to the Research area"). A daily
      // market/portfolio briefing is research output, not engineering tooling.
      // ⚠️ The other half of that instruction — "improve styling on <div.db-event>" — is NOT done.
      { id: 'daily-briefing', label: 'Daily Briefing', icon: '📋' },
      // ⚠️ HIDDEN 2026-10-02 (owner: hide now). One of THREE pages to be merged into a single
      // notes-first page (with Stock Investigation and Notes); the merge needs a prototype first, so
      // this is hidden rather than deleted meanwhile. Unhiding is one line.
    ],
  },
  // ── Protocols area (/protocols/ prefix) ──
  // Fully migrated from legacy /scoring/ area (2026-08-06).
  // API endpoints under /api/scoring/ are NOT affected — only frontend routes.
  protocols: {
    label: 'Protocols',
    views: [
      { id: 'protocols-registry', label: 'Protocols Registry', icon: '📋' },
      { id: 'directives-registry', label: 'Directives Registry', icon: '◆' },
      { id: 'protocols-ladder', label: 'Protocols Ladder', icon: '🪜' },
      { kind: 'section-header', id: 'tools-header', label: 'Tools', icon: '' },
      { id: 'sees-arena', label: 'Protocol Comparison', icon: '⚖️' },
      { id: 'protocol-builder', label: 'Protocol Builder', icon: '🧩' },
      { id: 'protocol-trail', label: 'Protocol Trail', icon: '🔗' },
      { id: 'directive-viewer', label: 'Directive Viewer', icon: '🔍' },
      { id: 'dual-protocol-inspector', label: 'Dual-Protocol Inspector', icon: '🔬' },
      // MOVED from /automation/execution-queue 2026-10-02 (owner: "put the Protocol Queue somewhere
      // in the Protocol area"). ⚠️ This is the ONLY surface that can CANCEL a queued protocol run.
      { id: 'protocol-queue', label: 'Protocol Queue', icon: '🏗' },
    ],
  },
  // ── Scoring area (/scoring/ prefix) ──
  // Monitoring SEES: every ladder, all scores (incl. poor ones). Renamed from
  // /scoringStrategies/ (2026-08-19). Symbols Ladder + Singles Monitor moved here
  // from the Protocols area. API endpoints under /api/scoring/ are unaffected.
  scoring: {
    label: 'Scoring',
    views: [
      { id: 'live-ordering-stack', label: 'Ladder', icon: '◉' },
      { id: 'ab-ladder', label: 'A/B Ladder', icon: '⚖️' },
      { id: 'symbols-ladder', label: 'Symbols Ladder', icon: '📈' },
      { id: 'singles-monitor', label: 'Single Symbol', icon: '🖥' },
      { id: 'scoring-activity-logs', label: 'Scoring Activity Logs', icon: '▤' },
    ],
  },
  // ── Signals area (/signals/ prefix) ──
  // Best-of opportunities with trade actions + bot-action indicators (new 2026-08-19).
  signals: {
    label: 'Signals',
    views: [
      { id: 'signals-overview', label: 'Signals', icon: '🚩' },
    ],
  },
  trading: {
    label: 'Trading',
    views: [
      { id: 'strategy-monitor', label: 'Bot Monitor', icon: '📊' },
      // MOVED from the Automation area 2026-10-02 (owner, Page Walkthrough: "Also move this page to
      // the Trading area"). It scans for fast, score-driven entries, so it belongs with the thing it
      // trades rather than with the machinery that ran it. Its route became /trading/speed-scanner.
      { id: 'speed-scanner', label: 'Speed Scanner', icon: '⚡' },
      // ── BOTS ──
      // `Trading Bots` = a BOT, per `docs/trading-bot-model.md` §1: the EXECUTION POLICY (a
      // `TradingStrategy` row) - money management, risk, entry/exit rules, position building. The
      // Strategy Monitor above is the WHOLE PIPELINE (protocol + bot), which is a different thing.
      // §5 (user-confirmed) is explicit that the display label is "Trading Bots".
      { id: 'trading-bots', label: 'Trading Bots', icon: '🤖' },
      // Renamed from `strategy-create` 2026-09-18: it creates a BOT row, so "Create Strategy"
      // named the wrong layer. The alias `create-strategy` was removed - it mapped to this same
      // component and nothing navigated to it except three stale QA procedure strings.
      { id: 'bot-create', label: 'Create Bot', icon: '⊞' },
      // ── STRATEGIES (derived) ──
      // The owner's definition (updated 2026-09-19, docs/trading-bot-model.md §1c): a strategy is
      // a bot's WHOLE configuration (protocol + role + market + broker + execution policy). A
      // different market is a different strategy, so it is one strategy per bot — 27 cards from
      // 27 bots, never 18. (#876 removed the old "26 bots -> 18 strategies" merge across markets.)
      // Placed directly under Trading Bots so the pair reads as "the execution policy" vs
      // "the combinations". Names/ids for these live in the #875 registry, not in this tree.
      { id: 'strategies-derived', label: 'Strategies', icon: '🧩' },
      // A/B view for the same strategies (owner, 2026-09-22): two configurations side by side
      // with every differing value marked. The pair is data (?pair=keyA,keyB), not a control —
      // the same decision the A/B Ladder records.
      { id: 'ab-strategies', label: 'A/B Strategies', icon: '🆚' },
      { id: 'positions-monitor', label: 'Positions Monitor', icon: '◈' },
      // MOVED here from Development/Prototypes 2026-09-24 (owner direction). This is the manual
      // trading surface and it is FREE — it was sitting in a premium-only area because it started
      // life as a prototype, and one free leaf kept the whole Development area alive in the free
      // build's nav. §9.2 called it "promoted to a first-class area"; this is that move. The
      // education-facing copy stays at /education/mt5-demo-trading.
      { id: 'mt5-trading', label: 'Manual Trading', icon: '📈' },
      { id: 'strategy-comparison', label: 'Bot Comparison', icon: '⚖' },
      { id: 'trading-plans', label: 'Trading Plans', icon: '📋' },
      { id: 'exit-signals', label: 'Exit Signals', icon: '🚪' },
      // #988 (owner request 2026-09-24) — the statistics page for the ONLY post-entry stop
      // mechanism. Sits beside Exit Signals because both answer "what happens after entry";
      // `exit-signals` is the signal-side view, this is the guardian that actually moves stops.
      { id: 'stop-guardian', label: 'Stop Guardian', icon: '🛡' },
      // Moved out of the legacy block 2026-09-21: the journal reads the DB audit trail
      // (/api/trading/trade-history) and is now the surface that names WHO closed a trade
      // (#916 close attribution) — a first-class view, not a legacy page.
      { id: 'trade-journal', label: 'Trade Journal', icon: '▤' },
      { kind: 'section-header', id: 'legacy-strategies', label: '— Legacy Strategy Pages —', icon: '' },
      { id: 'market-context', label: 'Market Context', icon: '🌐' },
      { id: 'strategy-library', label: 'Strategy Library', icon: '📚' },
      { id: 'performance-lab', label: 'Trading Performance', icon: '📊' },
      { id: 'calculators', label: 'Calculators', icon: '⊞' },
      { id: 'trading-settings', label: 'Settings', icon: '⚙' },
    ],
  },
  // ⚠️ THE AUTOMATION AREA WAS REMOVED 2026-10-02 (owner, Page Walkthrough) — this is the end of
  // that programme. The owner's rule for it: *"Going forward anything that was automation or
  // scheduled will be within the area of what it is scheduling i.e. scheduling a trade, belongs in
  // the Trading area."* Its five views went as follows:
  //   automation-dashboard  → loop controls on /dashboard; panels had existing homes (Portfolio
  //                           page, Blocked Signals, Events Calendar, the journal); Broker Config →
  //                           Settings; tick phase → the loop strip
  //   speed-scanner         → Trading (below) — a scanner is what it scans
  //   execution-queue       → Protocol Queue to Protocols, Scheduled Jobs to Status, Live Events to
  //                           the Trade Journal
  //   automation-rules      → Settings ("/settings/automation", section #rules)
  //   alert-center          → the Trade Journal (Alerts)
  // "Automation" named a MECHANISM, not a subject — which is why nothing is left for it to own.
  education: {
    label: 'Education',
    views: [
      { id: 'glossary', label: 'Glossary', icon: '📖' },
      // ⚠️ HIDDEN 2026-10-02 (owner, Page Walkthrough — hide now). Both are wanted (importance H,
      // keenness 3) and both are "not good enough yet": Pattern Detection "does not show the patterns
      // on the chart", the guide's depictions "are not good enough". Hidden from the nav, NOT deleted
      // — unhiding is one line.
      // ⚠️ Hiding does NOT remove them from the free edition: the free build reads view-meta tiers,
      // not the nav. Tier hardening for these two is deliberately a separate change.
      // ⚠️ `backtest` MOVED to the Lab area (2026-09-23, owner direction). Backtesting is a
      // theory-and-data page — "what would have happened?" — which is what Lab is for, and the
      // owner's own instruction named backtesting as a Lab page. It sat in Education, where it
      // never fitted: Education teaches a person, Lab tests a hypothesis.
      { id: 'settings-education', label: 'Education Settings', icon: '⚙' },
    ],
  },
  status: {
    label: 'Status',
    views: [
      // ── System Health ──
      { id: 'setup', label: 'Setup & Diagnostics', icon: '◉' },
      { id: 'health-check', label: 'Health & Diagnostics', icon: '🩺' },
      { id: 'system-log', label: 'System Log', icon: '📋' },
      // MOVED from the Accounts area 2026-10-02 (owner: "Move this page to the Status area with the
      // intention of offering all users the ability to test orders"). It is a diagnostic harness that
      // never belonged under Accounts.
      { id: 'order-testing', label: 'Order Testing', icon: '🧪' },
      // ── Platform ──
      { id: 'platform-comparisons', label: 'API Comparisons', icon: '▤' },
      // ── System Maps ──
      { id: 'meta-stack-explorer', label: 'META.Stack Explorer', icon: '🔍' },
      // META.Stack Pipeline WAS a nav entry here and was REMOVED (2026-10-08): the view is now a
      // section of Pipeline Graph Lab, so the entry pointed at a route that no longer exists.
      { id: 'meta-stack-status', label: 'META.Stack Status', icon: '🎯' },
      // ⚠️ `file-inventory` MOVED to Development 2026-10-02. ⚠️ `architecture-framework` was NOT moved
      // even though the owner asked for it: /builder/architecture-framework is declared as the route in
      // an API manifest (architecture-manifest.controller.ts), in two instruction files and in the
      // update-architecture-framework skill. Moving it breaks a documented contract — that needs a
      // decision, not a rename.
      { id: 'capability-map', label: 'Capability Map', icon: '🗺️' },
      // MOVED from /automation/execution-queue 2026-10-02 (owner: "Schedule Jobs in the Status
      // area"). The `scheduled_job` table is machinery health — what is due, what failed.
      { id: 'scheduled-jobs', label: 'Scheduled Jobs', icon: '🗓' },
      { id: 'broker-catalogue', label: 'Broker Catalogue', icon: '🌐' },
    ],
  },
  // ── Lab — the theory & data playground ──
  //
  // ⚠️ THE SPLIT RULE — owner direction, 2026-09-23:
  //   "Move every page from Lab to Development area apart from backtesting or snapshot or replay
  //    related pages. The Lab area will be where we test theories, and data, and turn it all into
  //    a bit of a hobby."
  //
  // Applied as the owner's INTENT rather than the three literal words, because the two halves of
  // that instruction disagree if read narrowly. The sentence that DEFINES the area is the second
  // one — Lab tests theories and data. `Speed Trading` and `Gold Speed` are exactly that, and
  // Development is engineering tooling, so moving them there would have contradicted the
  // definition. The rule actually used:
  //
  //   A page belongs in LAB         if it answers "what does the market do, and what would have
  //                                 happened?"  → replay, snapshots, charts, theory tests
  //   A page belongs in DEVELOPMENT if it answers "does this part of the app work?" → UI/theme/
  //                                 component/widget labs, META.Stack internals, feature prototypes
  //
  // The borderline pages kept in Lab (rather than moved and moved back): Charts Lab, Speed
  // Trading, Gold Speed, A/B Protocol Testing, Strategy Allocator, Portfolio Lab, Timeline,
  // Position Lifecycle. Each is a theory-or-data page, not tooling. Flipping any one of them is a
  // single line — see `.github/REVIEW-QUEUE.md`.
  //
  // ⚠️ THE AREA KEY IS THE URL PREFIX (`/:area/:view` in App.jsx). Moving a view BETWEEN areas
  // changes its URL — `/lab/theme-lab` became `/development/theme-lab`. The prefix is not derived
  // from anything: `view-meta.js` keys paths literally, so a moved nav entry WITHOUT a matching
  // view-meta edit leaves the coverage sweep in `scripts/verify-view-meta-routes.cjs` red. The two
  // files move together, always.
  lab: {
    label: 'Lab',
    views: [
      // ── Backtesting & replay — "what would have happened?" ──
      { id: 'backtest', label: 'Backtesting Protocols', icon: '⬡' },
      // ⚠️ ADDED 2026-10-26 (owner direction) — the strategies subject was a toggle on the page
      // above; it is now its own route so the two questions can be described and linked separately.
      { id: 'backtest-strategies', label: 'Backtest Strategies', icon: '⬢' },
      // ⚠️ `protocol-backtest` RETIRED 2026-10-22 (#1134, owner direction). It was a sibling view
      // from 2026-10-16 because scores and trades are different questions — that is still true, so
      // the question is now the page's SUBJECT TOGGLE (Protocols | Strategies) rather than a second
      // route. The reason is measured: `/api/replay/run` stored nothing, so a protocol backtest
      // could never be compared, while `/api/backtest/run` — the engine behind this one route —
      // stores every run and compares two of them. One route, one history, both questions.
      // #823 Stage 1 — `backtest-data` was mapped in `view-routes.jsx` but had NO nav entry, so it
      // was reachable only by typing the URL. Stage 1's own criterion: "a page nobody can find is
      // effectively absent". Surfaced rather than rebuilt.
      { id: 'backtest-data', label: 'Backtest Data', icon: '⛁' },
  // ⚠️ ADDED 2026-10-31 (owner direction). "Completed runs" was a TAB on
  // `/lab/backtest-strategies`, a page that had reached eleven steps plus four reference tabs and was
  // being described by the owner as *"very complex especially with the [Completed runs] added"*.
  // Stored runs are their own job — review what the engine kept, select 2–4, find what changed — so
  // they get their own page rather than a fifth tab on a measurement form.
  { id: 'backtest-runs', label: 'Completed Runs', icon: '⧉' },
      { id: 'snapshots', label: 'Snapshots', icon: '🔬' },
      { id: 'snapshot-replay', label: 'Snapshot Replay', icon: '⏮' },
      // ── Charts & data inspection ──
      { id: 'charts-lab', label: 'Charts Lab', icon: '📊' },
      { id: 'position-lifecycle', label: 'Position Lifecycle', icon: '🛡️' },
    ],
  },
  planner: {
    label: 'Planner',
    views: [
      { id: 'personal-finances', label: 'Personal Finances', icon: '💰' },
      { id: 'trading-styles', label: 'Trading Styles', icon: '🎨' },
      { id: 'objectives', label: 'Objectives', icon: '🎯' },
    ],
  },
  // ── Settings area (/settings/ prefix) ──
  //
  // ⚠️ ORDERING IS THE DESIGN, NOT ALPHABETICAL (2026-09-16, #617).
  // The list is grouped by the QUESTION each page answers, because the previous flat list gave
  // the user no reason to expect any setting on any page — "General" had accumulated 13
  // sections from theme to trade thresholds precisely because there was no rule about what
  // belonged where. The rule now is the META.Stack layers:
  //
  //   directives → protocols → scoring → bots
  //
  // A page that configures a layer comes first and sits with the other layers. "General" is
  // the LAST resort — everything a user can change that is NOT part of a layer (API, database,
  // security) — and it appears under Application, below the layers, rather than at the top
  // pretending to be the front door.
  //
  // Decisions behind the grouping (#617): Automation owns the loop + queue + layer inclusion
  // switches; each layer's switch is DUPLICATED onto its own page on purpose, so the link
  // between the loop and the layer is visible from either end.
  settings: {
    label: 'Settings',
    views: [
      // ── META.Stack layers ──
      { kind: 'section-header', id: 'settings-layers', label: 'META.Stack Layers', icon: '' },
      { id: 'trading-settings', label: 'Trading', icon: '💹' },
      { id: 'scoring-settings', label: 'Scoring', icon: '📊' },
      { id: 'automation', label: 'Automation', icon: '⚡' },
      { id: 'risk-controls', label: 'Risk Controls', icon: '◈' },
      // ── Application ──
      { kind: 'section-header', id: 'settings-app', label: 'Application', icon: '' },
      { id: 'settings', label: 'General', icon: '⚙' },
      { id: 'monitoring', label: 'Monitoring', icon: '🛰' },
      // ⚠️ `appearance` MOVED to the Appearance area 2026-10-13 (owner request) — the whole visual
      // surface now lives in one place instead of being split across two menus. Its old route
      // `/settings/appearance` redirects, so links keep working.
      //
      // ⚠️ `screen-assignment` also MOVED to the Appearance area on the same day. It was moved here
      // from Development on 2026-10-02 for a good reason — assigning a board to a monitor is a
      // per-machine preference, not engineering tooling. It has now moved again for a different good
      // reason: it is a VISUAL option, and the owner is assembling the visual options in one area.
      // Two moves is not indecision; the area it belongs to was only created today.
      // ── Reference — the full lists, not the everyday surfaces ──
      { kind: 'section-header', id: 'settings-reference', label: 'Reference', icon: '' },
      { id: 'user-preferences', label: 'User Preferences', icon: '⚙' },
      // ⚠️ `theme-packs` RETIRED 2026-10-13 (owner request). It duplicated pack selection that also
      // existed in the shell rail and now lives in the Appearance area's chooser — three surfaces for
      // one setting. Its route redirects to the chooser rather than 404-ing.
      { id: 'settings-database', label: 'Database', icon: '⊞' },
      { id: 'settings-education', label: 'Education', icon: '◉' },
    ],
  },
  // ── Appearance area (/appearance/ prefix) — NEW 2026-10-13 (owner request) ──
  // Purpose, in the owner's words: *"I'm using this project to establish a theme package that can be
  // carried forward to other projects... a gallery of visual options for users to fine-tune their UI."*
  // It holds layout GUIDANCE (so an agent building a page can choose a structure that suits it) and
  // the colour schemes, which are deliberately separate concerns — see the note in App.jsx about the
  // deleted `ai-original` pack, which changed structure and colour together.
  //
  // ⚠️ Sits immediately before `development` because the owner asked for it "beside Development".
  // ⚠️ PLACEMENT MATTERS HERE, AND I GOT IT WRONG ONCE: the first version of this block was inserted
  // directly above `development: {`, which put it BETWEEN Development's comments and its declaration —
  // so Development's explanatory notes appeared to describe Appearance. A comment block and the entry
  // it explains must stay adjacent.
  //
  // ⚠️ SAMPLE VIEWS MUST USE THIS APP'S OWN REAL DATA. Owner, 2026-10-13: *"I sometimes mention using
  // dummy/demo data. I don't want that applied actually. Only use this apps own real data to create
  // examples but when we update React Stack Core (my boilerplate) we will convert them to a variety of
  // topics with demo data."* So a gallery example renders a REAL view of this app — never a fixture.
  // Invented content here would be indistinguishable from a working feature, which is the defect this
  // repo has already paid for more than once.
  //
  // Views moved here from Settings and Development (owner request, same day): Appearance, Screen
  // Assignment and Responsive Layout Lab. Their old routes redirect, so links and bookmarks survive.
  appearance: {
    label: 'Appearance',
    views: [
      { id: 'layout-guide', label: 'Layout Guide', icon: '🎨' },
      // The register of patterns the OWNER approved, read from the Page Walkthrough. It sits beside
      // Layout Guide because they answer the same question at different depths: Layout Guide is a
      // handful of decisions, this is the full evidence-backed list of what to build a sample from.
      { id: 'patterns', label: 'Pattern Library', icon: '🧩' },
      // The one reference for how a SENTENCE is displayed (2026-10-30). It sits beside Pattern Library
      // because both are libraries, but the split matters: Pattern Library is what to BUILD from, this is
      // the component every annotating sentence must use.
      { id: 'info', label: 'Information', icon: '💬' },
      // Element groups — 2026-10-13. These were the sections of View: Theme Lab, which is retired:
      // a reader looking for "what colour for a panel" wants a Colour page, not a 300-line sandbox
      // mixing colour, cards, motion and tables. Each group is a page of its own.
      { id: 'colour', label: 'Colour', icon: '🖌️' },
      { id: 'surfaces', label: 'Surfaces & Cards', icon: '🃏' },
      { id: 'data-display', label: 'Data Display', icon: '📊' },
      { id: 'interactive', label: 'Interactive', icon: '🖱️' },
      { id: 'appearance', label: 'Appearance', icon: '🌈' },
      { id: 'motion', label: 'Motion', icon: '🎬' },
      { id: 'forms', label: 'Forms', icon: '📝' },
      { id: 'screen-assignment', label: 'Screen Assignment', icon: '🖥️' },
      { id: 'responsive-layout-lab', label: 'Responsive Layout Lab', icon: '📐' },
    ],
  },
  // ── Development — engineering tooling and experimental prototypes ──
  //
  // ⚠️ THIS AREA ABSORBED THE ENGINEERING HALF OF LAB (owner direction 2026-09-23).
  // The split rule is stated in full in the `lab` block above. Short form: everything here
  // answers "does this part of the app work?" rather than "what does the market do?".
  //
  // Grouped by section header because 23 flat entries gave no clue where anything was — the same
  // reason the Settings list was regrouped under #617.
  development: {
    label: 'Development',
    views: [
      // ── Project ──
      { id: 'roadmap', label: 'Roadmap', icon: '🗺' },
      { id: 'qa-testing', label: 'QA Checklist', icon: '🧪' },
      // MOVED from the Status area 2026-10-02 (owner: "Move to the Development area"). Both are
      // engineering reference — what the CLI can do, and what files exist — so they belong with the
      // tooling rather than with system health.
      { id: 'commands', label: 'Commands Reference', icon: '💻' },
      { id: 'file-inventory', label: 'File Inventory', icon: '📁' },
      // ── Decisions — the sandbox's OUTPUT (owner direction 2026-09-24) ──
      // The Development area is where an agent may build a competing approach, measure it, and produce
      // a decision. An experiment that does not end in a decision is a prototype, not an experiment —
      // so the registry sits here, near the top, rather than at the bottom of a list of tools.
      // Entries are enforced by scripts/validate-theories.cjs (a theory needs a falsification test).
      { kind: 'section-header', id: 'dev-decisions', label: 'Decisions', icon: '⚖' },
      { id: 'theory-registry', label: 'Theory Registry', icon: '🔬' },
      // R21 / #990 — the owner chose a NEW REGISTER over a second section in the review queue, so
      // observations can accumulate BEFORE they become decisions. Sits beside the theory registry
      // because they are the same shape: a held position, written down so it can be judged.
      { id: 'design-observations', label: 'Design Observations', icon: '👁' },
      // ── Engineering tools — build and inspect the UI itself ──
      { kind: 'section-header', id: 'dev-engineering', label: 'Engineering Tools', icon: '🛠' },
      { id: 'feature-lab', label: 'Feature Lab', icon: '🔬' },
      { id: 'ui-review', label: 'Page Walkthrough', icon: '📋' },
      // ⚠️ `responsive-layout-lab` MOVED to the Appearance area 2026-10-13 (owner request). It is a
      // viewport/visual tool rather than an engineering debug surface, and the new area is where the
      // owner is collecting visual options. Its old route redirects.
      { id: 'identity-map', label: 'Identity Map', icon: '🧭' },
      { id: 'diagrams', label: 'Diagrams', icon: '▦' },
      // #974 — "why didn't it trade?", answered from the database. Built in Development because it
      // is an EXPERIMENT first: does seeing the exit reasons help, or is it noise? Register row 36
      // constrains how it may be framed (a thin funnel is not a fault), not whether it exists.
      { id: 'blocked-signals', label: 'Blocked Signals', icon: '🚦' },
      // 2026-09-28 — the CHANGE view. Every trading page rendered a snapshot; only PerformanceLab
      // had a time axis. This is Development because it is an EXPERIMENT first: does seeing the
      // period-over-period delta help you judge a system, or is it noise? Read-only by design —
      // it calls two endpoints that only query the database.
      { id: 'performance-change', label: 'Performance Change', icon: '📈' },
      // ── Theme engineering ──
      // ⚠️ View: Theme Lab was RETIRED 2026-10-13 (owner request) and nothing replaces it here. Its
      // examples were one long page mixing colour, cards, motion and tables, reachable from Development
      // because that is where sandboxes live. They are now element groups in the APPEARANCE area, which
      // is where someone choosing a colour would look. The route redirects to /appearance/layout-guide,
      // so `/development/theme-lab` still resolves — a retired route with no redirect is a blank view
      // that reads as a broken build rather than as a move.
      // ── META.Stack internals ──
      { kind: 'section-header', id: 'dev-metastack', label: 'META.Stack Internals', icon: '🔗' },
      { id: 'meta-stack-cockpit', label: 'META.Stack Cockpit', icon: '🧭' },
      { id: 'pipeline-graph-lab', label: 'Pipeline Graph', icon: '🗺️' },
      // ── Prototypes — product features that are not yet real ──
      { kind: 'section-header', id: 'dev-prototypes', label: 'Prototypes', icon: '🧪' },
      { id: 'strategy-wizard', label: 'Strategy Wizard', icon: '🧙' },
      { id: 'architecture-framework', label: 'Architecture', icon: '⬡' },
    ],
  },
};

export const PRIMARY_PAGES = Object.entries(NAV_TREE).map(([id, area]) => ({
  id,
  label: area.label,
}));

/**
 * Quick Menu shortcuts — high-priority jump targets shown in the header dropdown.
 * Each entry must reference a view id that exists somewhere in NAV_TREE.
 */
export const QUICK_MENU = PRIMARY_PAGES;

/**
 * Derive the legacy flat NAV_STRUCTURE shape for backward compat with App.jsx.
 * Returns { [areaKey]: [{ id, label }] }
 */
export function getNavStructure() {
  const structure = {};
  for (const [key, area] of Object.entries(NAV_TREE)) {
    structure[key] = area.views;
  }
  return structure;
}

/**
 * Resolve which area owns a given view id.
 */
export function resolveArea(viewId) {
  for (const [key, area] of Object.entries(NAV_TREE)) {
    if (area.views.some((v) => v.id === viewId)) {
      return key;
    }
  }
  return null;
}
