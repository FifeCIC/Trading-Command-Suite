/**
 * © 2026 Ryan Bayne / FifeCIC · AGPL-3.0 · https://github.com/FifeCIC/Trading-Command-Suite
 *
 * hidden-views.js — the owner's "hide now" verdicts, applied to navigation.
 * ========================================================================
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

// ⚠️ A one-way dependency: hidden-views -> experience-levels. `experience-levels.js` imports nothing,
// so this cannot become a cycle — which matters, because the nav is on the render path of every page.
import { EXPERIENCE_LEVELS, isNavVisible } from './experience-levels.js';

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

  // ── Pack 5: too weak to show, kept for the owner to finish (2026-11-06) ───────────────────────
  // Owner, Research walkthrough: hide these *from other users* while they are still being worked on.
  // Earnings Whispers is also on the extensions list (Discord-style posting is the other one), so it
  // is withheld as a future release rather than a reject. Stock Investigation and Recently Analysed
  // were withheld as "too weak". Nothing is deleted: the routes still resolve by URL.
  '/research/earnings-whispers',
  '/research/stock-investigation',
  '/research/recently-analysed-symbols',

  // ── Pack 6: withheld for public release (2026-11-07) ──────────────────────────────────────────
  // Owner, Scoring walkthrough: *"A/B Ladder (/scoring/ab-ladder) will be hidden from public"*. Kept
  // for the owner (amber in the rail) while the A/B comparison story is finished.
  '/scoring/ab-ladder',
]);

/**
 * OWNER_SEES_WITHHELD — the curator switch for `filterHiddenViews`.
 *
 * Owner, 2026-11-06: *"Reminder that hiding pages is for other users only and I want to be able to
 * see them."* Before this constant, `DEFAULT_HIDDEN_ROUTES` removed the entry from HIS rail too, so
 * every "hide" also hid the page from the person deciding it needed work.
 *
 * ⚠️ IT IS `true` FOR EVERYONE RIGHT NOW, and that is a KNOWN, TEMPORARY gap rather than a design:
 * the app is pre-release with a single user, and there is no entitlement that can tell the owner
 * apart from a new user. Wiring this to `true` is what lets him see the unfinished pages; the price
 * is that a second user would see them as well. **This must become an entitlement check before the
 * app is offered to anyone else** — filed as an issue rather than left as a comment nobody reads.
 */
export const OWNER_SEES_WITHHELD = true;

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
 *
 * ⚠️ MEMBER-ONLY ROUTES ARE FOLDED IN when `entitledRoutes` does not contain them. The nav only ever
 * asks one question — "may this be in the sidebar right now?" — so withheld and not-yet-entitled
 * member pages can travel through the SAME filter. One implementation, one place to be wrong.
 */
export function resolveHiddenRoutes(reviewConfig, entitledRoutes) {
  return resolveAccess(reviewConfig, entitledRoutes).hidden;
}

/** The withheld routes from a review-store payload: defaults merged with every verdict. */
export function hiddenRoutesFrom(reviewConfig) {
  return resolveHiddenRoutes(reviewConfig);
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// VISIBILITY — three states, not one bit.
//
// ⚠️ WHY THE BOOLEAN HAD TO GO (owner direction, 2026-11-02). "Should we delete this page?" and
// "is this page a member perk?" are different questions, and `hide: true` answered both with one
// bit. That is how an unfinished page gets shipped as a paid feature: the intent is recorded as
// "hidden", the reason is lost, and later nobody can tell a broken page from a business decision.
//
//   withheld — built but NOT READY. Nobody should see it this release.
//   member   — built, WORKING, and deliberately behind an entitlement.
//   public   — visible to everyone (the default).
//
// ⚠️ `hide` IS STILL READ AS A FALLBACK, on purpose. The owner has 60-odd stored verdicts; silently
// dropping them because the field moved would lose real curation, and "hide: true" maps cleanly
// onto "withheld". New writes use `visibility` only.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** The three visibility states a page can be in. */
export const VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  MEMBER: 'member',
  WITHHELD: 'withheld',
});

const VISIBILITY_VALUES = new Set(Object.values(VISIBILITY));

/** Normalise a store key to a leading-slash route, so `lab/x` and `/lab/x` are one thing. */
function routeKey(route) {
  const s = String(route);
  return s.startsWith('/') ? s : `/${s}`;
}

