/**
 * Edition-aware navigation filtering (free spinoff — FREE-EDITION-PLAN.md §3).
 *
 * Page CODE is excluded at build time (src/editions/view-routes.free.jsx). This module stops
 * the sidebar (and anything else consuming the nav structure) from OFFERING premium views in
 * the free build. The full edition is untouched — every function is an identity there.
 *
 * Source of truth: the `tier` field in src/core/view-meta.js → generated free manifest.
 *
 * ⚠️ QUICK_MENU / PRIMARY_PAGES (nav-tree.js) are derived directly from the unfiltered tree
 * and currently have no consumers. If one appears, route it through
 * `filterNavStructureByEdition()` too, or the free build will link to absent pages.
 */
import { FREE_MANIFEST } from '../editions/free.manifest.js';

/** 'free' | 'full' — compile-time constant (vite.config define; default 'full'). */
export const APP_EDITION = import.meta.env.VITE_EDITION || 'full';

/** True when a nav leaf (`/${area}/${viewId}`) is allowed in this edition. */
export function editionAllowsView(areaId, viewId) {
  if (APP_EDITION !== 'free') return true;
  return FREE_MANIFEST.freeViews.includes(`/${areaId}/${viewId}`);
}

/** The hidden view IDS from a review-store payload: every entry whose `hide` is exactly true. */
export function hiddenViewIdsFrom(reviewConfig) {
  const ids = new Set();
  const entries = reviewConfig?.entries || {};
  for (const [route, entry] of Object.entries(entries)) {
    if (entry && entry.hide === true) ids.add(route.split('/').filter(Boolean).pop());
  }
  return ids;
}

/**
 * Filter the owner's "hide now" verdicts out of a nav tree.
 *
 * ⚠️ A SIBLING of the edition filter, not a new mechanism — both answer "may this be offered?", so
 * they run in the same place, edition first. Before this existed the review store's `hide` field was
 * read by NOTHING: the Page Walkthrough recorded the owner's verdicts and no code applied them.
 *
 * Section headers left with nothing real after them are dropped by the same rule the edition filter
 * uses, so hiding the last view of a group cannot leave a dangling heading.
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
export function editionAllowsKey(viewMetaKey) {
  if (APP_EDITION !== 'free') return true;
  return FREE_MANIFEST.freeViews.includes(viewMetaKey);
}

function filterViews(areaId, views) {
  const items = (views || []).filter(
    (v) => v.kind === 'section-header' || editionAllowsView(areaId, v.id),
  );
  const cleaned = [];
  for (let i = 0; i < items.length; i++) {
    const v = items[i];
    if (v.kind === 'section-header') {
      const hasRealAfter = items.slice(i + 1).some((x) => x.kind !== 'section-header');
      if (!hasRealAfter) continue;
    }
    cleaned.push(v);
  }
  return cleaned;
}

/** True when an area still has at least one real (non-header) view. */
function areaHasViews(views) {
  return (views || []).some((v) => v.kind !== 'section-header');
}

/**
 * Filter a `{ area: views[] }` structure for the current edition.
 * Free build: keeps allowed views; drops section headers with nothing real after them; drops
 * areas left with no views. Full build: returns the input unchanged.
 */
export function filterNavStructureByEdition(structure) {
  if (APP_EDITION !== 'free') return structure;
  const out = {};
  for (const [area, views] of Object.entries(structure)) {
    const cleaned = filterViews(area, views);
    if (areaHasViews(cleaned)) out[area] = cleaned;
  }
  return out;
}

/**
 * Filter the full `NAV_TREE` shape (`{ area: { label, views } }`) for the current edition.
 * Used by the top navigation bar, which enumerates NAV_TREE directly.
 */
export function filterNavTreeByEdition(tree) {
  if (APP_EDITION !== 'free') return tree;
  const out = {};
  for (const [areaId, area] of Object.entries(tree)) {
    const cleaned = filterViews(areaId, area.views);
    if (areaHasViews(cleaned)) out[areaId] = { ...area, views: cleaned };
  }
  return out;
}
