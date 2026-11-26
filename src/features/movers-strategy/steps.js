/**
 * steps.js — THE MOVERS BACKTEST, AS AN ORDERED SET OF STEPS.
 *
 * ── WHY THIS FILE EXISTS AND WHY IT IS HERE ──────────────────────────────────────────────────────
 * Owner, 2026-11-23: every section and table becomes an accordion, and each accordion is examined as a
 * step of the process. Steps belong to a STRATEGY, not to the backtest library — the protocol backtest
 * page has a different sequence — so the definition lives with this strategy and the page reads it.
 *
 * ⚠️ THE ORDER IS THE PIPELINE'S ORDER, NOT THE SCREEN'S. A reader examining a run moves the way the
 * run did:
 *
 *   1 what was asked for  →  2 what came back  →  3 is it a record  →  4 per day  →  5 per symbol
 *   →  6 per bar  →  7 what we did not show  →  8 the settings behind it
 *
 * Each step's `purpose` is the QUESTION it answers, not a description of its contents — a collapsed
 * step that says "Result by symbol" tells a reader nothing about whether to open it. The page supplies
 * each step's `meta` figures from that step's own data for the same reason.
 *
 * ── THE EXTENSION BOUNDARY ──────────────────────────────────────────────────────────────────────
 * Everything a second strategy would want unchanged lives in `src/components/` and `src/core/`
 * (`StepAccordion`, `StatCard`, `TradeConfigPanel`, `BestRecordPanel`, `UnusedDataPanel`,
 * `ExecutionsTable`, `DecisionsTable`, `useSort`). This folder is the part that would SHIP as the
 * movers extension: the step list, the two result tables, and the page's own formatters.
 *
 * ⚠️ THE SPLIT IS NOT FINISHED. The settings form (~264 lines) and the summary block (~210 lines) are
 * still in the page, because each reads a dozen page-level derived values and a component that takes
 * half the page as props hides that coupling rather than removing it. Tracked in #1343, with the rule
 * that a block moves only when its props are narrower than the page's own state.
 */

/**
 * ── DECISION (2026-11-23, primary) ─────────────────────────────────────────────────────────────
 * WHAT:      the step list belongs to the STRATEGY folder, and its order is the PIPELINE order —
 *            not the order the sections happened to appear on the page.
 * WHY:       a second strategy has a different sequence but the same machinery, so the sequence is
 *            the part that must be custom and the machinery is the part that must be shared. An
 *            examination page read out of order invites conclusions about the wrong stage.
 * INSTEAD OF: keeping the section order as it grew, which left the trade-configuration panel at the
 *            BOTTOM while the settings form was at the top — two places for one subject.
 * REVERSE BY: reorder the array and bump `MOVERS_PAGE_ID`; `steps.test.js` asserts contiguity from 1,
 *            so a half-finished reorder fails rather than shipping a gap.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 264
 * GUARD:     steps.test.js
 */