/**
 * Map ONE stored entry to a visibility, or null when undecided.
 *
 * ⚠️ Extracted 2026-11-02 because two callers needed it and they disagreed. `recordedVisibility`
 * looks an entry up by normalised route while `resolveAccess` iterates the raw keys, and a store key
 * saved without a leading slash (`lab/x`) matched in one and not the other — the verdict vanished
 * silently. One mapping function means the two can no longer drift.
 */
function visibilityFromEntry(entry) {
  if (!entry) return null;
  if (VISIBILITY_VALUES.has(entry.visibility)) return entry.visibility;
  // Legacy boolean. `hide: false` is an explicit KEEP, which is `public`.
  if (entry.hide === true) return VISIBILITY.WITHHELD;
  if (entry.hide === false) return VISIBILITY.PUBLIC;
  return null;
}

/** The visibility recorded for ONE route, or null when nobody has decided yet. */
export function recordedVisibility(reviewConfig, route) {
  return visibilityFromEntry(reviewConfig?.entries?.[routeKey(route)]);
}

/**
 * The effective visibility for ONE route, applying the curated defaults to undecided pages.
 *
 * ⚠️ "Undecided" is not "public". A route in `DEFAULT_HIDDEN_ROUTES` that nobody has ruled on is
 * withheld; everything else undecided is public. That is what makes a fresh install match the
 * curation without needing a store row for all ~130 pages.
 */
export function effectiveVisibility(reviewConfig, route) {
  return recordedVisibility(reviewConfig, route)
    || (DEFAULT_HIDDEN_ROUTES.has(routeKey(route)) ? VISIBILITY.WITHHELD : VISIBILITY.PUBLIC);
}

/**
 * Split the store into what is withheld and what is member-only.
 *
 * `hidden` folds member routes in when there is no entitlement for them — so a single call to
 * `filterHiddenViews` still answers "may this be in the navigation right now?", which is the only
 * question the nav asks. One filter, one implementation (see `filterHiddenViews`).
 */
export function resolveAccess(reviewConfig, entitledRoutes) {
  const withheld = new Set(DEFAULT_HIDDEN_ROUTES);
  const member = new Set();
  for (const [raw, entry] of Object.entries(reviewConfig?.entries || {})) {
    const key = routeKey(raw);
    const v = visibilityFromEntry(entry);
    if (v === VISIBILITY.WITHHELD) { withheld.add(key); member.delete(key); }
    else if (v === VISIBILITY.MEMBER) { withheld.delete(key); member.add(key); }
    else if (v === VISIBILITY.PUBLIC) { withheld.delete(key); member.delete(key); }
  }
  const hidden = new Set(withheld);
  for (const route of member) if (!entitledRoutes?.has(route)) hidden.add(route);
  return { withheld, member, hidden };
}

/** True when an area still has at least one real (non-header) view. */
function areaHasViews(views) {
  return (views || []).some((v) => v.kind !== 'section-header');
}

/**
 * Filter a nav tree by a predicate, preserving both shapes and never leaving a dangling header.
 *
 * ⚠️ ONE IMPLEMENTATION FOR EVERY "MAY THIS BE SHOWN?" RULE (2026-11-03). There are now three
 * reasons a view is absent from the sidebar — the owner withheld it, it is member-only and unentitled,
 * or it is too advanced for the reader's experience level — and the first two already travelled
 * through this function. A second copy for the third would drift: the array/object shape handling
 * below was once wrong and every area vanished (measured 2026-10-02, 14 in / 0 out).
 *
 * Returns the ORIGINAL tree when nothing is filtered, so a caller cannot trigger a needless re-render
 * by holding a fresh object that happens to contain the same views.
 */
