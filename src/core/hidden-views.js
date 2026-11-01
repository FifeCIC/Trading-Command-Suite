/**
 * hidden-views.js — the owner's "hide now" verdicts, applied to navigation.
 * ========================================================================
 *
 * ⚠️ WHY THIS EXISTS. The Page Walkthrough (`/development/ui-review`) recorded `hide: true` on five
 * pages on 2026-10-02 and **nothing consumed it**. Traced every reader of
 * `/api/system/settings/ui-review`: the settings service/controller, the walkthrough page itself,
 * and two documentation strings. The verdicts were being STORED and never APPLIED — so "hide now"
 * had no effect on the app at all. This module is the missing consumer.
 *
 * ⚠️ EXTRACTED 2026-10-28 from `edition-nav.js`, where it did not belong. It shared that file with
 * the free-edition nav filtering purely because both answer "may this be offered?". The free
 * edition has been cancelled (FREE-EDITION-PLAN.md is superseded), but THIS feature is live and
 * owner-facing — the distinction had to be made explicitly or the removal would have deleted it.
 *
 * ⚠️ IT FAILS OPEN, DELIBERATELY. A failed or absent fetch yields just `DEFAULT_HIDDEN_ROUTES`
 * (the curated withheld set), never an empty nav and never an error. Hiding is a curation
 * convenience, not a gate: if the store cannot be read, showing a page that was withheld is
 * recoverable, whereas hiding pages because a request failed is not.
 */

/**
 * Views withheld from navigation for everyone by default, unless someone explicitly un-hides them.
 *
 * ⚠️ WHAT THIS LIST IS FOR (owner direction, 2026-11-01): *"I think we can hide around 20 pages with
 * the intention of creating exciting releases in future."* So these are **withheld features, not
 * rejects** — a curated set kept out of a new user's first view so the app they meet is small and
 * sharp, and each pack can be announced later as a release. Moving an id OUT of this list IS the
 * release. Nothing here is deleted: every route still works by URL.
 *
 * ⚠️ WHY IT HAS TO LIVE IN CODE (2026-11-01). The hide verdicts live in `appsetting` (mirrored to
 * `nest/app-settings.json`) and **nothing seeds them**, so a fresh install hid nothing at all: a new
 * user met 107 sidebar entries with no indication which were worth their time, and the owner's own
 * curation existed only on his machine. `database-seed-discipline`: a setting that is not in a
 * seeder is lost on reinstall; a constant is not.
 *
 * ⚠️ ONLY NAVIGATION-VISIBLE VIEWS CAN GO IN THIS LIST. Navigation builds links as `/{area}/{id}`
 * (App.jsx:503) and `filterHiddenViews` matches on the view id — so a route that is not in
 * `NAV_TREE` has nothing to hide. Measured 2026-11-01: of the owner's nine `hide: true` verdicts,
 * **eight** pointed at detail routes that are not in the nav (`/trading212/t212-cfd`,
 * `/research/analyse-symbol`, `/education/candle-patterns`, …), so only `calculators` ever acted.
 * A toggle that silently cannot act is worse than no toggle, which is why every id below is
 * asserted against the real nav tree in `hidden-views.test.js`.
 *
 * 🛑 A STORED VERDICT OUTRANKS A LOW UI SCORE — measured, and it shaped this list. An obvious first
 * draft hid `/planner/personal-finances`, `/research/stock-investigation` and
 * `/planner/trading-styles`: all scored 1–2 out of 10, so they looked like candidates. The store
 * said `hide: false` for all three — the owner had **already decided** to keep them. A poor score
 * says "this page needs work"; an explicit "keep it" says "not by hiding it". **59 other nav views
 * carry `hide: false` too**, so this list was drawn strictly from the pages with NO verdict —
 * overruling a decision already made is how curation stops being trustworthy.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT HERE, so nobody "tidies" it in later:
 * - `/lab/backtest*` (Backtest Strategies, Data, Completed Runs) — the primary coder owns that area.
 * - Positions, bots, signals, scoring ladders, the META.Stack views and all settings except the
 *   duplicate Education entry: these are how the app is actually driven, and hiding them would make
 *   a new user's first session useless rather than focused.
 *
 * ⚠️ AN EXPLICIT `hide: false` ALWAYS WINS. Hiding must not be a one-way door: if someone wants one
 * of these back, the walkthrough says so and this list must not overrule it.
 */
