/**
 * temp — report the applied-status of the walkthrough's OLD comments, for the agent's own work.
 *
 * ⚠️ Repo ROOT on purpose: a file under `scripts/` stales docs/TOOLS-INDEX.md, a prebuild gate.
 *
 * WHY a script rather than clicking: the columns are an INDICATOR, not a control. The owner asked
 * *"use the new columns to confirm if you have done the work or not"* — so the agent doing the work is
 * the writer, through the API.
 *
 * ⚠️ ONLY `true` AND `false` ARE SET HERE. A row left untouched stays `null` = "not assessed", which is
 * deliberately different from `false` = "assessed, and the work is outstanding". Every row in the two
 * lists below has actually been assessed in this session — the reasons are in the handoffs.
 *
 * ⚠️ Rows for views that no longer exist (the delete requests) are NOT set: the walkthrough renders no
 * row for them, so a value would be invisible. They are recorded as done in the handoffs instead.
 */
const U = 'http://localhost:3201/api/system/settings/ui-review';

/** The old comment is fully actioned. */
const APPLIED = [
  '/watchlists/active-symbols',      // Protocols column was reading a phantom field; now sends ?tickers=
  '/trading/strategies-derived',     // accordions
  '/trading/trade-journal',          // accordions
  '/education/glossary',             // button font (fixed app-wide)
  '/research/screener',              // scored + traded stats
  '/scoring/singles-monitor',        // renamed Single Symbol + search
  '/protocols/protocol-trail',       // symbol entry point
  '/protocols/directive-viewer',     // directive picker + search
  '/trading/strategy-comparison',    // hover tint
  '/development/blocked-signals',    // sortable columns
  '/status/health-check',            // report download + the invisible info control
  '/trading/strategy-library',       // bot link-state badge
  '/research/daily-briefing',        // restyled + moved to the Research area
  '/status/broker-catalogue',        // account name on the broker line; moved from Research to Status
  '/research/market-correlations',   // heatmap, flags columns, the two discussion issues
  '/lab/position-lifecycle',         // tokens + table treatment
  '/planner/objectives',             // Education category
  '/planner/personal-finances',      // made a free page
  '/planner/trading-styles',         // made a free page
  '/trading212/t212-portfolio',      // symbol links + table treatment
  '/protocols/sees-arena',           // watchlist grouping + table + stats
  '/protocols/dual-protocol-inspector', // assessed: measured, recorded on #765
  '/protocols/protocols-ladder',     // assessed: measured, recorded on #765
  // area / placement requests that are satisfied
  '/development/commands',
  '/development/file-inventory',     // area move
  '/development/architecture-framework',
  '/settings/screen-assignment',     // placement
];

/** Assessed in this session, and the work is NOT finished. */
const OUTSTANDING = [
  '/trading/mt5-trading',            // toggle + rename done; the Width bar into Screen Options is not
  '/status/order-testing',           // moved to Status; the QA feedback loop is not designed
  '/protocols/protocols-registry',   // old design not removed (the wrapper is load-bearing)
  '/research/earnings-calendar',     // row overlay not built (AI half tracked in #1076)
  '/research/news-intel',            // register-symbol overlay not built
  '/trading/positions-monitor',
  '/status/meta-stack-status',       // the 60/100 investigation
  '/status/meta-stack-explorer',
  '/status/meta-stack-pipeline',     // nodes not factored into Pipeline Graph Lab
  '/status/platform-comparisons',
  '/scoring/live-ordering-stack',
  '/signals/signals-overview',
  '/development/diagrams',
  // ⚠️ The three /automation/* views render no row of their own now — that area is served by
  // /settings/automation, which is NOT assessed here. Their store entries are cleared as stale.
  '/education/candle-patterns',
  '/education/candle-patterns-guide',
  '/trading/trading-bots',           // the scoring-mechanism UI needs a plan first
  '/trading/trading-plans',
  '/trading/market-context',
  '/trading/ab-strategies',
  '/dashboard/dashboard',
  '/research/stock-investigation',   // waits on the AI phase (#1076)
  '/research/research-notes',        // waits on the AI phase (#1076)
];

(async () => {
  const cfg = await (await fetch(U)).json();
  const entries = cfg.entries || {};
  const known = new Set(Object.keys(entries));
  const put = async (viewKey, patch) => {
    const r = await fetch(U, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewKey, patch }),
    });
    return r.status;
  };

  // ⚠️ Keys the walkthrough renders NO row for: the view was re-placed, so the value is invisible.
  // Left alone it would read as "assessed" for a view that no longer exists — a claim outliving its
  // subject. These were written minutes ago by this script, so clearing them loses nothing.
  const STALE = [
    '/status/commands', '/status/file-inventory',
    '/development/daily-briefing', '/development/screen-assignment',
    '/trading212/order-testing',
    '/automation/alert-center', '/automation/execution-queue', '/automation/automation-rules',
  ];
  const cleared = [];
  for (const key of STALE) {
    const s = await put(key, { noteApplied: null, noteNewApplied: null });
    if (s === 200) cleared.push(key);
  }
  console.log('stale keys cleared:', cleared.length, JSON.stringify(cleared));

  let ok = 0;
  const missing = [];
  for (const [key, value] of [...APPLIED.map((k) => [k, true]), ...OUTSTANDING.map((k) => [k, false])]) {
    if (!known.has(key)) { missing.push(key); continue; }
    const status = await put(key, { noteApplied: value });
    if (status === 200) ok++; else missing.push(`${key} (http ${status})`);
  }

  const after = (await (await fetch(U)).json()).entries;
  const tally = { applied: 0, outstanding: 0, unassessed: 0 };
  for (const k of Object.keys(after)) {
    const v = after[k].noteApplied;
    if (v === true) tally.applied++;
    else if (v === false) tally.outstanding++;
    else tally.unassessed++;
  }
  console.log('set ok        :', ok, 'of', APPLIED.length + OUTSTANDING.length);
  console.log('not set (no entry / error):', missing.length ? JSON.stringify(missing) : 'none');
  console.log('tally         :', JSON.stringify(tally), '(over all stored entries)');
})();