function filterNavTree(tree, isHidden) {
  const out = {};
  let changed = false;
  for (const [areaId, area] of Object.entries(tree)) {
    // ⚠️ TWO SHAPES, AND BOTH ARE LIVE — do not assume one. `NAV_TREE` is
    // `{ area: { label, views } }` (the top nav), but `getNavStructure()` is `{ area: [views] }`
    // (the left rail). Reading `area.views` on the ARRAY form yields `undefined`, so `kept` is
    // empty and every area is dropped — measured 2026-10-02: **14 areas in, 0 out**.
    const isArray = Array.isArray(area);
    const views = isArray ? area : area?.views;
    if (!Array.isArray(views)) {
      // Unrecognised shape: pass it through UNTOUCHED. Hiding is a curation nicety; silently
      // deleting a structure we failed to parse is not a recoverable failure.
      out[areaId] = area;
      continue;
    }

    const kept = views.filter((v) => v.kind === 'section-header' || !isHidden(areaId, v));
    const cleaned = [];
    for (let i = 0; i < kept.length; i++) {
      const v = kept[i];
      if (v.kind === 'section-header') {
        // ⚠️ THE GROUP ENDS AT THE NEXT HEADER, NOT AT THE END OF THE LIST. Measured 2026-11-01:
        // this check used to ask "is there a real view anywhere after this header?", so
        // `[headerA, headerB, viewUnderB]` kept headerA even though its own group was now empty —
        // leaving a dangling heading, which is the exact thing the comment below promises to
        // prevent. `hidden-views.test.js` pins it.
        const nextHeader = kept.findIndex((x, j) => j > i && x.kind === 'section-header');
        const groupEnd = nextHeader === -1 ? kept.length : nextHeader;
        if (!kept.slice(i + 1, groupEnd).some((x) => x.kind !== 'section-header')) { changed = true; continue; }
      }
      cleaned.push(v);
    }
    if (cleaned.length !== views.length) changed = true;
    if (areaHasViews(cleaned)) out[areaId] = isArray ? cleaned : { ...area, views: cleaned };
    else changed = true;
  }
  return changed ? out : tree;
}

/**
 * Filter the withheld routes out of a nav tree.
 *
 * Section headers left with nothing real after them are dropped, so hiding the last view of a
 * group cannot leave a dangling heading.
 */
export function filterHiddenViews(tree, hiddenRoutes, { keepWithheld = false } = {}) {
  if (!hiddenRoutes || hiddenRoutes.size === 0) return tree;
  /* ⚠️ CURATOR MODE (owner, 2026-11-06): *"hiding pages is for other users only and I want to be able
     to see them"* … *"change the colour of the text in the menu for pages that will be hidden for
     other users so I know which ones still need work done to them."*
     So a withheld view is KEPT and TAGGED (`withheld: true`) rather than removed; the rail colours
     the tag. Nothing else about the tree changes. */
  if (keepWithheld) return tagWithheld(tree, hiddenRoutes);
  return filterNavTree(tree, (areaId, v) => hiddenRoutes.has(`/${areaId}/${v.id}`));
}

/**
 * tagWithheld(tree, hiddenRoutes) — same filtering, minus the deletion.
 *
 * Handles BOTH tree shapes for the same reason `filterNavTree` does: `NAV_TREE` is
 * `{ area: { label, views } }` (top nav) and `getNavStructure()` is `{ area: [views] }` (left rail).
 * An unrecognised shape passes through untouched, never deleted.
 */
function tagWithheld(tree, hiddenRoutes) {
  const out = {};
  for (const [areaId, area] of Object.entries(tree)) {
    const isArray = Array.isArray(area);
    const views = isArray ? area : area?.views;
    if (!Array.isArray(views)) { out[areaId] = area; continue; }
    const tagged = views.map((v) => (
      v.kind === 'section-header' ? v : { ...v, withheld: hiddenRoutes.has(`/${areaId}/${v.id}`) || undefined }
    ));
    out[areaId] = isArray ? tagged : { ...area, views: tagged };
  }
  return out;
}

/**
 * Hide the views the EXPERIENCE MATRIX marks as too advanced for this reader.
 *
 * ⚠️ WHY THIS EXISTS (2026-11-03). `EXPERIENCE_MATRIX.nav` has declared per-level visibility since
 * 2026-09, and **nothing has consumed it** since `getFilteredNavStructure()` was deleted on
 * 2026-09-23 because "nothing imported it". So the setting was written in three places and honoured
 * in none: a self-identified beginner was shown all 87 visible pages, including the deepest
 * diagnostics. This is the third answer to "may this be shown?" and it is the ONLY one that can
 * respect the owner's 71 explicit `hide: false` keeps while still giving a new user a short list.
 *
 * ⚠️ The matrix declares 39 of 108 views. Anything undeclared is VISIBLE at every level
 * (`isNavVisible` returns true) — so this cannot hide a page nobody classified.
 */
export function filterByExperience(tree, level) {
  if (!level || !EXPERIENCE_LEVELS.includes(level)) return tree;
  return filterNavTree(tree, (_areaId, v) => !isNavVisible(v.id, level));
}
