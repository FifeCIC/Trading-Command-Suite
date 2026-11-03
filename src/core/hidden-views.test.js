/**
 * hidden-views.test.js — guards for the withheld-pages curation.
 *
 * ⚠️ WHY THIS EXISTS. `DEFAULT_HIDDEN_ROUTES` decides what a NEW user sees first, and four ways it
 * can go wrong are all silent:
 *   1. an explicit `hide: false` stops working, so a restored page can never be recovered;
 *   2. a route in the list is not a nav entry, so "hiding" it does nothing at all;
 *   3. keying drifts back to view ids, so hiding one page removes its same-named twin;
 *   4. withholding empties an area, which deletes a whole section from the sidebar.
 * None of them throws and none logs — the navigation just quietly has the wrong shape. Each is
 * asserted here in the direction that would fail.
 *
 * Run: node --test src/core/hidden-views.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HIDDEN_ROUTES,
  resolveHiddenRoutes,
  hiddenRoutesFrom,
  filterHiddenViews,
  filterByExperience,
  recordedVisibility,
  effectiveVisibility,
  resolveAccess,
  VISIBILITY,
} from './hidden-views.js';
import { NAV_TREE, getNavStructure } from './nav-tree.js';

/** Every route navigation can actually offer — `/{area}/{id}`, per App.jsx:503. */
function navRoutes() {
  const routes = new Set();
  for (const [area, a] of Object.entries(NAV_TREE)) {
    for (const v of (Array.isArray(a) ? a : a.views) || []) {
      if (v.id && v.kind !== 'section-header') routes.add(`/${area}/${v.id}`);
    }
  }
  return routes;
}

test('a fresh install withholds the curated set even with no stored verdicts', () => {
  // The whole point of the change: a new user meets the curation, not an empty store.
  const routes = resolveHiddenRoutes(null);
  assert.equal(routes.size, DEFAULT_HIDDEN_ROUTES.size);
  for (const route of DEFAULT_HIDDEN_ROUTES) assert.ok(routes.has(route), `default "${route}" missing`);
});

test('every withheld route is a REAL nav entry — an inert route is a silent no-op', () => {
  // ⚠️ THE GUARD FOR THE ACTUAL 2026-11-01 DEFECT. Eight of the owner's nine stored `hide: true`
  // verdicts pointed at detail routes with no nav entry, so the filter could never match them and
  // the curation did nothing — with no error anywhere.
  const routes = navRoutes();
  assert.ok(routes.size > 50, `expected a populated nav tree, got ${routes.size} routes`);
  for (const route of DEFAULT_HIDDEN_ROUTES) {
    assert.ok(routes.has(route), `"${route}" is in DEFAULT_HIDDEN_ROUTES but is not a nav entry`);
  }
});

test('withholding does not empty any area — a vanished area is a deleted section', () => {
  const before = Object.keys(getNavStructure());
  const after = Object.keys(filterHiddenViews(getNavStructure(), resolveHiddenRoutes(null)));
  const lost = before.filter((area) => !after.includes(area));
  assert.deepEqual(lost, [], `areas emptied entirely: ${lost.join(', ')}`);
});

test('the duplicate-id trap: hiding /settings/settings-education leaves the /education copy', () => {
  // Keyed by id this hid BOTH, because both end in "settings-education". Keyed by route, one goes.
  const tree = {
    education: [{ id: 'settings-education' }],
    settings: [{ id: 'settings-education' }, { id: 'trading-settings' }],
  };
  const out = filterHiddenViews(tree, new Set(['/settings/settings-education']));
  assert.deepEqual(out.education.map((v) => v.id), ['settings-education'], '/education copy must survive');
  assert.deepEqual(out.settings.map((v) => v.id), ['trading-settings']);
});

test('hide: true adds a route to the withheld set', () => {
  const routes = resolveHiddenRoutes({ entries: { '/lab/timeline': { hide: true } } });
  assert.ok(routes.has('/lab/timeline'));
  assert.ok(routes.has('/appearance/forms'), 'defaults must survive a store read');
});

