/**
 * validate-route-reachability.cjs — a page nobody can reach is not a feature.
 *
 * ── THE DEFECT THIS CLOSES, MEASURED 2026-11-28 ─────────────────────────────────────────────────
 * The owner found `/trading/portfolio-overview` was **in no menu**, and asked what else had been
 * disconnected. Answer: **44 of 156 routes render and appear in NO menu and are NOT withheld** — and
 * **none of the existing checks could have noticed**, because both of them iterate the MENU:
 *
 *   · `validate-page-visibility.cjs` walks `nav-tree.js` and asks "is this nav route public?" — a page
 *     that was never added to the nav is not in its population, so it can be neither public nor withheld.
 *   · `verify-view-meta-routes.cjs` walks nav → `view-meta`, so it inherits the same blind spot.
 *
 * Both are correct for the question they ask. **Neither asks the question that matters here**: starting
 * from the FULL ROUTE TABLE and requiring every route to be reachable by some deliberate decision.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
 * **R1** — every route id in `view-routes.jsx` is ONE of:
 *         a) in a menu (`nav-tree.js`), or
 *         b) withheld (`hidden-views.js`), or
 *         c) declared URL-ONLY in `scripts/url-only-routes.json` with a `status`.
 *
 * A route in none of the three FAILS — that is a brand-new page nobody can find, which is the defect.
 * A declared route with `status: "unreviewed"` is REPORTED and does not fail; it is debt with a window
 * (`docs/debt-register.json` → `url-only-pages`), because 44 red lines from the day the check was
 * written is exactly the check that gets allowlisted.
 *
 * ⚠️ **URL-ONLY IS A LEGITIMATE STATE** — a detail page (`symbol`, `strategy-detail`) is reached by a
 * parameter, not a menu. The point is not "no page may be URL-only"; it is "no page may be URL-only
 * ACCIDENTALLY".
 *
 * Usage:
 *   node scripts/validate-route-reachability.cjs            # the gate
 *   node scripts/validate-route-reachability.cjs --report   # every route and how it is reached
 *   node scripts/validate-route-reachability.cjs --write    # add new unreachable routes as `unreviewed`
 *   node scripts/validate-route-reachability.cjs --self-test
 *
 * Exit: 0 = every route is reachable by a decision · 1 = a route in none of the three · 2 = could not judge.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ROUTES = path.join(ROOT, 'src', 'core', 'view-routes.jsx');
const NAV = path.join(ROOT, 'src', 'core', 'nav-tree.js');
const HIDDEN = path.join(ROOT, 'src', 'core', 'hidden-views.js');
const DECLARED = path.join(ROOT, 'scripts', 'url-only-routes.json');

/** Route ids from VIEW_COMPONENTS. Keys are quoted or bare — measured: both forms are in the file. */
function routeIds(text) {
  return [...new Set([...text.matchAll(/^\s*'?([a-z0-9-]+)'?:\s*[A-Z][A-Za-z0-9]*\s*,/gm)].map((m) => m[1]))];
}

