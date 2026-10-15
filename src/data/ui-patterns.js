/**
 * ui-patterns.js — the owner's APPROVED UI patterns, read out of the Page Walkthrough.
 *
 * ⚠️ THIS IS NOT AN AGENT'S OPINION OF GOOD DESIGN. Every entry below is traceable to a verdict the
 * owner recorded on `/development/ui-review` — a UI/10 score and/or a "Preferred Elements" note
 * (`noteNew`). Where a pattern comes from a page the owner scored LOW, that is stated, because the
 * owner sometimes names the ONE strong element on an otherwise weak page (`/protocols/directive-viewer`
 * is 4/10 and its status pills are the thing they want to decide between).
 *
 * ⚠️ SOURCE OF TRUTH: `appsetting` table, row `id='app'`, `$.uiReview.entries` (json). Measured
 * 2026-10-13: 144 entries, 103 with a `uiScore`, 25 with Preferred Elements. `nest/app-settings.json`
 * is the mirror the service writes and it agreed exactly (144/144, newest `updatedAt`
 * 2026-10-13T16:58:17.755Z). Re-read it with:
 *     node scripts/audit-ui-review.cjs       # DB is canonical; the mirror is a claim about it
 *
 * ⚠️ WHY A DATA FILE AND NOT MARKUP. The owner's requirement is that this library be REMOVABLE —
 * *"I need to be able to remove it from this app once we update the apps existing theme lab"* — and
 * that it be lifted into React Stack Core later. So it is plain data with **no imports**: it can be
 * copied to another project, re-topiced with different subject matter, and deleted from this one
 * without untangling anything.
 *
 * ⚠️ `state` IS THE HONEST BIT — do not collapse it:
 *   'strong'     the pattern is proven in this app and the owner said so.
 *   'requested'  the owner asked explicitly for a sample in the library; not built yet.
 *   'undecided'  the owner asked to see TWO approaches side by side before choosing. A sample that
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
  { id: 'table', label: 'Tables', lede: 'The workhorse. The owner named five distinct table jobs rather than one table style.' },
  { id: 'status', label: 'Status language', lede: 'How a state, a taxonomy or a number is made visible.' },
  { id: 'control', label: 'Controls & forms', lede: 'Choosing, adding and filtering.' },
  { id: 'container', label: 'Containers', lede: 'What holds the content, and when that container is itself the message.' },
];

export const UI_PATTERNS = [
  // ── Page shape ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'master-detail-rail',
    family: 'shape',
    name: 'Master–detail with a control rail',
    what: 'A wide list of selectable rows on the left, and a right-hand sidebar that is a mix of quick controls and detail for whatever is selected. Described by the owner as "like quick settings for something that is selected".',
    bestFor: 'Large collections where the user works one item at a time',
    sources: [{ view: '/protocols/directives-registry', score: 8 }, { view: '/research/symbols-browser', score: 8 }],
    elements: ['wide selectable rows', 'right rail (symbol-detail-rail)', 'title with slug beneath'],
    owner: '"the selectable rows being wider and the additional information being in a sidebar on the right… This sidebar is a mix of controls and that is what makes this layout useful."',
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
    owner: '"The accordion is good layout. The title bar works really well for me" … "the spacing helps to avoid overwhelming"',
    state: 'strong',
  },
  {
    id: 'step-through',
    family: 'shape',
    name: 'Step-through with per-step status',
    what: 'A pipeline shown as ordered steps, each carrying its own state, so a long process is readable in one screen. Called "highly unique" by the owner.',
    bestFor: 'Multi-stage pipelines and processes with a per-stage outcome',
    sources: [{ view: '/status/meta-stack-explorer', score: 9 }],
    elements: ['step list', 'per-step status', 'high-impact notice banner (mse-signal-banner)'],
    owner: '"keep the step approach and individual status within each step"',
    state: 'strong',
  },
  {
    id: 'flow-page',
    family: 'shape',
    name: 'Flow page: text → cards → text → controls → table',
    what: 'A long page that alternates prose, cards and a table, with restrained colour. The owner could not fully explain why it works and said so.',
    bestFor: 'Statistical reference pages that must be explained and read, not just scanned',
    sources: [{ view: '/status/broker-catalogue', score: null }],
    elements: ['broker stat cards (bc-broker)', 'inline explanatory text', 'closing table'],
    owner: '"surprisingly effective despite being simple… the minimum flashy colouring but occasional use of it also seems to work"',
    state: 'strong',
  },

  // ── Tables ────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'ladder-table',
    family: 'table',
    name: 'Paired-comparison ladder',
    what: 'Two columns holding comparable statistics side by side, with a shared ranking. Built for a stat that changes constantly. The owner calls the design "almost perfect".',
    bestFor: 'Live monitoring of paired/competing values (score vs score, protocol vs protocol)',
    sources: [{ view: '/scoring/live-ordering-stack', score: 9 }],
    elements: ['paired rows', 'rectangular status icons', 'partly-coloured values'],
    owner: '"a unique design engineered for the purpose of stock scoring… an excellent approach to any records that have a compared stat that constantly changes"',
    state: 'strong',
  },
  {
    id: 'stats-status-table',
    family: 'table',
    name: 'Common stats-and-status table',
    what: 'A row-heavy table where most columns are a status rather than a number, all drawn in one consistent style. The owner wants the app to converge on one of these.',
    bestFor: 'The default list-of-things table across the app',
    sources: [{ view: '/protocols/protocols-ladder', score: 7 }, { view: '/scoring/symbols-ladder', score: 8 }],
    elements: ['rectangular status icons', 'slashed stats with a partly coloured value'],
    owner: '"one of the strongest tables… the rectangular status icons work very well when all columns use the same style"',
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
    owner: '"a good table for offering per row actions… unique. The styling is good and I want a sample of this table in my final theme."',
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
    owner: '"a great table for a set number of items/rows and basic status"',
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
    owner: '"I like the table as a simplistic solution so lets add a sample for that purpose"',
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
    owner: '"I like the ALL READY BETA ALPHA toggles too and how styles change. These are like traffic lights in a sense."',
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
    owner: '"I like the coloured dots for presenting colour keyed statistics so lets include that"',
    state: 'strong',
  },
  {
    id: 'status-pill-fork',
    family: 'status',
    name: '⚠️ Status pills — TEXT vs RECTANGLE (undecided)',
    what: 'Two existing ways of showing the same state. The TEXT pill makes the word itself striking; the RECTANGLE badge is what most tables currently use. The owner has NOT chosen and asked for both to be shown together.',
    bestFor: 'Wherever a state or signal class is displayed — this decision propagates app-wide',
    sources: [{ view: '/protocols/directive-viewer', score: 4 }, { view: '/scoring/symbols-ladder', score: 8 }],
    elements: ['dv-signal (text pill)', 'rectangular status icons (badge)'],
    owner: '"Something I\'m struggling to make a decision on is the approach to status pills… Please display these along side the rectangle shaped ones that are on other tables so [I] can make a decision on which"',
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
    owner: '"These small-sized stats with icons are good I want them in the theme"',
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
    owner: '"what I do like is this row of buttons with counters included so lets have samples of those"',
    state: 'strong',
  },
  {
    id: 'add-items-form',
    // Sample BUILT 2026-10-13, TRIMMED 2026-10-14 — the owner chose A (inline rows) and B (one card per
    // item) from three offered, and C was deleted. B is the one kept for items that need a warning or a
    // confirmation underneath their values; that reason is recorded at the code site.
    sampleAt: '/appearance/forms',
    family: 'control',
    name: 'Add-items form arrangement',
    what: 'A repeating "add item" block — currently monochrome. The owner wants 2–3 variants to choose from before settling.',
    bestFor: 'Building an ordered collection (groups, steps, rules)',
    sources: [{ view: '/protocols/protocol-builder', score: 7 }],
    elements: ['cp-section (Directive Groups)'],
    owner: '"This page has strong forms… Right now my only issue with it is everythings black and white. So add 2-3 examples of a similar \'add items\' form arrangement and I will choose one."',
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
    owner: '"It has accordion hidden tag clouds with nice interaction… this is a good approach to presenting a lot of options in a series of taxonomies."',
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
    owner: '"The screen options are good… and they work especially good with icons so I want both samples in my theme library."',
    state: 'requested',
  },
  {
    id: 'pip-trigger',
    // ⚠️ CORRECTED 2026-10-13, AND THE ORIGINAL ENTRY WAS WRONG. Measured: the `.pip-trigger` class
    // belongs to `src/components/PageInfoPopover.jsx` — it is the small CIRCULAR ℹ button that opens a
    // native popover, and the shell renders it in the top row for any view with a VIEW_EXPLANATIONS
    // entry. It is NOT a square button and it does NOT open a symbol or detail panel. The owner's
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
    owner: '"This needs to be a part of all pages so lets add it to the theme libraries example pages"',
    state: 'requested',
  },

  // ── Containers ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'decision-card',
    family: 'container',
    name: 'Information-dense decision card',
    what: 'A card packed with status, numbers and a small number of options — built for acting on rather than reading.',
    bestFor: 'Quick decisions where several facts and an action must be visible together',
    sources: [{ view: '/signals/signals-overview', score: 8 }],
    elements: ['sig-b-card'],
    owner: '"Signals offers advanced cards. They\'re packed with information and status and some options. It\'s important for quick decision making."',
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
    owner: '"This is brilliant as a status card for a single service or system"',
    state: 'strong',
  },
  {
    id: 'widget-system',
    family: 'container',
    name: 'Dashboard widget system',
    what: 'The whole widget board — placement, sizing and per-widget minimums. The single strongest thing on the walkthrough per the owner, and the thing they intend to reuse most.',
    bestFor: 'Any page where the user should arrange their own information',
    sources: [{ view: '/dashboard/dashboard', score: 8 }, { view: '/status/broker-catalogue', score: null }],
    elements: ['widget board', 'bc-broker cards'],
    owner: '"The entire dashboard and widget system is strong. I will want to copy this into my React Stack Core and use it in most projects."',
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
    owner: '"the fade on roll card stacks should be used within our app and future apps"',
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
    owner: '"I like this large high impact notice… create a list of samples like this with the purpose being to get the attention of the user or summarise."',
    state: 'requested',
  },
];

/** Element the owner named as actively DISLIKED — worth as much as the approved list. */
export const REJECTED_PATTERNS = [
  {
    id: 'deletable-chips',
    name: 'Pills as selected/included indicators',
    why: '"I don\'t like the pill approach for a lot of things especially as indicators of selected/included options with deletable link" (cp-chip, /protocols/protocol-builder)',
  },
];
