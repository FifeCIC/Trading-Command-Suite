/**
 * ui-patterns.js — the project's APPROVED UI patterns, read out of the Page Walkthrough.
 *
 * ⚠️ THIS IS NOT AN AGENT'S OPINION OF GOOD DESIGN. Every entry below is traceable to a verdict the
 * owner recorded on `/development/ui-review` — a UI/10 score and/or a "Preferred Elements" note
 * (`noteNew`). Where a pattern comes from a page the requirement scored LOW, that is stated, because the
 * owner sometimes names the ONE strong element on an otherwise weak page (`/protocols/directive-viewer`
 * is 4/10 and its status pills are the thing they want to decide between).
 *
 * ⚠️ SOURCE OF TRUTH: `appsetting` table, row `id='app'`, `$.uiReview.entries` (json). Measured
 * 2026-10-13: 144 entries, 103 with a `uiScore`, 25 with Preferred Elements. `nest/app-settings.json`
 * is the mirror the service writes and it agreed exactly (144/144, newest `updatedAt`
 * 2026-10-13T16:58:17.755Z). Re-read it with:
 *     node scripts/audit-ui-review.cjs       # DB is canonical; the mirror is a claim about it
 *
 * ⚠️ WHY A DATA FILE AND NOT MARKUP. The project's requirement is that this library be REMOVABLE —
 * *"I need to be able to remove it from this app once we update the apps existing theme lab"* — and
 * that it be lifted into React Stack Core later. So it is plain data with **no imports**: it can be
 * copied to another project, re-topiced with different subject matter, and deleted from this one
 * without untangling anything.
 *
 * ⚠️ `state` IS THE HONEST BIT — do not collapse it:
 *   'strong'     the pattern is proven in this app and the brief said so.
 *   'requested'  the brief asked explicitly for a sample in the library; not built yet.
 *   'undecided'  the brief asked to see TWO approaches side by side before choosing. A sample that
 *                silently picks one answers a question they have deliberately left open.
 */

export const PATTERN_SOURCE = {
  store: 'appsetting.uiReview',
  measuredAt: '2026-10-13',
  entries: 144,
  scored: 103,
  preferred: 25,
};

/** Families are the order a reader asks the questions in: shape → table → status → control → container. */
export const PATTERN_FAMILIES = [
  { id: 'shape', label: 'Page shape', lede: 'How the whole page is arranged before any component is chosen.' },
  { id: 'table', label: 'Tables', lede: 'The workhorse. The requirement named five distinct table jobs rather than one table style.' },
  { id: 'status', label: 'Status language', lede: 'How a state, a taxonomy or a number is made visible.' },
  { id: 'control', label: 'Controls & forms', lede: 'Choosing, adding and filtering.' },
  { id: 'container', label: 'Containers', lede: 'What holds the content, and when that container is itself the message.' },
];

