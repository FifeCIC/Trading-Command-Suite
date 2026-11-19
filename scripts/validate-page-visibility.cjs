/**
 * © 2026 Ryan Bayne / FifeCIC · AGPL-3.0 · https://github.com/FifeCIC/Trading-Command-Suite
 *
 * validate-page-visibility.cjs — a NEW page is withheld from other users by default, and the build says so.
 * ======================================================================================================
 *
 * Requirement (2026-11-18): this new page should be set as hidden from other users among the other pages that
 * are only seen on my system. Can we set a rule for any new pages to default to that state.
 *
 * ⚠️ THE RULE EXISTED AS PROSE AND NOTHING CHECKED IT. `hidden-views.js` has said since 2026-11-01 that
 * *"moving an id OUT of this list IS the release"* — but nothing ever noticed a page added and never put
 * IN. The failure is silent in the worst direction: a half-built page becomes publicly visible the moment
 * its nav entry lands, and only the project's memory can prevent it.
 *
 * ── THE MECHANISM, AND WHY IT IS A RATCHET ────────────────────────────────────────────────────────
 * `scripts/page-visibility-baseline.json` records the nav routes that existed when the rule was
 * introduced. Those grandfathered routes keep whatever decision was already made for them.
 *
 *   • A route IN the baseline        → not this check's business.
 *   • A route NOT in the baseline    → MUST be in `DEFAULT_HIDDEN_ROUTES`, or this fails.
 *
 * ⚠️ `--write` MAY ONLY SHRINK THE BASELINE. Its single job is to prune routes that no longer exist in
 * the nav. If it would have to ADD one, it refuses: adding a new page to the baseline is exactly the dodge
 * the rule exists to prevent, and a dodge the tool performs is worse than one a person performs, because
 * nobody reviews a passing build.
 *
 * ── WHY A FILE AND NOT A DATE ──
 * "Anything after 2026-11-18" needs the creation time of a nav entry, which the tree does not record;
 * git blame would give a different answer under a squash. A frozen list is the thing itself.
 *
 * ── USAGE ──
 *   node scripts/validate-page-visibility.cjs              # gate: exit 1 on a new, unwithheld page
 *   node scripts/validate-page-visibility.cjs --report     # every nav route, and who decided it
 *   node scripts/validate-page-visibility.cjs --write      # prune stale baseline entries only
 *   node scripts/validate-page-visibility.cjs --self-test  # prove every rule can fail
 *
 * ⚠️ IT ERRORS WHEN IT CANNOT READ ITS INPUT — exit 2, never 0. A check that inspects nothing and reports
 * OK is worse than no check, and this repo has paid for that specific mistake more than once.
 *
 * ⚠️ COMMONJS ON PURPOSE. `nav-tree.js` and `hidden-views.js` are ESM with no side effects, so they are
 * loaded with `await import()` from here. Writing this as ESM would have been tidier but every other
 * validator in `scripts/` is `.cjs`, and one file with a different extension is one file whose invocation
 * a reader has to remember.
 */

const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(ROOT, 'scripts', 'page-visibility-baseline.json');

/**
 * classify() — the whole rule as a pure function, so `--self-test` can prove it fails.
 *
 * @param {string[]} navRoutes every `/{area}/{id}` in the navigation tree
 * @param {Set<string>|string[]} withheld routes in DEFAULT_HIDDEN_ROUTES
 * @param {string[]} baseline routes that predate the rule
 * @returns {{missing: string[], stale: string[]}}
 *   `missing` — new routes NOT withheld. This is the failure.
 *   `stale`   — baseline entries no longer in the nav. Reported; `--write` prunes them.
 */
function classify(navRoutes, withheld, baseline) {
  const hidden = withheld instanceof Set ? withheld : new Set(withheld || []);
  const known = new Set(baseline || []);
  const nav = new Set(navRoutes || []);

  const missing = [];
  for (const route of nav) if (!known.has(route) && !hidden.has(route)) missing.push(route);
  const stale = [...known].filter((r) => !nav.has(r));

  return { missing: missing.sort(), stale: stale.sort() };
}

/** Every `/{area}/{id}` a user can reach from the sidebar. Section headers are not routes. */
function navRoutesFrom(tree) {
  const routes = [];
  for (const [areaId, area] of Object.entries(tree || {})) {
    if (area?.hidden === true) continue;
    for (const view of area?.views || []) {
      if (!view || view.kind === 'section-header' || !view.id) continue;
      routes.push(`/${areaId}/${view.id}`);
    }
  }
  return routes;
}

async function loadInputs() {
  const navUrl = pathToFileURL(path.join(ROOT, 'src', 'core', 'nav-tree.js')).href;
  const hiddenUrl = pathToFileURL(path.join(ROOT, 'src', 'core', 'hidden-views.js')).href;
  const nav = await import(navUrl);
  const hiddenViews = await import(hiddenUrl);
  if (!nav.NAV_TREE) throw new Error('nav-tree.js did not export NAV_TREE');
  if (!hiddenViews.DEFAULT_HIDDEN_ROUTES) throw new Error('hidden-views.js did not export DEFAULT_HIDDEN_ROUTES');
  return { routes: navRoutesFrom(nav.NAV_TREE), withheld: hiddenViews.DEFAULT_HIDDEN_ROUTES };
}