/** Nav view ids. A nav entry is `{ id: 'x', label: … }`. */
function navIds(text) {
  return new Set([...text.matchAll(/\{\s*id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]));
}

/** Withheld view ids, read from full paths (`'/development/standards'`). */
function withheldIds(text) {
  return new Set([...text.matchAll(/'\/[a-z0-9-]+\/([a-z0-9-]+)'/g)].map((m) => m[1]));
}

/**
 * classify(routeIds, nav, withheld, declared) — PURE, so `--self-test` can drive every branch.
 *
 * @returns {{ unreachable: string[], unreviewed: string[], stale: string[] }}
 *   `stale` = declared URL-only but now in a menu (the declaration has been paid and must be removed —
 *   a ratchet whose slack is never reclaimed is a ratchet with a hole in it).
 */
function classify(routes, nav, withheld, declared) {
  const unreachable = [];
  const unreviewed = [];
  const stale = [];
  const declaredSet = new Set(Object.keys(declared || {}));
  for (const id of routes) {
    const inMenu = nav.has(id);
    if (inMenu) {
      if (declaredSet.has(id)) stale.push(id);
      continue;
    }
    if (withheld.has(id)) {
      if (declaredSet.has(id)) stale.push(id);
      continue;
    }
    if (declaredSet.has(id)) {
      if (declared[id]?.status === 'unreviewed') unreviewed.push(id);
      continue;
    }
    unreachable.push(id);
  }
  // A declaration naming a route that no longer exists is stale too — it hides a rename.
  for (const id of declaredSet) if (!routes.includes(id)) stale.push(id);
  return { unreachable: unreachable.sort(), unreviewed: unreviewed.sort(), stale: stale.sort() };
}

function selfTest() {
  let failures = 0;
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  const set = (...a) => new Set(a);
  const r = (out) => out;

  expect(
    'a route in a menu is reachable',
    classify(['a'], set('a'), set(), {}).unreachable,
    [],
  );
  expect(
    'a withheld route is reachable',
    classify(['a'], set(), set('a'), {}).unreachable,
    [],
  );
  expect(
    'a declared URL-only route is reachable',
    classify(['a'], set(), set(), { a: { status: 'url-only' } }).unreachable,
    [],
  );
  expect(
    '▶ CANARY — a route in NONE of the three is UNREACHABLE',
    classify(['a', 'b'], set('a'), set(), {}).unreachable,
    ['b'],
  );
  expect(
    'an unreviewed declaration is reported, not failed',
    classify(['a'], set(), set(), { a: { status: 'unreviewed' } }).unreviewed,
    ['a'],
  );
  expect(
    '▶ CANARY — a declaration for a route that is NOW in a menu is STALE, so the slack is reclaimed',
    classify(['a'], set('a'), set(), { a: { status: 'url-only' } }).stale,
    ['a'],
  );
  expect(
    '▶ CANARY — a declaration for a route that no longer exists is STALE',
    classify(['a'], set('a'), set(), { ghost: { status: 'url-only' } }).stale,
    ['ghost'],
  );
  expect('withheld beats a stale declaration check order', classify(['a'], set(), set('a'), {}).unreachable, []);

  console.log('');
  console.log(failures === 0 ? '✅ self-test: every branch reports, and all three staleness directions are observed' : `❌ self-test: ${failures} case(s) wrong`);
  return failures === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  const KNOWN = new Set(['--report', '--write', '--self-test', '--help']);
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--help')) {
    console.log('usage: node scripts/validate-route-reachability.cjs [--report] [--write] [--self-test]');
    return 0;
  }
  const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN.has(a));
  if (unknown.length) {
    console.error(`[reachability] ✖ unknown flag(s): ${unknown.join(', ')}`);
    return 2;
  }

  let routes, nav, withheld, declared;
  try {
    routes = routeIds(fs.readFileSync(ROUTES, 'utf8'));
    nav = navIds(fs.readFileSync(NAV, 'utf8'));
    withheld = withheldIds(fs.readFileSync(HIDDEN, 'utf8'));
    declared = fs.existsSync(DECLARED) ? JSON.parse(fs.readFileSync(DECLARED, 'utf8')).routes || {} : {};
  } catch (err) {
    console.error(`[reachability] ✖ could not judge: ${err.message}`);
    return 2;
  }
  if (!routes.length) {
    console.error('[reachability] ✖ read zero routes — the parser or the file changed shape. A check that reads nothing has checked nothing.');
    return 2;
  }

  const out = classify(routes, nav, withheld, declared);

  if (argv.includes('--write')) {
    const parsed = fs.existsSync(DECLARED) ? JSON.parse(fs.readFileSync(DECLARED, 'utf8')) : { routes: {} };
    parsed.routes = parsed.routes || {};
    let added = 0;
    for (const id of out.unreachable) {
      parsed.routes[id] = { status: 'unreviewed' };
      added += 1;
    }
    for (const id of out.stale) delete parsed.routes[id];
    fs.writeFileSync(DECLARED, `${JSON.stringify(parsed, null, 2)}\n`);
    console.log(`[reachability] wrote ${DECLARED.replace(ROOT, '.')} — ${added} added as unreviewed, ${out.stale.length} stale removed`);
    return 0;
  }

  if (argv.includes('--report')) {
    for (const id of [...routes].sort()) {
      const how = nav.has(id) ? 'menu' : withheld.has(id) ? 'withheld' : declared[id]?.status ?? 'UNREACHABLE';
      console.log(`  ${how === 'UNREACHABLE' ? '✖' : '·'} ${id.padEnd(28)} ${how}`);
    }
    console.log('');
  }

  console.log(
    `[reachability] ${routes.length} route(s): ${routes.filter((r) => nav.has(r)).length} in a menu · ` +
      `${routes.filter((r) => !nav.has(r) && withheld.has(r)).length} withheld · ` +
      `${Object.keys(declared).length} declared URL-only`,
  );
  if (out.unreviewed.length) {
    console.log(`  ⚠ ${out.unreviewed.length} declared URL-only but UNREVIEWED — nobody has decided whether that is right:`);
    console.log(`     ${out.unreviewed.join(', ')}`);
    console.log('     Recorded as debt in docs/debt-register.json (url-only-pages). Decide one by changing its');
    console.log('     `status` and adding a `reason`, or add it to a menu in src/core/nav-tree.js.');
  }
  if (out.stale.length) {
    console.log(`  ⚠ ${out.stale.length} stale declaration(s) — now in a menu, withheld, or gone. Run --write:`);
    console.log(`     ${out.stale.join(', ')}`);
    return 1;
  }
  if (out.unreachable.length) {
    for (const id of out.unreachable) {
      console.log(`  ✖ ${id} — renders at a route, appears in NO menu, is NOT withheld, and is NOT declared URL-only`);
    }
    console.log('[reachability] ✖ a page nobody can reach is not a feature. Add it to nav-tree, withhold it,');
    console.log('    or declare it URL-only with a reason (run --write to start, then fill the reason).');
    return 1;
  }
  console.log('[reachability] ✅ every route is reachable by a menu, a withholding, or a written decision');
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { classify, routeIds, navIds, withheldIds };