export const DEFAULT_HIDDEN_ROUTES = new Set([
  // ── Pack 1: the design-system guide (9 pages, none ever scored) ────────────────────────────────
  // A style reference is a maintainer's tool, not a trader's. Nine sidebar entries describing our
  // own CSS were the single largest block of noise in the nav, and they are the least risky pack to
  // hold back — no behaviour, no data, nothing a first-run user can break.
  '/appearance/layout-guide',
  '/appearance/patterns',
  '/appearance/info',
  '/appearance/colour',
  '/appearance/surfaces',
  '/appearance/data-display',
  '/appearance/interactive',
  '/appearance/motion',
  '/appearance/forms',

  // ── Pack 2: Lab experiments (3 pages, scored 2–4) ──────────────────────────────────────────────
  // Snapshots / replay / chart scratchpad are investigative tools whose output is a picture, not a
  // decision. Kept out of the Lab rail so what remains reads as the backtesting suite it mostly is.
  '/lab/charts-lab',
  '/lab/snapshots',
  '/lab/snapshot-replay',

  // ── Pack 3: overlaps and plumbing (4 pages) ────────────────────────────────────────────────────
  // `/settings/settings-education` is the SAME "Education Settings" page as the `/education` entry —
  // one label in two sidebar homes. ⚠️ It is spelled as a full ROUTE for a reason: keying on the id
  // alone would also hide `/education/settings-education`, which is the copy that stays.
  '/settings/settings-education',
  '/protocols/protocol-queue',   // overlays the protocol views above it
  '/status/scheduled-jobs',      // scheduler plumbing
  '/research/daily-briefing',    // restates a summary the pages below it already give

  // ── Pack 4: internal development views (4 pages) ──────────────────────────────────────────────
  // Diagnostics we use to build the thing. Genuinely useful to the owner, meaningless to a first-run
  // user, and perfectly reversible — the Page Walkthrough still lists them and unhides in one click.
  '/development/identity-map',
  '/development/design-observations',
  '/development/performance-change',
  '/development/blocked-signals',

  // ── Already decided by the owner (not part of the 20) ─────────────────────────────────────────
  // `hide: true` in the walkthrough. Present here so a FRESH INSTALL matches his machine rather than
  // silently showing a page he has already withheld.
  '/trading/calculators',
]);

/**
 * The effective withheld set: defaults, plus `hide: true`, minus any explicit `hide: false`.
 *
 * ⚠️ KEYED BY ROUTE, NOT VIEW ID (changed 2026-11-01). An id is only the last path segment, so
 * `/settings/settings-education` and `/education/settings-education` share one. Hiding "the duplicate"
 * by id removed BOTH — a silent, wrong-scope change that the owner would only find by noticing a page
 * had gone missing. The store was already keyed by route; this makes the consumer agree with it.
 *
 * ⚠️ It FAILS OPEN. An absent or unreadable payload yields just the defaults — which are still the
 * curated decision — rather than an empty set or an error. Hiding is curation, not a gate.
 */
export function resolveHiddenRoutes(reviewConfig) {
  const routes = new Set(DEFAULT_HIDDEN_ROUTES);
  const explicitlyShown = new Set();
  const entries = reviewConfig?.entries || {};
  for (const [route, entry] of Object.entries(entries)) {
    const key = String(route).startsWith('/') ? String(route) : `/${route}`;
    if (entry?.hide === true) routes.add(key);
    else if (entry?.hide === false) explicitlyShown.add(key);
  }
  for (const route of explicitlyShown) routes.delete(route);
  return routes;
}

/** The withheld routes from a review-store payload: defaults merged with every `hide: true` entry. */
export function hiddenRoutesFrom(reviewConfig) {
  return resolveHiddenRoutes(reviewConfig);
}

/** True when an area still has at least one real (non-header) view. */
function areaHasViews(views) {
  return (views || []).some((v) => v.kind !== 'section-header');
}

/**
 * Filter the withheld routes out of a nav tree.
 *
 * Section headers left with nothing real after them are dropped, so hiding the last view of a
 * group cannot leave a dangling heading.
 */
export function filterHiddenViews(tree, hiddenRoutes) {
  if (!hiddenRoutes || hiddenRoutes.size === 0) return tree;
  const out = {};
  for (const [areaId, area] of Object.entries(tree)) {
    // ⚠️ TWO SHAPES, AND BOTH ARE LIVE — do not assume one. `NAV_TREE` is
    // `{ area: { label, views } }` (the top nav), but `getNavStructure()` is `{ area: [views] }`
    // (the left rail). Reading `area.views` on the ARRAY form yields `undefined`, so `kept` is
    // empty and every area is dropped — measured 2026-10-02: **14 areas in, 0 out**, i.e. the
    // whole navigation would vanish the moment a hide verdict existed.
    const isArray = Array.isArray(area);
    const views = isArray ? area : area?.views;
    if (!Array.isArray(views)) {
      // Unrecognised shape: pass it through UNTOUCHED. Hiding is a curation nicety; silently
      // deleting a structure we failed to parse is not a recoverable failure.
      out[areaId] = area;
      continue;
    }

    const kept = views.filter((v) => v.kind === 'section-header' || !hiddenRoutes.has(`/${areaId}/${v.id}`));
    const cleaned = [];
    for (let i = 0; i < kept.length; i++) {
      const v = kept[i];
      if (v.kind === 'section-header') {
        // ⚠️ THE GROUP ENDS AT THE NEXT HEADER, NOT AT THE END OF THE LIST. Measured 2026-11-01:
        // this check used to ask "is there a real view anywhere after this header?", so
        // `[headerA, headerB, viewUnderB]` kept headerA even though its own group was now empty —
        // leaving a dangling heading, which is the exact thing the comment below promises to
        // prevent. Hiding the last view of one group produced it. `hidden-views.test.js` pins it.
        const nextHeader = kept.findIndex((x, j) => j > i && x.kind === 'section-header');
        const groupEnd = nextHeader === -1 ? kept.length : nextHeader;
        if (!kept.slice(i + 1, groupEnd).some((x) => x.kind !== 'section-header')) continue;
      }
      cleaned.push(v);
    }
    if (areaHasViews(cleaned)) out[areaId] = isArray ? cleaned : { ...area, views: cleaned };
  }
  return out;
}