/** Stable ids are also the DOM anchors, so a step can be linked to. Prefix prevents collisions. */
export const MOVERS_STEPS = [
  {
    id: 'mvp-step-settings',
    step: 1,
    title: 'Test settings',
    purpose: 'Which strategy leg, which day’s list, and how many of it to trade.',
    defaultOpen: true,
    /**
     * Audit notes (owner, 2026-11-23): what this step does NOT yet show, using data the run already
     * generates. Rendered BETWEEN steps as a quiet card, never inside a step's own content.
     *
     * ⚠️ ONE LINE EACH, ≤ 20 words. The owner's objection to the old caveat list was volume, so a note
     * that reads as a paragraph would recreate the problem it exists to solve.
     *
     * ⚠️ EVERY NOTE WAS DELETED AS ITS WORK SHIPPED (#1352/#1353/#1342, 2026-11-26): the per-day
     * coverage preview, the run's cost estimate, the caveat list becoming a table, and `fillGap`. Both
     * audit lists in this file are now empty, which is the intended end state — a note that outlives
     * its implementation advertises work already done.
     */
    audit: [],
  },
  {
    id: 'mvp-step-summary',
    step: 2,
    title: 'What the run returned',
    purpose: 'The totals, and whether they improved on the previous test of the same thing.',
    defaultOpen: true,
    audit: [],
  },
  {
    id: 'mvp-step-best',
    step: 3,
    title: 'Best recorded result',
    purpose: 'Has this test ever been better than it is now — and with which settings.',
    defaultOpen: false,
    // Audit note 'e' removed 2026-11-26: the attempt trend shipped in `BestRecordPanel`.
    audit: [],
  },
  {
    id: 'mvp-step-day',
    step: 4,
    title: 'Result by day',
    purpose: 'What each session’s screen offered, what the ranking picked, and what it earned.',
    defaultOpen: false,
    // Audit notes 'f' and 'g' removed 2026-11-26: the P/L bars shipped in `ResultByDayStep` and
    // `ResultBySymbolStep`, from one shared scaler (`pnl-bars.js`).
    audit: [],
  },
  {
    id: 'mvp-step-symbol',
    step: 5,
    title: 'Result by symbol',
    purpose: 'Which instruments carried the total, and which were picked more than once.',
    defaultOpen: false,
    audit: [
      'P/L by symbol as a bar, with win rate beside it, to show concentration rather than ask for it.',
    ],
  },
  {
    id: 'mvp-step-funnel',
    step: 6,
    title: 'Scores → signals → trades',
    purpose: 'How many scorings became a signal, how many cleared the bar, and how many were traded.',
    defaultOpen: false,
    audit: [
      'Speed is RATED and invisible: `speed-momentum` holds 120 of the protocol’s capacity and has no column anywhere.',
      'A funnel bar per symbol would show where the population is lost, not just how much.',
    ],
  },
  {
    id: 'mvp-step-directives',
    step: 7,
    title: 'Directive record',
    purpose: 'What each directive has actually scored and predicted, over the stored sample.',
    defaultOpen: false,
    audit: [
      'Per-directive hit rate beside this run’s own scores — “which voice was right?” needs both.',
    ],
  },
  {
    id: 'mvp-step-parity',
    step: 8,
    title: 'Backtest vs live',
    purpose: 'Which mechanisms this run shares with the account, and what it cannot reproduce.',
    defaultOpen: false,
    audit: [
      'Wiring a divergent mechanism is a maths change: copy the configuration and compare, never edit in place.',
      'A run could state its own exposure — how many of its trades touched a mechanism that differs.',
    ],
  },
  {
    id: 'mvp-step-bars',
    step: 9,
    title: 'Bar by bar',
    purpose: 'Every bar’s score and every decision, down to the directive that moved it.',
    defaultOpen: false,
    audit: [
      'A price chart with markers — score, entry, stop moves, exit — on the bar axis. The one change that turns reading into looking.',
    ],
  },
  {
    id: 'mvp-step-inventory',
    step: 10,
    title: 'Recorded, not shown',
    purpose: 'What this run already knows and no table above uses — with this run’s own values.',
    defaultOpen: false,
    audit: [
      'Turn the inventory into a pick-list per reader, so choosing what to surface is a mechanism not a conversation.',
    ],
  },
  {
    id: 'mvp-step-config',
    step: 11,
    title: 'Trade configuration',
    purpose: 'The stop, target, entry bar and hold time these numbers were produced under.',
    defaultOpen: false,
    audit: [
      'Price distances beside every percentage: `slPct 5` at a 1.50 entry is 0.075, and the reader does that sum today.',
    ],
  },
];

/** Fast lookup so a mount site names its step once and cannot mistype a title. */
export const MOVERS_STEP = Object.fromEntries(
  MOVERS_STEPS.map((s) => [s.id, s]),
);

/** The page id for stored open/closed state — one namespace per page, versioned with the step list. */
export const MOVERS_PAGE_ID = 'movers-backtest-v2';
