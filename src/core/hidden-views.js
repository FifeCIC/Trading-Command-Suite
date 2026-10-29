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
 * ⚠️ IT FAILS OPEN, DELIBERATELY. A failed or absent fetch yields an empty set, so nothing is
 * hidden. Hiding is a curation convenience, not a gate: if the store cannot be read, showing a page
 * the owner wanted hidden is recoverable, whereas hiding pages because a request failed is not.
 */

/** The hidden view IDs from a review-store payload: every entry whose `hide` is exactly true. */
export function hiddenViewIdsFrom(reviewConfig) {
  const ids = new Set();
  const entries = reviewConfig?.entries || {};
  for (const [route, entry] of Object.entries(entries)) {
    if (entry && entry.hide === true) ids.add(route.split('/').filter(Boolean).pop());
  }
  return ids;
}

/** True when an area still has at least one real (non-header) view. */
function areaHasViews(views) {
  return (views || []).some((v) => v.kind !== 'section-header');
}

/**
 * Filter the owner's "hide now" verdicts out of a nav tree.
 *
 * Section headers left with nothing real after them are dropped, so hiding the last view of a
 * group cannot leave a dangling heading.
 */
export function filterHiddenViews(tree, hiddenIds) {
  if (!hiddenIds || hiddenIds.size === 0) return tree;
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

    const kept = views.filter((v) => v.kind === 'section-header' || !hiddenIds.has(v.id));
    const cleaned = [];
    for (let i = 0; i < kept.length; i++) {
      const v = kept[i];
      if (v.kind === 'section-header') {
        if (!kept.slice(i + 1).some((x) => x.kind !== 'section-header')) continue;
      }
      cleaned.push(v);
    }
    if (areaHasViews(cleaned)) out[areaId] = isArray ? cleaned : { ...area, views: cleaned };
  }
  return out;
}