export const UI_PATTERNS = [
  // ── Page shape ────────────────────────────────────────────────────────────────────────────────────
  {
    // ADDED 2026-11-18. It was reported "blocks of text appearing on the pages" twice in one day,
    // naming `<p.slv-lead>` and `<p.slv-theory-body>` on /strategies/day-top-winners. Both were prose
    // the reader had to work through to REACH the table — which was the only reason the page existed.
    // This entry is the replacement pattern, so the next page has something to copy instead of a
    // paragraph to imitate.
    id: 'fact-strip',
    family: 'shape',
    name: 'Fact strip instead of a paragraph',
    what:
      'Facts a reader needs before a table are rendered as a term/value grid (a <dl>), not as sentences: ' +
      'fixed terms down the left, values in one short line each. Sentences longer than about two lines ' +
      'do not belong on a working page — they belong in the ℹ popover, the theory entry, or an issue.',
    bestFor: 'The top of any page whose purpose is a table, a chart or a decision',
    sources: [{ view: '/strategies/day-top-winners', score: null }],
    elements: ['slv-facts', 'term/value rows', 'one-line claim + falsification'],
    state: 'strong',
  },
  {
    id: 'master-detail-rail',
    family: 'shape',
    name: 'Master–detail with a control rail',
    what: 'A wide list of selectable rows on the left, and a right-hand sidebar that is a mix of quick controls and detail for whatever is selected. Described by the requirement as "like quick settings for something that is selected".',
    bestFor: 'Large collections where the user works one item at a time',
    sources: [{ view: '/protocols/directives-registry', score: 8 }, { view: '/research/symbols-browser', score: 8 }],
    elements: ['wide selectable rows', 'right rail (symbol-detail-rail)', 'title with slug beneath'],
    state: 'strong',
  },
  {
    id: 'progressive-disclosure',
    family: 'shape',
    name: 'Progressive disclosure (accordion)',
    what: 'A strong title bar carrying only the few facts needed to identify an item, with everything else revealed on open. Explicitly positioned as an alternative to showing everything at once.',
    bestFor: 'Items needing "a small amount of information on the top row but potentially a lot when opened"',
    sources: [{ view: '/research/research-notes', score: 8 }, { view: '/protocols/protocols-registry', score: 8 }, { view: '/development/feature-lab', score: 6 }],
    elements: ['accordion title bar (rn-list)', 'open/closed list (fl-list)'],
    state: 'strong',
  },
  {
    id: 'step-through',
    family: 'shape',
    name: 'Step-through with per-step status',
    what: 'A pipeline shown as ordered steps, each carrying its own state, so a long process is readable in one screen. Called "highly unique" by the requirement.',
    bestFor: 'Multi-stage pipelines and processes with a per-stage outcome',
    sources: [{ view: '/status/meta-stack-explorer', score: 9 }],
    elements: ['step list', 'per-step status', 'high-impact notice banner (mse-signal-banner)'],
    state: 'strong',
  },
  {
    id: 'flow-page',
    family: 'shape',
    name: 'Flow page: text → cards → text → controls → table',
    what: 'A long page that alternates prose, cards and a table, with restrained colour. The requirement could not fully explain why it works and said so.',
    bestFor: 'Statistical reference pages that must be explained and read, not just scanned',
    sources: [{ view: '/status/broker-catalogue', score: null }],
    elements: ['broker stat cards (bc-broker)', 'inline explanatory text', 'closing table'],
    state: 'strong',
  },

  // ── Tables ────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'ladder-table',
    family: 'table',
    name: 'Paired-comparison ladder',
    what: 'Two columns holding comparable statistics side by side, with a shared ranking. Built for a stat that changes constantly. The requirement calls the design "almost perfect".',
    bestFor: 'Live monitoring of paired/competing values (score vs score, protocol vs protocol)',
    sources: [{ view: '/scoring/live-ordering-stack', score: 9 }],
    elements: ['paired rows', 'rectangular status icons', 'partly-coloured values'],
    state: 'strong',
  },
  {
    id: 'stats-status-table',
    family: 'table',
    name: 'Common stats-and-status table',
    what: 'A row-heavy table where most columns are a status rather than a number, all drawn in one consistent style. The requirement is the app to converge on one of these.',
    bestFor: 'The default list-of-things table across the app',
    sources: [{ view: '/protocols/protocols-ladder', score: 7 }, { view: '/scoring/symbols-ladder', score: 8 }],
    elements: ['rectangular status icons', 'slashed stats with a partly coloured value'],
    state: 'strong',
  },
  {
    // ADDED 2026-11-18. Two defects in one table, both measured on /strategies/day-top-winners:
    //   1. Every numeric header was right-aligned while its cells were left-aligned, because `num` was
    //      passed to the `th` and forgotten on the `td`. The requirement: "columns aren't under their headers".
    //   2. One list rendered alone stretched a four-column table to 1,452px of a 1,500px page.
    // Both are RULES, not tastes: a column's alignment is one fact declared at both ends, and a table's
    // width is set by its content, not by the page.
    id: 'aligned-numeric-table',
    sampleAt: '/strategies/day-top-winners',
    family: 'table',
    name: 'Numeric columns: one alignment, declared at both ends',
    what:
      'A numeric column is right-aligned in the HEADER and in every CELL, and uses tabular figures. ' +
      'The class that marks a cell as a number (e.g. `mm-num`) also positions it, so the two ends ' +
      'cannot drift. A table shown on its own caps its width — a short numeric table stretched across ' +
      'the page is unreadable, not "spacious".',
    bestFor: 'Every table with numbers in it — which is almost every table in this app',
    sources: [
      { view: '/strategies/day-top-winners', score: null },
      { view: '/development/movers-treatment', score: null },
    ],
    elements: ['th.num', 'td.mm-num', 'tabular-nums', 'max-width on a single-list grid'],
    state: 'strong',
  },
  {
    id: 'sorted-by-default',
    sampleAt: '/strategies/day-top-winners',
    family: 'table',
    name: 'Every data table sorts, and opens on the column that IS its subject',
    what:
      'Tables use the shared `useSort` ordering rule and give a MEANINGFUL default sort: a "top gainers" ' +
      'list opens on change descending, a losers list on change ascending, a volume list on volume. ' +
      'The provider feed order is not a ranking — measured 16.10, 10.31, 8.57, 12.38 — so leaving it ' +
      'unsorted makes correct data look broken.',
    bestFor: 'Any table whose rows have a subject (biggest, latest, worst) rather than a natural key order',
    sources: [{ view: '/strategies/day-top-winners', score: null }],
    elements: ['SortableTh', 'aria-sort', 'defaultSort per list'],
    state: 'strong',
  },
  {
    id: 'row-action-table',
    // Sample BUILT 2026-10-13 — example 3 on /appearance/data-display, using the real
    // `.screener-table` markup and live `/api/screener/ranked` rows.
    sampleAt: '/appearance/data-display',
    family: 'table',
    name: 'Row-action table',
    what: 'A table where each row offers its own actions and can be opened for more, with the row highlighting on hover.',
    bestFor: 'Lists that are worked through rather than only read',
    sources: [{ view: '/research/screener', score: 4 }],
    elements: ['screener table', 'row highlight', 'per-row actions'],
    state: 'requested',
  },
  {
    id: 'fixed-count-status-table',
    family: 'table',
    name: 'Fixed-count status table',
    what: 'A table for a known, small number of rows with basic status — a count that does not grow.',
    bestFor: 'A handful of systems, services or stages with a health state',
    sources: [{ view: '/status/meta-stack-status', score: 7 }],
    elements: ['mss-panel table'],
    state: 'strong',
  },
  {
    id: 'dense-read-table',
    // Sample BUILT 2026-10-13 — example 4 on /appearance/data-display, using the real
    // `.dv-table` markup and live `/api/scoring/ranked` rows.
    sampleAt: '/appearance/data-display',
    family: 'table',
    name: 'High-density read table',
    what: 'A deliberately plain table for fitting as much as possible on one screen. Named as the right choice for logs and reference data.',
    bestFor: 'Logs and information "best being able to see a lot on one screen"',
    sources: [{ view: '/protocols/directive-viewer', score: 4 }],
    elements: ['plain table'],
    state: 'requested',
  },

  // ── Status language ───────────────────────────────────────────────────────────────────────────────
  {
    id: 'traffic-light-taxonomy',
    family: 'status',
    name: 'Traffic-light taxonomy toggle',
    what: 'A small set of mutually exclusive states on a row, each with its own colour, behaving like a traffic light.',
    bestFor: '"3–5 options in a taxonomy" — maturity, tier, confidence',
    sources: [{ view: '/protocols/directives-registry', score: 8 }],
    elements: ['READY / BETA / ALPHA toggles'],
    state: 'strong',
  },
  {
    id: 'keyed-stat-dots',
    family: 'status',
    name: 'Coloured dots for keyed statistics',
    what: 'A compact row of counts, each prefixed by a colour that keys it to a category elsewhere on the page.',
    bestFor: 'A summary strip above a filtered list',
    sources: [{ view: '/protocols/directives-registry', score: 8 }],
    elements: ['directives-toolbar-stats'],
    state: 'strong',
  },
  {
    id: 'status-pill-fork',
    family: 'status',
    name: '⚠️ Status pills — TEXT vs RECTANGLE (undecided)',
    what: 'Two existing ways of showing the same state. The TEXT pill makes the word itself striking; the RECTANGLE badge is what most tables currently use. The requirement has NOT chosen and asked for both to be shown together.',
    bestFor: 'Wherever a state or signal class is displayed — this decision propagates app-wide',
    sources: [{ view: '/protocols/directive-viewer', score: 4 }, { view: '/scoring/symbols-ladder', score: 8 }],
    elements: ['dv-signal (text pill)', 'rectangular status icons (badge)'],
    state: 'undecided',
  },
  {
    id: 'small-icon-stats',
    family: 'status',
    name: 'Small stats with icons',
    what: 'Compact value+label pairs with a leading icon, coloured by sentiment.',
    bestFor: 'Summary rows where several counts sit on one line',
    sources: [{ view: '/research/news-intel', score: 7 }],
    elements: ['ni-summary-val (positive / negative / neutral)'],
    state: 'strong',
  },

  // ── Controls & forms ──────────────────────────────────────────────────────────────────────────────
  {
    id: 'quick-add-counters',
    family: 'control',
    name: 'Quick-add buttons carrying counters',
    what: 'A row of buttons that each add an item from a category, with the current count in the label. Preferred over pills for showing what is included.',
    bestFor: 'Adding from several small taxonomies without a modal',
    sources: [{ view: '/protocols/protocol-builder', score: 7 }],
    elements: ['cp-quick-add-groups'],
    state: 'strong',
  },
  {
    id: 'add-items-form',
    // Sample BUILT 2026-10-13, TRIMMED 2026-10-14 — the requirement settled on A (inline rows) and B (one card per
    // item) from three offered, and C was deleted. B is the one kept for items that need a warning or a
    // confirmation underneath their values; that reason is recorded at the code site.
    sampleAt: '/appearance/forms',
    family: 'control',
    name: 'Add-items form arrangement',
    what: 'A repeating "add item" block — currently monochrome. The requirement is 2–3 variants to choose from before settling.',
    bestFor: 'Building an ordered collection (groups, steps, rules)',
    sources: [{ view: '/protocols/protocol-builder', score: 7 }],
    elements: ['cp-section (Directive Groups)'],
    state: 'requested',
  },
  {
    id: 'tag-cloud-palette',
    family: 'control',
    name: 'Collapsible tag-cloud palette',
    what: 'A palette of many selectable options grouped under collapsible headings, with interactive tags.',
    bestFor: 'Presenting a lot of options across a series of taxonomies',
    sources: [{ view: '/protocols/protocol-builder', score: 7 }],
    elements: ['cp-section (Directive Palette)'],
    state: 'strong',
  },
  {
    id: 'segmented-filter',
    // Sample BUILT 2026-10-13 — both proven variants on /appearance/forms: the five-option time window
    // and the icon variant (☀️ BMO / 🌙 AMC).
    sampleAt: '/appearance/forms',
    family: 'control',
    name: 'Segmented control with icons',
    what: 'A segmented filter where each segment may carry an icon; two proven variants (time window, session timing).',
    bestFor: 'Switching the view of a list between a few fixed alternatives',
    sources: [{ view: '/research/earnings-calendar', score: 4 }],
    elements: ['ff-seg'],
    state: 'requested',
  },
  {
    id: 'pip-trigger',
    // ⚠️ CORRECTED 2026-10-13, AND THE ORIGINAL ENTRY WAS WRONG. Measured: the `.pip-trigger` class
    // belongs to `src/components/PageInfoPopover.jsx` — it is the small CIRCULAR ℹ button that opens a
    // native popover, and the shell renders it in the top row for any view with a VIEW_EXPLANATIONS
    // entry. It is NOT a square button and it does NOT open a symbol or detail panel. The project's
    // walkthrough note attached it to /watchlists/active-symbols because that is the page where their
    // element picker sampled it — the element is shell-level, not page-level.
    // The `what` / `bestFor` lines below were written before that was measured; the `sampleAt` note is
    // the correction. Do not re-read the old description as fact.
    sampleAt: '/appearance/forms',
    family: 'control',
    name: 'Inline trigger — the ℹ popover',
    what: 'The ℹ button (`PageInfoPopover`): a small CIRCULAR trigger that opens a native popover explaining whatever sits beside it. The shell renders it in the top row for any view with an explanation entry, so it is already app-wide rather than something to add per page.',
    bestFor: 'Explaining a view or a control in place, without a help page',
    sources: [{ view: '/watchlists/user-watchlists', score: 6 }],
    elements: ['pip-trigger'],
    state: 'requested',
  },

  // ── Containers ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'notice-family',
    family: 'container',
    name: 'Notice family — four semantic tones',
    what: 'One notice component in four tones (success, warning, critical, info), each a tinted surface with a matching border and a tone-coloured icon. The tone is the message; the wording sits inside it. Defined once in index.css as `.app-notice--{success|warning|critical|info}` over the `--notice-*` token set, so a page picks a tone rather than inventing colours.',
    bestFor: 'Any state a reader must notice before reading on — a failed read, a position needing attention, a degraded service',
    sources: [{ view: '/trading/exit-signals', score: null }],
    elements: ['.app-notice--critical', '.app-notice--warning', '.app-notice--success', '.app-notice--info'],
    // ⚠️ `score: null` ON PURPOSE. The CRITICAL notice is named explicitly, and no UI score was given
    // for the page — inventing one would be an agent's judgement dressed as a measurement.
    state: 'strong',
  },
  {
    id: 'decision-card',
    family: 'container',
    name: 'Information-dense decision card',
    what: 'A card packed with status, numbers and a small number of options — built for acting on rather than reading.',
    bestFor: 'Quick decisions where several facts and an action must be visible together',
    sources: [{ view: '/signals/signals-overview', score: 8 }],
    elements: ['sig-b-card'],
    state: 'strong',
  },
  {
    id: 'service-status-card',
    family: 'container',
    name: 'Single-service status card',
    what: 'One panel per service or system showing its priority state and headline figures. Called "brilliant".',
    bestFor: 'A small number of services, each needing a health summary',
    sources: [{ view: '/status/meta-stack-status', score: 7 }],
    elements: ['mss-panel--priority'],
    state: 'strong',
  },
  {
    id: 'widget-system',
    family: 'container',
    name: 'Dashboard widget system',
    what: 'The whole widget board — placement, sizing and per-widget minimums. The single strongest thing on the walkthrough per the requirement, and the thing they intend to reuse most.',
    bestFor: 'Any page where the user should arrange their own information',
    sources: [{ view: '/dashboard/dashboard', score: 8 }, { view: '/status/broker-catalogue', score: null }],
    elements: ['widget board', 'bc-broker cards'],
    state: 'strong',
  },
  {
    id: 'reveal-on-scroll',
    family: 'container',
    name: 'Fade-on-scroll card stack',
    what: 'Cards that fade and lift as they enter the viewport, one at a time.',
    bestFor: 'Presenting a short sequence where attention should follow in order',
    sources: [{ view: '/development/theme-lab', score: 7 }],
    elements: ['tl-section (Fade-on-Scroll Card Stack)'],
    state: 'strong',
  },
  {
    id: 'impact-notice',
    // Sample BUILT 2026-10-13 — /appearance/surfaces, using the source page's own `.mse-signal-banner`
    // classes and live `/api/scoring/ranked` values. The `mse-signal-verified` modifier is deliberately
    // NOT shown: its "✓ Pipeline Verified" badge is a claim about the pipeline, not a style.
    sampleAt: '/appearance/surfaces',
    family: 'container',
    name: 'High-impact notice banner',
    what: 'A large, loud banner carrying one headline figure and its status — deliberately built to stop the eye.',
    bestFor: 'Getting attention, or summarising a page in one element',
    sources: [{ view: '/status/meta-stack-explorer', score: 9 }],
    elements: ['mse-signal-banner'],
    state: 'requested',
  },
];

/** Element the requirement named as actively DISLIKED — worth as much as the approved list. */
export const REJECTED_PATTERNS = [
  {
    id: 'deletable-chips',
    name: 'Pills as selected/included indicators',
    why: '"I don\'t like the pill approach for a lot of things especially as indicators of selected/included options with deletable link" (cp-chip, /protocols/protocol-builder)',
  },
];