test('an explicit hide: false overrides a default — hiding is not a one-way door', () => {
  const routes = resolveHiddenRoutes({ entries: { '/trading/calculators': { hide: false } } });
  assert.equal(routes.has('/trading/calculators'), false, 'explicit show must beat the default');
});

test('hide: null means "undecided" and does NOT resurrect a default', () => {
  const routes = resolveHiddenRoutes({ entries: { '/trading/calculators': { hide: null } } });
  assert.ok(routes.has('/trading/calculators'));
});

test('a route stored without a leading slash is still matched', () => {
  const routes = resolveHiddenRoutes({ entries: { 'lab/timeline': { hide: true } } });
  assert.ok(routes.has('/lab/timeline'));
});

test('garbage payloads fail open to the defaults rather than to an empty set', () => {
  for (const payload of [undefined, null, {}, { entries: null }, { entries: 'nope' }]) {
    assert.equal(resolveHiddenRoutes(payload).size, DEFAULT_HIDDEN_ROUTES.size);
  }
});

test('filters an ARRAY-shaped tree (the left rail) without emptying it', () => {
  // Measured 2026-10-02: reading `area.views` on the array form dropped ALL 14 areas.
  const tree = { trading: [{ id: 'calculators', kind: 'view' }, { id: 'positions', kind: 'view' }] };
  const out = filterHiddenViews(tree, new Set(['/trading/calculators']));
  assert.deepEqual(out.trading.map((v) => v.id), ['positions']);
});

test('filters an OBJECT-shaped tree (the top nav) and keeps the area metadata', () => {
  const tree = { trading: { label: 'Trading', views: [{ id: 'calculators' }, { id: 'positions' }] } };
  const out = filterHiddenViews(tree, new Set(['/trading/calculators']));
  assert.equal(out.trading.label, 'Trading');
  assert.deepEqual(out.trading.views.map((v) => v.id), ['positions']);
});

test('a section header with nothing left after it is dropped, not left dangling', () => {
  const tree = {
    area: [
      { id: 'h1', kind: 'section-header' },
      { id: 'only', kind: 'view' },
      { id: 'h2', kind: 'section-header' },
      { id: 'kept', kind: 'view' },
    ],
  };
  const out = filterHiddenViews(tree, new Set(['/area/only']));
  assert.deepEqual(out.area.map((v) => v.id), ['h2', 'kept']);
});

test('an area whose every view is withheld is removed entirely', () => {
  const tree = { gone: [{ id: 'a' }], stays: [{ id: 'b' }] };
  const out = filterHiddenViews(tree, new Set(['/gone/a']));
  assert.deepEqual(Object.keys(out), ['stays']);
});

test('an empty withheld set returns the tree untouched (no accidental rebuild)', () => {
  const tree = { a: [{ id: 'x' }] };
  assert.equal(filterHiddenViews(tree, new Set()), tree);
});

test('hiddenRoutesFrom is the store-facing alias and returns routes', () => {
  assert.ok(hiddenRoutesFrom({ entries: { '/lab/timeline': { hide: true } } }).has('/lab/timeline'));
});

// ── EXPERIENCE LEVEL: the third reason a view is absent ────────────────────────────────────────

test('a beginner loses the views the matrix marks beginner:false', () => {
  const tree = { scoring: [{ id: 'live-ordering-stack' }, { id: 'symbols-ladder' }] };
  const out = filterByExperience(tree, 'beginner');
  assert.deepEqual(out.scoring.map((v) => v.id), ['symbols-ladder']);
});

test('an expert loses nothing, and gets the SAME object back', () => {
  // Identity matters: a fresh object with identical contents re-triggers every consumer's memo.
  const tree = { scoring: [{ id: 'live-ordering-stack' }] };
  assert.equal(filterByExperience(tree, 'expert'), tree);
});

test('an undeclared view stays visible at every level — the matrix covers 39 of 108', () => {
  const tree = { misc: [{ id: 'a-view-nobody-classified' }] };
  for (const level of ['beginner', 'experienced', 'expert']) {
    assert.deepEqual(filterByExperience(tree, level).misc.map((v) => v.id), ['a-view-nobody-classified']);
  }
});