function loadBaseline() {
  let raw;
  try {
    raw = readFileSync(BASELINE, 'utf8');
  } catch {
    throw new Error(`baseline not readable: ${BASELINE}`);
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.routes)) throw new Error('baseline must be { "routes": [...] }');
  return parsed;
}

const ADVICE = [
  '',
  '  A new page is withheld from other users by default. Add its route to',
  '  DEFAULT_HIDDEN_ROUTES in src/core/hidden-views.js:',
  '',
  "      '/area/view-id',",
  '',
  '  Releasing a page later is a deliberate line REMOVED from that list — that IS the release.',
  '  ⚠️ Do NOT add the route to scripts/page-visibility-baseline.json: that file records pages that',
  '  existed before this rule, and --write refuses to extend it for exactly this reason.',
  '',
];

async function main(argv) {
  const report = argv.includes('--report');
  const write = argv.includes('--write');

  if (argv.includes('--help')) {
    console.log('validate-page-visibility [--report|--write|--self-test|--help]');
    return 0;
  }

  let inputs;
  let baseline;
  try {
    inputs = await loadInputs();
    baseline = loadBaseline();
  } catch (err) {
    console.error(`[page-visibility] ✖ CANNOT JUDGE — ${err.message}`);
    return 2;
  }

  const { routes, withheld } = inputs;
  const { missing, stale } = classify(routes, withheld, baseline.routes);

  if (report) {
    for (const route of [...routes].sort()) {
      const state = withheld.has(route) ? 'WITHHELD' : 'public';
      const age = baseline.routes.includes(route) ? 'pre-rule' : 'NEW';
      console.log(`  ${state.padEnd(9)} ${age.padEnd(8)} ${route}`);
    }
    console.log(`\n  ${routes.length} nav route(s) · ${withheld.size} withheld · ${baseline.routes.length} in baseline`);
    if (stale.length) console.log(`  ${stale.length} stale baseline entr(ies): ${stale.join(', ')}`);
    if (missing.length) console.log(`  ${missing.length} NEW route(s) not withheld: ${missing.join(', ')}`);
    return missing.length ? 1 : 0;
  }

  if (write) {
    // ⚠️ REFUSES TO ADD. Pruning is maintenance; adding is the dodge.
    if (missing.length) {
      console.error(`[page-visibility] ✖ REFUSING to write — ${missing.length} new route(s) are not withheld:`);
      for (const r of missing) console.error(`      ${r}`);
      console.error(ADVICE.join('\n'));
      return 2;
    }
    const kept = [...baseline.routes].filter((r) => !stale.includes(r)).sort();
    writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, routes: kept }, null, 2)}\n`);
    console.log(`[page-visibility] wrote baseline: ${baseline.routes.length} → ${kept.length} route(s)`);
    if (stale.length) console.log(`  pruned: ${stale.join(', ')}`);
    return 0;
  }

  if (missing.length) {
    console.error(`[page-visibility] ✖ ${missing.length} new page(s) are NOT withheld from other users:`);
    for (const r of missing) console.error(`      ${r}`);
    console.error(ADVICE.join('\n'));
    return 1;
  }

  if (stale.length) {
    console.log(`[page-visibility] ⚠️ ${stale.length} stale baseline entr(ies) — run --write to prune:`);
    for (const r of stale) console.log(`      ${r}`);
  }

  console.log(`[page-visibility] ✅ OK — ${routes.length} nav route(s); ${withheld.size} withheld; every route added since the rule is withheld.`);
  return 0;
}

// ── self-test ────────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0;
  let fail = 0;
  const t = (name, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ✖ ${name}\n      expected ${e}\n      actual   ${a}`); }
  };

  t('a new route that IS withheld is fine',
    classify(['/a/x'], ['/a/x'], []).missing, []);

  // ⚠️ THE CASE THE FILE EXISTS FOR.
  t('a new route that is NOT withheld is reported',
    classify(['/a/x'], [], []).missing, ['/a/x']);

  t('a pre-rule route needs no decision',
    classify(['/a/x'], [], ['/a/x']).missing, []);

  t('a baseline entry with no nav entry is stale',
    classify(['/a/x'], [], ['/a/x', '/gone/route']).stale, ['/gone/route']);

  t('missing and stale are reported together',
    classify(['/a/x', '/b/new'], [], ['/a/x', '/gone/route']),
    { missing: ['/b/new'], stale: ['/gone/route'] });

  t('one withheld new route does not cover a second',
    classify(['/b/new', '/c/other'], ['/b/new'], []).missing, ['/c/other']);

  t('a hidden area contributes no routes',
    navRoutesFrom({ a: { views: [{ id: 'x' }] }, b: { hidden: true, views: [{ id: 'y' }] } }),
    ['/a/x']);

  t('section headers are not routes',
    navRoutesFrom({ a: { views: [{ kind: 'section-header', id: 'h' }, { id: 'x' }] } }),
    ['/a/x']);

  t('junk nav input is an empty list, never a throw', navRoutesFrom(null), []);

  console.log(`\n[page-visibility] ${pass}/${pass + fail} self-test cases passed`);
  return fail === 0 ? 0 : 1;
}

module.exports = { classify, navRoutesFrom };

if (process.argv[1] && /validate-page-visibility\.cjs$/.test(process.argv[1])) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    process.exit(selfTest());
  } else {
    main(argv)
      .then((code) => process.exit(code))
      .catch((err) => {
        console.error(`[page-visibility] ✖ CANNOT JUDGE — ${err.message}`);
        process.exit(2);
      });
  }
}
