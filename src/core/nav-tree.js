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
      // ── ADDED 2026-11-06 (requirement) ──
      // "Brokers" = the venues and the ACCOUNTS on them (money, connection, live/demo).
      // "Vendors" = every source of DATA, and that includes the brokers: "the aim will be to list
      // sources of data basically". They live in Accounts because both are about what the app is
      // connected to, not about a trading decision.
      // ⚠️ `brokers` is NOT a replacement for `/status/broker-catalogue`: that page answers "what can
      // a broker TRADE" (symbol classes and coverage), this one answers "what accounts do I hold".
      { id: 'brokers', label: 'Brokers', icon: '🏛' },
      { id: 'vendors', label: 'Vendors', icon: '🔌' },
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
      // #1297 — the movers question BOUNDED BY OUR OWN UNIVERSE. Requirement (2026-11-18): [Our registered
      // symbols] can be moved to a new page in the Watchlists area … as they're two totally different
      // concepts. It belongs here because a symbol is "ours" by virtue of
      // `symbol_protocol_assignment`, which is a Watchlists concern; the unbounded, market-wide
      // question stayed in Development.
      { id: 'registered-movers', label: 'Registered Movers', icon: '🏆' },
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
      // New 2026-11-18 (owner): the "Most active" list gets its own Research page. *"I'm tempted to
      // turn that into a strategy but I'm not sure what the strategy would be: it seems like a
      // potential list of volatile stocks and not really always trending strongly."* So it is
      // RESEARCH, not a strategy — high volume without direction is a candidate list, not a thesis,
      // and putting it in the Strategies area would imply a directional edge this data does not have.
      { id: 'most-active', label: 'Most Active', icon: '🔊' },
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
  // ⚠️ THE BOTS AREA (owner request, 2026-11-19): *"Create a Bots area between Signals and Trading in
  // the menu"*, moving Bot Monitor, Trading Bots, Create Bot and Bot Comparison into it.
  //
  // WHY THIS IS NOT JUST TIDYING. The four views are about ONE OBJECT — a bot: the list of them, the
  // form that creates one, the monitor over the whole pipeline per bot, and the A/B comparison of two
  // configurations. They were scattered through Trading between Speed Scanner, Manual Trading and
  // Trade Journal, which are about operating POSITIONS. The nav now reads as the pipeline:
  // protocols → scoring → signals → BOTS → trading.
  //
  // ⚠️ `strategy-monitor` (labelled "Bot Monitor") belongs here rather than beside the strategies: its
  // API is `/api/trading/strategies/with-ratios` + `/api/automation/status`, i.e. bot state, and the
  // id is historical — the route is `/bots/bot-monitor` now, and `/bots/strategy-monitor`
  // redirects.
  bots: {
    label: 'Bots',
    views: [
      { id: 'trading-bots', label: 'Trading Bots', icon: '🤖' },
      { id: 'bot-create', label: 'Create Bot', icon: '⊞' },
      { id: 'strategy-monitor', label: 'Bot Monitor', icon: '📊' },
      { id: 'strategy-comparison', label: 'Bot Comparison', icon: '⚖' },
    ],
  },
  trading: {
    label: 'Trading',
    views: [
      // MOVED from the Automation area 2026-10-02 (owner, Page Walkthrough: "Also move this page to
      // the Trading area"). It scans for fast, score-driven entries, so it belongs with the thing it
      // trades rather than with the machinery that ran it. Its route became /trading/speed-scanner.
      { id: 'speed-scanner', label: 'Speed Scanner', icon: '⚡' },
      // ── BOTS moved to their own area 2026-11-19 (owner request) ──────────────────────────────
      // `trading-bots`, `bot-create`, `strategy-monitor` and `strategy-comparison` now live under
      // NAV_TREE.bots, which sits between Signals and Trading. Their comments went with them.
      // ── STRATEGIES (derived) ──
      // The project's definition (updated 2026-09-19, docs/trading-bot-model.md §1c): a strategy is
      // a bot's WHOLE configuration (protocol + role + market + broker + execution policy). A
      // different market is a different strategy, so it is one strategy per bot — 27 cards from
      // 27 bots, never 18. (#876 removed the old "26 bots -> 18 strategies" merge across markets.)
      // Placed directly under Trading Bots so the pair reads as "the execution policy" vs
      // "the combinations". Names/ids for these live in the #875 registry, not in this tree.
      { id: 'strategies-derived', label: 'Strategies', icon: '🧩' },
      // A/B view for the same strategies (Requirement (2026-09-22)): two configurations side by side
      // with every differing value marked. The pair is data (?pair=keyA,keyB), not a control —
      // the same decision the A/B Ladder records.
      { id: 'ab-strategies', label: 'A/B Strategies', icon: '🆚' },
      { id: 'positions-monitor', label: 'Positions Monitor', icon: '◈' },
      // MOVED here from Development/Prototypes 2026-09-24 (requirement). This is the manual
      // trading surface and it is FREE — it was sitting in a premium-only area because it started
      // life as a prototype, and one free leaf kept the whole Development area alive in the free
      // build's nav. §9.2 called it "promoted to a first-class area"; this is that move. The
      // education-facing copy stays at /education/mt5-demo-trading.
      { id: 'mt5-trading', label: 'Manual Trading', icon: '📈' },
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
      // ── The "— Legacy Strategy Pages —" section header was REMOVED 2026-11-07 ────────────────
      // Owner, in three separate requests on the same walkthrough: *"Move Market Context out of
      // '— Legacy Strategy Pages —' to the top half of the menu"*, the same for Strategy Library,
      // and then simply *"just remove"* the header on Trading Performance.
      //
      // ⚠️ The header was the thing making the judgement, so removing it removes the claim. These
      // four were never legacy: Market Context is live session data, Strategy Library is the
      // protocol catalogue, and Trading Performance reads `/api/bots/strategy-comparison`. The
      // label dated from when they were superseded in name only — it told a reader to expect dead
      // pages and then showed them working ones.
      { id: 'market-context', label: 'Market Context', icon: '🌐' },
      // Strategy Library MOVED to the Strategies area 2026-11-18 (owner: *"I would like a Strategies
      // area (again)! … This page will be moved to the new area and all strategies will be listed
      // there"*). Its route is now `/strategies/strategy-library`; `/trading/strategy-library`
      // redirects, and the page-visibility baseline records the route RENAME rather than a new page.
      { id: 'performance-lab', label: 'Trading Performance', icon: '📊' },
      { id: 'calculators', label: 'Calculators', icon: '⊞' },
      { id: 'trading-settings', label: 'Settings', icon: '⚙' },
    ],
  },
  // ── STRATEGIES (requirement, 2026-11-18) ────────────────────────────────────────────────
  // *"I would like a Strategies area (again)! The area will list all strategies in a separate
  // category in its left hand menu for quick access… The goal here is that the new Strategy area
  // allows us to see the finished product of the META.Stack pipeline doing its thing. It is in the
  // theory we understand the strategy and see live samples but it is in the additional (optional)
  // view we will have a true live overview of everything the strategy has done recently and is
  // doing right now."*
  //
  // ⚠️ POSITION MOVED 2026-11-19 (owner): *"Move the Strategies menu item so that it is positioned
  // after Trading"*. It was between Signals and Bots, where the order read as the pipeline; the
  // owner reads it the other way round — the operational areas (Bots, Trading) come first and the
  // library of methodologies follows them. Do not "correct" this back to pipeline order.
  // ⚠️ OWN AREA, NOT A SECTION OF TRADING. A strategy is the SUBJECT (a methodology); a bot is the
  // execution policy that runs it, and `Trading` is where bots are operated. Putting the library back
  // inside Trading is what buried it behind the machinery it describes.
  //
  // ⚠️ The two new entries are ONE market-movers signal split by SIDE, not two ideas. A "top
  // winners" list and a "top losers" list need opposite exposures, opposite stop logic and opposite
  // exhaustion behaviour, so they are two strategies — a single "movers" strategy could not state
  // which side it takes.
  strategies: {
    label: 'Strategies',
    views: [
      { id: 'strategy-library', label: 'Strategy Library', icon: '📚' },
      // Custom (live) views — the optional half the requirement described. Withheld from other users by
      // default (`DEFAULT_HIDDEN_ROUTES`) until released; the library card links to them.
      { id: 'day-top-winners', label: "Day's Top Winners", icon: '🏆' },
      { id: 'day-top-losers', label: "Day's Top Losers", icon: '🕳️' },
    ],
  },
  // ⚠️ THE AUTOMATION AREA WAS REMOVED 2026-10-02 (owner, Page Walkthrough) — this is the end of
  // that programme. The project's rule for it: *"Going forward anything that was automation or
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
  /*
   * ⚠️ THE WHOLE AREA IS HIDDEN (requirement, 2026-11-07).
   *
   * Owner, Status walkthrough: *"Hide the Education area - this will be a massive project in
   * itself."* Not one page — the area. Education is deferred wholesale rather than page by page,
   * which is a different statement from every other hide in this file.
   *
   * `hidden: true` is an AREA-LEVEL flag, honoured by `hidden-views.js` in BOTH branches
   * (`filterNavTree` and `tagWithheld`), so the area leaves the top nav and the left rail whichever
   * of those is active. It is deliberately NOT the per-route `DEFAULT_HIDDEN_ROUTES` mechanism:
   * that one hides leaf by leaf and leaves the area sitting in the nav with amber children, which
   * is the opposite of what was asked for.
   *
   * ⚠️ NOTHING IS DELETED. Both routes still resolve by URL and their components, view-meta entries
   * and CSS are untouched — only the nav entry is suppressed. Un-hiding is deleting this one line.
   * ⚠️ Do NOT "tidy up" by deleting `views` while the flag is set: the flag is the reversal
   * switch, and an empty array would make restoring the area a re-typing exercise.
   */
  education: {
    label: 'Education',
    hidden: true,
    views: [
      { id: 'glossary', label: 'Glossary', icon: '📖' },
      // ⚠️ HIDDEN 2026-10-02 (owner, Page Walkthrough — hide now). Both are wanted (importance H,
      // keenness 3) and both are "not good enough yet": Pattern Detection "does not show the patterns
      // on the chart", the guide's depictions "are not good enough". Hidden from the nav, NOT deleted
      // — unhiding is one line.
      // ⚠️ Hiding does NOT remove them from the free edition: the free build reads view-meta tiers,
      // not the nav. Tier hardening for these two is deliberately a separate change.
      // ⚠️ `backtest` MOVED to the Lab area (2026-09-23, requirement). Backtesting is a
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
      // even though the requirement is for it: /builder/architecture-framework is declared as the route in
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
  // ⚠️ THE SPLIT RULE — requirement, 2026-09-23:
  //   "Move every page from Lab to Development area apart from backtesting or snapshot or replay
  //    related pages. The Lab area will be where we test theories, and data, and turn it all into
  //    a bit of a hobby."
  //
  // Applied as the project's INTENT rather than the three literal words, because the two halves of
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
      // ⚠️ ADDED 2026-10-26 (requirement) — the strategies subject was a toggle on the page
      // above; it is now its own route so the two questions can be described and linked separately.
      { id: 'backtest-strategies', label: 'Backtest Strategies', icon: '⬢' },
      // ⚠️ ADDED 2026-11-19 (#1319), renamed the same day — a strategy that CHOOSES its instrument
      // each day. It is not another `subject` on the page above: the result is a candidate list × per
      // day, and the question is "did it pick the right symbols out of that day's movers?", which a
      // single-symbol view cannot show.
      // ⚠️ NAMED FOR THE STRATEGY, NOT THE MECHANISM. It was `backtest-selection` for a few hours and
      // that name described the ranking. The page exists to test the movers strategy's two legs, so it
      // carries the strategy's name — a generic "selection backtest" page would invite every other
      // ranked idea onto the same controls.
      // Hidden from other users by default — the route is in DEFAULT_HIDDEN_ROUTES.
      { id: 'movers-strategy-backtest', label: 'Movers Strategy', icon: '◫' },
      // ⚠️ `movers-cockpit` REMOVED 2026-11-23 (owner request: "Delete this page … Movers Cockpit").
      // Its column spec had already been folded into the backtest page's steps, so the separate
      // route was a second view of the same run with no unique control of its own.
      // ⚠️ ADDED 2026-11-04 (requirement). The A/B reference panels were a second rendering of
      // results on the strategies page — *"it has results displayed twice"* — so they moved here, to a
      // page about ONE strategy: the run you accepted (A), the latest run (B), side by side, and what
      // changed. It is also where the app-wide strategy FOCUS is chosen.
      { id: 'current-strategy', label: 'Current Strategy', icon: '◎' },
      // ⚠️ `protocol-backtest` RETIRED 2026-10-22 (#1134, requirement). It was a sibling view
      // from 2026-10-16 because scores and trades are different questions — that is still true, so
      // the question is now the page's SUBJECT TOGGLE (Protocols | Strategies) rather than a second
      // route. The reason is measured: `/api/replay/run` stored nothing, so a protocol backtest
      // could never be compared, while `/api/backtest/run` — the engine behind this one route —
      // stores every run and compares two of them. One route, one history, both questions.
      // #823 Stage 1 — `backtest-data` was mapped in `view-routes.jsx` but had NO nav entry, so it
      // was reachable only by typing the URL. Stage 1's own criterion: "a page nobody can find is
      // effectively absent". Surfaced rather than rebuilt.
      { id: 'backtest-data', label: 'Backtest Data', icon: '⛁' },
  // ⚠️ ADDED 2026-10-31 (requirement). "Completed runs" was a TAB on
  // `/lab/backtest-strategies`, a page that had reached eleven steps plus four reference tabs and was
  // being described by the requirement as *"very complex especially with the [Completed runs] added"*.
  // Stored runs are their own job — review what the engine kept, select 2–4, find what changed — so
  // they get their own page rather than a fifth tab on a measurement form.
  { id: 'backtest-runs', label: 'Completed Runs', icon: '⧉' },
  // #1295 — the experiment registry. Placed beside Completed Runs because it is the other half of
  // the same question: Completed Runs reviews what the engine kept, this shows which runs belong to
  // a deliberate comparison. Measured before it existed: 1,722 runs, 13 filed (0.75%), 6 of 11
  // experiments empty shells — a comparison existed only if somebody remembered it.
  { id: 'backtest-experiments', label: 'Experiments', icon: '🧪' },
  // #1201 — the survival list. Placed beside Completed Runs because it IS a review of what the
  // engine kept: a walk-forward run records two windows (train iteration 1, test iteration 2),
  // and this view ranks them by OUT-of-sample with the in-sample figure beside it.
  { id: 'walk-forward-survivors', label: 'Walk-Forward Survivors', icon: '🎯' },
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
      // ⚠️ RETURNED HERE 2026-11-23 when the Appearance area was deleted (owner request: "delete
      // everything in the Appearance area … a fresh start"). Both are per-machine preferences, which
      // is the question this group answers. The design vocabulary now lives at /development/theme.
      { id: 'appearance', label: 'Appearance', icon: '🌈' },
      { id: 'screen-assignment', label: 'Screen Assignment', icon: '🖥️' },
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
  // ── Development — engineering tooling and experimental prototypes ──
  //
  // ⚠️ THIS AREA ABSORBED THE ENGINEERING HALF OF LAB (requirement 2026-09-23).
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
      // 2026-11-25 — the TABLE registry, sibling of File Inventory: that page answers "what files
      // exist", this one answers "what tables exist, what each is for, how fast it grows and how
      // long it is kept". ⚠️ The view already existed in `view-routes.jsx` and had NO navigation
      // entry anywhere, so it was unreachable — wiring it is not a new surface. It is here, in
      // Development, because it is engineering reference rather than a trading or health page.
      { id: 'database-tables', label: 'Database Tables', icon: '🗄' },
      // ── Decisions — the sandbox's OUTPUT (requirement 2026-09-24) ──
      // The Development area is where an agent may build a competing approach, measure it, and produce
      // a decision. An experiment that does not end in a decision is a prototype, not an experiment —
      // so the registry sits here, near the top, rather than at the bottom of a list of tools.
      // Entries are enforced by scripts/validate-theories.cjs (a theory needs a falsification test).
      { kind: 'section-header', id: 'dev-decisions', label: 'Decisions', icon: '⚖' },
      { id: 'theory-registry', label: 'Theory Registry', icon: '🔬' },
      // R21 / #990 — the requirement settled on a NEW REGISTER over a second section in the review queue, so
      // observations can accumulate BEFORE they become decisions. Sits beside the theory registry
      // because they are the same shape: a held position, written down so it can be judged.
      { id: 'design-observations', label: 'Design Observations', icon: '👁' },
      // ── Engineering tools — build and inspect the UI itself ──
      { kind: 'section-header', id: 'dev-engineering', label: 'Engineering Tools', icon: '🛠' },
      // MOVED here from `/bots/trading-bots` 2026-11-19 (owner: the queue "is actually just becoming
      // screen clutter and noise … it takes way focus [away from] the bot table itself"). It is a list
      // of edits we are considering, most of which will never be applied — that is working material,
      // so it belongs with the tooling. The bots page keeps only the queue for the SELECTED bot.
      { id: 'queued-changes', label: 'Queued Changes', icon: '📝' },
      { id: 'feature-lab', label: 'Feature Lab', icon: '🔬' },
      { id: 'ui-review', label: 'Page Walkthrough', icon: '📋' },
      // The badge list the owner asked for: every standard this project claims, and the gate that
      // proves it. Withheld by default like every other new page (page-visibility rule).
      { id: 'standards', label: 'Engineering Standards', icon: '🏅' },
      // ⚠️ `responsive-layout-lab` MOVED to the Appearance area 2026-10-13 (owner request). It is a
      // viewport/visual tool rather than an engineering debug surface, and the new area is where the
      // owner is collecting visual options. Its old route redirects.
      { id: 'identity-map', label: 'Identity Map', icon: '🧭' },
      { id: 'diagrams', label: 'Diagrams', icon: '▦' },
      // #974 — "why didn't it trade?", answered from the database. Built in Development because it
      // is an EXPERIMENT first: does seeing the exit reasons help, or is it noise? Register row 36
      // constrains how it may be framed (a thin funnel is not a fault), not whether it exists.
      { id: 'blocked-signals', label: 'Blocked Signals', icon: '🚦' },
      // #1190 — the trend READING experiment (requirement, 2026-11-03): do this as an experimental feature).
      // Development because it is an experiment first: does seeing the fitted line and the invalidation
      // level help you judge a score, or is it noise? Observation only — nothing in scoring reads it.
      { id: 'trend-reading', label: 'Trend Reading', icon: '📐' },
      // #1281 — the market-wide movers feed. Requirement (2026-11-15): I would like to see a list of all
      // the winners and losers and how TCS is treating them…, narrowed 2026-11-18: *"can then focus
      // on being fed by a live market feed of the top winners and losers"*. The treatment half moved
      // to `/watchlists/registered-movers`; what is left here is the unbounded discovery question,
      // which stays in Development because it began as an experiment and the strategy on top of it is
      // INACTIVE with its reason until a protocol exists.
      { id: 'movers-treatment', label: 'Market Movers', icon: '🌍' },
      // 2026-09-28 — the CHANGE view. Every trading page rendered a snapshot; only PerformanceLab
      // had a time axis. This is Development because it is an EXPERIMENT first: does seeing the
      // period-over-period delta help you judge a system, or is it noise? Read-only by design —
      // it calls two endpoints that only query the database.
      { id: 'performance-change', label: 'Performance Change', icon: '📈' },
      // ── Theme engineering ──
      // ⚠️ THE APPEARANCE AREA WAS DELETED 2026-11-23 (owner request: "delete everything in the
      // Appearance area … we'll have a single page in the Development area called Theme instead").
      // `theme` is that page: a GALLERY OF NAMED DESIGN SPECIMENS — Dotted Stat, Summary Strip, Dense
      // Table, Spacious Table, Toolbar, Chip Bar, Detail Rail, Trade Card, Alert Card, Priority Panel.
      // It is the vocabulary a new page should be built from, and the only visual reference now.
      //
      // `responsive-layout-lab` came with it: the old copy explained itself in paragraphs between every
      // demo, which the owner called "too overwhelming". It is labels and specimens now.
      { kind: 'section-header', id: 'dev-theme', label: 'Theme', icon: '🎨' },
      { id: 'theme', label: 'Theme', icon: '🎨' },
      { id: 'responsive-layout-lab', label: 'Responsive Layout Lab', icon: '📐' },
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
 *
 * ⚠️ AREA-LEVEL SUPPRESSION HAPPENS HERE, NOT ONLY IN `hidden-views.js` (2026-11-07).
 * `NAV_TREE` is `{ area: { label, hidden?, views } }` but this function returns `{ area: [views] }`
 * — and the array form has **nowhere to put a flag**, so an area marked `hidden: true` was dropped
 * from the TOP NAV (which reads `NAV_TREE` directly) and kept in the LEFT RAIL (which reads this).
 * Measured while hiding Education: the two navigation surfaces disagreed, which is the exact failure
 * the comment in App.jsx warns about — *"the sidebar and the top bar must never disagree about which
 * areas exist"*. Deriving it here means the flat structure cannot carry an area the object tree has
 * already dropped.
 */
export function getNavStructure() {
  const structure = {};
  for (const [key, area] of Object.entries(NAV_TREE)) {
    if (area?.hidden === true) continue;
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