test('an unknown or missing level is a no-op rather than a blanket hide', () => {
  const tree = { scoring: [{ id: 'live-ordering-stack' }] };
  assert.equal(filterByExperience(tree, 'wizard'), tree);
  assert.equal(filterByExperience(tree, undefined), tree);
});

test('the LEVEL filter does not empty any real area', () => {
  // A level that removed an entire area would delete a navigation section for a beginner.
  const before = Object.keys(getNavStructure());
  const after = Object.keys(filterByExperience(getNavStructure(), 'beginner'));
  const lost = before.filter((area) => !after.includes(area));
  assert.deepEqual(lost, [], `areas emptied by the beginner level: ${lost.join(', ')}`);
});

test('the two filters compose: withheld AND too-advanced both disappear', () => {
  const tree = { scoring: [{ id: 'live-ordering-stack' }, { id: 'symbols-ladder' }] };
  const out = filterByExperience(filterHiddenViews(tree, new Set(['/scoring/symbols-ladder'])), 'beginner');
  assert.deepEqual(out.scoring ?? [], []);
});

// ── VISIBILITY: three states, one filter ────────────────────────────────────────────────────────

test('legacy hide verdicts still resolve — the owner has 60+ of them', () => {
  // ⚠️ A FORMAT CHANGE MUST NOT DESTROY REAL CURATION. `hide: false` is an explicit KEEP.
  assert.equal(recordedVisibility({ entries: { '/a/b': { hide: true } } }, '/a/b'), VISIBILITY.WITHHELD);
  assert.equal(recordedVisibility({ entries: { '/a/b': { hide: false } } }, '/a/b'), VISIBILITY.PUBLIC);
  assert.equal(recordedVisibility({ entries: { '/a/b': { hide: null } } }, '/a/b'), null);
});

test('an explicit visibility wins over a stale hide value', () => {
  const cfg = { entries: { '/lab/x': { hide: true, visibility: 'member' } } };
  assert.equal(recordedVisibility(cfg, '/lab/x'), VISIBILITY.MEMBER);
});

test('undecided is not public when the route is in the curated withheld set', () => {
  assert.equal(effectiveVisibility(null, '/appearance/forms'), VISIBILITY.WITHHELD);
  assert.equal(effectiveVisibility(null, '/signals/signals-overview'), VISIBILITY.PUBLIC);
});

test('member routes are hidden from the nav without an entitlement, shown with one', () => {
  const cfg = { entries: { '/lab/backtest': { visibility: 'member' } } };
  assert.ok(resolveAccess(cfg).hidden.has('/lab/backtest'), 'no entitlement -> hidden');
  assert.equal(resolveAccess(cfg, new Set(['/lab/backtest'])).hidden.has('/lab/backtest'), false, 'entitled -> visible');
});

test('member and withheld are counted separately — a perk is not a defect', () => {
  const cfg = {
    entries: {
      '/lab/backtest': { visibility: 'member' },
      '/lab/charts-lab': { visibility: 'withheld' },
      '/signals/signals-overview': { visibility: 'public' },
    },
  };
  const { withheld, member } = resolveAccess(cfg);
  assert.ok(member.has('/lab/backtest'));
  assert.equal(withheld.has('/lab/backtest'), false);
  assert.ok(withheld.has('/lab/charts-lab'));
  assert.equal(member.has('/lab/charts-lab'), false);
});

test('switching a route member -> public removes it from both sets', () => {
  const cfg = { entries: { '/trading/calculators': { visibility: 'public' } } };
  const { withheld, member, hidden } = resolveAccess(cfg);
  assert.equal(withheld.has('/trading/calculators'), false, 'public must beat the curated default');
  assert.equal(member.has('/trading/calculators'), false);
  assert.equal(hidden.has('/trading/calculators'), false);
});

test('switching a route public -> withheld beats an explicit keep', () => {
  const cfg = { entries: { '/research/screener': { hide: false, visibility: 'withheld' } } };
  assert.ok(resolveAccess(cfg).hidden.has('/research/screener'));
});
