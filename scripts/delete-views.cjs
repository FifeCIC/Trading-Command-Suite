#!/usr/bin/env node
'use strict';

/**
 * delete-views.cjs — remove views from the app in one pass.
 *
 * WHY THIS EXISTS
 * Deleting one view touches FIVE places (nav-tree, view-routes map + import, view-meta, the page
 * .jsx and its .css) plus a regeneration of the edition mirrors. Doing that by hand 21 times
 * produces exactly the failure this repo keeps re-finding: a page that compiles but is
 * unreachable, or a nav entry that outlives its route. The removals are mechanical and the file
 * shapes are regular, so they happen once, here, with assertions.
 *
 * ⚠️ A view that is NOT FOUND is an ERROR, never a silent skip. A remover that reports success
 * while removing nothing is the defect this script is most likely to have — so the search is
 * bounded and the bound is asserted, not assumed.
 *
 * USAGE
 *   node scripts/delete-views.cjs --routes /lab/timeline,/lab/allocator     # DRY RUN (default)
 *   node scripts/delete-views.cjs --routes ... --apply                      # write + delete files
 *   node scripts/delete-views.cjs --routes-from ./tmp/routes.txt --apply
 *   node scripts/delete-views.cjs --self-test
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = {
  meta: 'src/core/view-meta.js',
  routes: 'src/core/view-routes.jsx',
  nav: 'src/core/nav-tree.js',
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => s.replace(/\r\n/g, '\n');
const restore = (s, eol) => (eol === '\n' ? s : s.replace(/\n/g, eol));

// ─────────────────────────────────────────────────────────────────────────────
// Removers — pure string → result. Pure so the self-test can exercise them with
// fixtures instead of the real files.
// ─────────────────────────────────────────────────────────────────────────────

/** Remove `  '/path': { ... },` plus any comment block sitting directly above it. */
function removeMetaEntry(src, route) {
  const lines = norm(src).split('\n');
  const key = new RegExp("^  '" + esc(route) + "': \\{$");
  const start = lines.findIndex((l) => key.test(l));
  if (start === -1) return { ok: false, reason: 'view-meta entry not found' };

  // The entry ends at the first line that is EXACTLY two-space-indent `},`. A nested object
  // closes at a deeper indent, so it cannot be mistaken for the terminator.
  const LIMIT = 250;
  let end = -1;
  for (let i = start + 1; i < lines.length && i < start + LIMIT; i++) {
    if (lines[i] === '  },') { end = i; break; }
  }
  if (end === -1) {
    return { ok: false, reason: 'no two-space terminator within ' + LIMIT + ' lines' };
  }

  const block = lines.slice(start, end + 1).join('\n');
  const file = (block.match(/^\s*file: '([^']+)'/m) || [])[1] || null;
  const css = (block.match(/^\s*css: '([^']+)'/m) || [])[1] || null;
  const label = (block.match(/^\s*label: '([^']+)'/m) || [])[1] || null;

  let from = start;
  while (from - 1 >= 0 && /^\s*\/\//.test(lines[from - 1])) from--;

  lines.splice(from, end - from + 1);
  return {
    ok: true,
    text: lines.join('\n'),
    file,
    css,
    label,
    removedLines: end - from + 1,
  };
}

/** Remove the `'<id>': Component,` map line and the import that fed it. */
function removeRouteEntry(src, id) {
  const lines = norm(src).split('\n');
  const mapRe = new RegExp("^  '" + esc(id) + "': ([A-Za-z0-9_$]+),$");
  const at = lines.findIndex((l) => mapRe.test(l));
  if (at === -1) return { ok: true, found: false, text: src, component: null };

  const component = lines[at].match(mapRe)[1];
  lines.splice(at, 1);
  const impRe = new RegExp('^import\\s+' + esc(component) + '\\s+from\\s');
  const impAt = lines.findIndex((l) => impRe.test(l));
  if (impAt !== -1) lines.splice(impAt, 1);

  return { ok: true, found: true, component, text: lines.join('\n') };
}

/** Remove `{ id: '<id>', ... },` from the nav tree, plus a comment block above it. */
function removeNavEntry(src, id) {
  const lines = norm(src).split('\n');
  const re = new RegExp("^\\s*\\{ id: '" + esc(id) + "',");
  const at = lines.findIndex((l) => re.test(l));
  if (at === -1) return { ok: true, found: false, text: src };

  let from = at;
  while (from - 1 >= 0 && /^\s*\/\//.test(lines[from - 1])) from--;

  lines.splice(from, at - from + 1);
  return { ok: true, found: true, text: lines.join('\n') };
}

/**
 * Why a declared asset must NOT be deleted. Returns null when it is safe to delete.
 *
 * ⚠️ This exists because the first dry run found FOUR of 21 views declaring an asset that is not
 * theirs: `/status/analytics` declares `src/App.jsx`, `/development/widget-library` declares a
 * SHARED component stylesheet, and two Lab/Mt5 pages share one page file and one CSS file between
 * them. A view-meta `file:`/`css:` field names what a view RENDERS, not what it OWNS — and the
 * difference is invisible until something deletes the file.
 */
function protectionReason(assetPath, originalMetaText) {
  if (!assetPath.startsWith('src/pages/')) {
    return "outside src/pages/ — not this view's own asset";
  }
  const declarations = originalMetaText.split("'" + assetPath + "'").length - 1;
  if (declarations > 1) {
    return 'declared by ' + declarations + ' view-meta entries — shared between views';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-test — a remover never observed to fail is a decoration.
// ─────────────────────────────────────────────────────────────────────────────

function selfTest() {
  const fails = [];
  const check = (name, cond, detail) => {
    if (!cond) fails.push(name + (detail ? ' — ' + detail : ''));
  };

  const META = [
    "const VIEW_META = {",
    "  '/lab/keep-me': {",
    "    tier: 'premium',",
    "    label: 'Keep Me',",
    "    file: 'src/pages/KeepMePage.jsx',",
    "    css: 'src/pages/keep-me.css',",
    "  },",
    "  // a comment that belongs to the entry below it",
    "  '/lab/delete-me': {",
    "    tier: 'premium',",
    "    label: 'Delete Me',",
    "    file: 'src/pages/DeleteMePage.jsx',",
    "    css: 'src/pages/delete-me.css',",
    "    api: ['GET /api/x'],",
    "  },",
    "  '/lab/after': {",
    "    tier: 'free',",
    "    label: 'After',",
    "    file: 'src/pages/AfterPage.jsx',",
    "    css: 'src/pages/after.css',",
    "  },",
    "};",
  ].join('\n');

  // direction 1 — it removes the right block and nothing else
  const r1 = removeMetaEntry(META, '/lab/delete-me');
  check('removes target entry', r1.ok);
  check('target key gone', !r1.text.includes("'/lab/delete-me'"));
  check('target comment gone', !r1.text.includes('a comment that belongs'));
  check('neighbour BEFORE survives', r1.text.includes("'/lab/keep-me'") && r1.text.includes('KeepMePage'));
  check('neighbour AFTER survives', r1.text.includes("'/lab/after'") && r1.text.includes('AfterPage'));
  check('closing brace survives', r1.text.trimEnd().endsWith('};'));
  check('reports the page file', r1.file === 'src/pages/DeleteMePage.jsx', 'got ' + r1.file);
  check('reports the css', r1.css === 'src/pages/delete-me.css', 'got ' + r1.css);
  check('reports the label', r1.label === 'Delete Me', 'got ' + r1.label);

  // direction 2 — an absent route is an ERROR, not a silent success
  const r2 = removeMetaEntry(META, '/lab/never-existed');
  check('absent route REFUSES', r2.ok === false, 'returned ok=' + r2.ok);

  // direction 3 — a missing terminator is an ERROR, not an unbounded swallow
  const truncated = "const VIEW_META = {\n  '/lab/truncated': {\n    tier: 'free',\n";
  const r3 = removeMetaEntry(truncated, '/lab/truncated');
  check('unterminated entry REFUSES', r3.ok === false, 'returned ok=' + r3.ok);

  // direction 4 — a nested object must NOT be mistaken for the terminator
  const nested = [
    "const VIEW_META = {",
    "  '/lab/nested': {",
    "    tier: 'free',",
    "    fns: {",
    "    },",
    "    label: 'Nested',",
    "    file: 'src/pages/NestedPage.jsx',",
    "    css: 'src/pages/nested.css',",
    "  },",
    "  '/lab/keeper': {",
    "    tier: 'free',",
    "  },",
    "};",
  ].join('\n');
  const r4 = removeMetaEntry(nested, '/lab/nested');
  check('nested object removed whole', r4.ok && !r4.text.includes("'/lab/nested'"));
  check('nested object left the keeper', r4.text.includes("'/lab/keeper'"));

  // route map — removes the entry AND its import, leaves an unrelated import alone
  const ROUTES = [
    "import KeepMePage from '../pages/KeepMePage.jsx';",
    "import DeleteMePage from '../pages/DeleteMePage.jsx';",
    "const VIEW_COMPONENTS = {",
    "  'keep-me': KeepMePage,",
    "  'delete-me': DeleteMePage,",
    "};",
  ].join('\n');
  const r5 = removeRouteEntry(ROUTES, 'delete-me');
  check('route map entry gone', !r5.text.includes("'delete-me':"));
  check('its import gone', !r5.text.includes('DeleteMePage'));
  check('unrelated import survives', r5.text.includes('KeepMePage'));
  check('component name reported', r5.component === 'DeleteMePage', 'got ' + r5.component);

  // nav — must not be confused by an AREA key of the same name, nor a longer id
  const NAV = [
    "const NAV_TREE = {",
    "  lab: {",
    "    label: 'Lab',",
    "    views: [",
    "      { id: 'lab-landing', label: 'Lab', icon: 'x' },",
    "      { id: 'lab', label: 'Lab Sandbox', icon: 'y' },",
    "      { id: 'backtest', label: 'Backtest', icon: 'z' },",
    "    ],",
    "  },",
    "};",
  ].join('\n');
  const r6 = removeNavEntry(NAV, 'lab');
  check('nav line gone', !/id: 'lab', label: 'Lab Sandbox'/.test(r6.text));
  check('area key survives', r6.text.includes('lab: {'));
  check('longer id survives', r6.text.includes("id: 'lab-landing'"));
  check('sibling survives', r6.text.includes("id: 'backtest'"));

  const r7 = removeNavEntry(NAV, 'not-here');
  check('absent nav id is reported, not thrown', r7.ok && r7.found === false);

  // protection — the guard that stops "delete this view" from deleting the app shell
  check('unique page asset is deletable', protectionReason('src/pages/DeleteMePage.jsx', META) === null,
    'got ' + protectionReason('src/pages/DeleteMePage.jsx', META));
  check('asset outside src/pages REFUSED', /outside src\/pages/.test(protectionReason('src/App.jsx', META) || ''));
  const sharedMeta = "  '/a': {\n    css: 'src/pages/Shared.css',\n  },\n  '/b': {\n    css: 'src/pages/Shared.css',\n  },";
  check('shared asset REFUSED', /shared between views/.test(protectionReason('src/pages/Shared.css', sharedMeta) || ''));

  console.log('self-test: ' + (fails.length ? 'FAILED' : 'passed') + ' (' + (fails.length ? fails.length : 23) + ' assertions)');
  for (const f of fails) console.error('  ✗ ' + f);
  if (fails.length) process.exit(1);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Driver
// ─────────────────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist-free') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|css|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();

  const apply = argv.includes('--apply');
  let routes = [];
  const ri = argv.indexOf('--routes');
  const rf = argv.indexOf('--routes-from');
  if (ri !== -1) routes = String(argv[ri + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (rf !== -1) {
    routes = fs.readFileSync(argv[rf + 1], 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  }
  if (!routes.length) {
    console.error('no routes given. use --routes a,b,c or --routes-from file');
    process.exit(2);
  }

  const original = {};
  const eol = {};
  for (const key of Object.keys(SRC)) {
    const abs = path.join(ROOT, SRC[key]);
    original[key] = fs.readFileSync(abs, 'utf8');
    eol[key] = original[key].includes('\r\n') ? '\r\n' : '\n';
  }

  let meta = original.meta;
  let rts = original.routes;
  let nav = original.nav;

  const results = [];
  const errors = [];

  for (const route of routes) {
    const id = route.split('/').filter(Boolean).slice(1).join('/');
    const rm = removeMetaEntry(meta, route);
    if (!rm.ok) {
      errors.push(route + ' — ' + rm.reason);
      results.push({ route, failed: rm.reason });
      continue; // never continue past a failure as if it worked
    }
    meta = rm.text;

    const rr = removeRouteEntry(rts, id);
    rts = rr.ok ? rr.text : rts;
    const rn = removeNavEntry(nav, id);
    nav = rn.ok ? rn.text : nav;

    results.push({
      route,
      id,
      label: rm.label,
      file: rm.file,
      css: rm.css,
      component: rr.component,
      routeEntryRemoved: rr.found,
      navEntryRemoved: rn.found,
    });
  }

  // Remaining references — the dangling-link class. Scan with the NEW contents in place.
  const pending = { [SRC.meta]: meta, [SRC.routes]: rts, [SRC.nav]: nav };
  const dangling = [];
  for (const abs of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const text = rel in pending ? pending[rel] : fs.readFileSync(abs, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const r of results) {
        if (r.failed) continue;
        if (lines[i].includes("'" + r.route + "'") || lines[i].includes('"' + r.route + '"')) {
          dangling.push(rel + ':' + (i + 1) + '  →  ' + r.route);
        }
      }
    }
  }

  console.log((apply ? 'APPLYING' : 'DRY RUN') + ' — ' + routes.length + ' view(s)\n');
  for (const r of results) {
    if (r.failed) { console.log('  ✗ ' + r.route + '\n      ' + r.failed); continue; }
    console.log('  • ' + r.route + '  [' + (r.label || '?') + ']');
    console.log('      page  ' + (r.file || '(none declared)') + '   css  ' + (r.css || '(none)'));
    console.log('      removed: view-meta ✓  route-map ' + (r.routeEntryRemoved ? '✓' : '✗ not present') + '  nav ' + (r.navEntryRemoved ? '✓' : '✗ not present'));
  }

  console.log('\nREMAINING REFERENCES (' + dangling.length + ') — these are the silent breakages:');
  if (!dangling.length) console.log('  none');
  for (const d of dangling) console.log('  ' + d);

  if (errors.length) {
    console.log('\n' + errors.length + ' ROUTE(S) NOT FOUND — nothing was written for them:');
    for (const e of errors) console.log('  ✗ ' + e);
    if (apply) console.log('\n⚠️  Writing the ' + (results.length - errors.length) + ' that DID resolve.');
  }

  // ── Which files may this actually delete? ────────────────────────────────
  // A view-meta `file:`/`css:` names what a view RENDERS, not what it OWNS. Measured on the first
  // dry run: 4 of 21 views declare an asset that is not theirs — src/App.jsx (the app shell), one
  // shared component stylesheet, one CSS file imported by a surviving page, and one page file
  // declared by two view ids. Deleting those would have taken out unrelated pages.
  const srcAll = {};
  for (const abs of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    // GENERATED mirrors — regenerated immediately after, so they must not count as importers.
    if (rel.startsWith('src/editions/')) continue;
    //⚠️ The three edited files use their POST-removal text. Reading them from disk made every page
    // look imported, because view-meta still named it and view-routes still imported it.
    srcAll[rel] = rel in pending ? pending[rel] : fs.readFileSync(abs, 'utf8');
  }

  // ⚠️ An IMPORT LINE whose specifier ENDS in this basename. Measured failures if relaxed:
  //   • substring  → `lab.css` matches inside `charts-lab.css`: 13 bogus importers on one file,
  //                  and the guard protected all 42 assets, so nothing could be deleted at all.
  //   • mention    → the architecture docs name deleted pages on purpose, and blocking on that
  //                  makes deletion impossible. Only a real import line proves a live dependency.
  const QCH = '["' + String.fromCharCode(39) + '`]';
  const candidateSet = new Set(results.map((r) => r.file).filter(Boolean));
  const plan = [];
  for (const r of results) {
    if (r.failed) continue;
    for (const asset of [r.file, r.css]) {
      if (!asset) continue;
      let reason = protectionReason(asset, original.meta);
      if (!reason) {
        const base = asset.split('/').pop();
        const baseRe = new RegExp('/' + esc(base) + QCH + '\\s*;?\\s*$');
        const importers = Object.keys(srcAll).filter((rel) => {
          if (rel === asset || candidateSet.has(rel)) return false;
          return srcAll[rel].split(/\r?\n/).some((l) => /^\s*import\b/.test(l) && baseRe.test(l));
        });
        if (importers.length) reason = 'imported by a surviving file: ' + importers.join(', ');
      }
      plan.push({ asset, reason });
    }
  }
  const blocked = plan.filter((p) => p.reason);
  console.log('\nFILE DELETIONS: ' + (plan.length - blocked.length) + ' to delete, ' + blocked.length + ' PROTECTED');
  for (const b of blocked) console.log('  🛑 kept ' + b.asset + '   ← ' + b.reason);

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
    return errors.length ? 1 : 0;
  }

  for (const key of Object.keys(SRC)) {
    const next = { meta, routes: rts, nav }[key];
    if (next !== original[key]) {
      fs.writeFileSync(path.join(ROOT, SRC[key]), restore(next, eol[key]));
      console.log('  wrote ' + SRC[key]);
    }
  }

  for (const p of plan) {
    if (p.reason) { console.log('  kept    ' + p.asset + ' (protected — ' + p.reason + ')'); continue; }
    const abs = path.join(ROOT, p.asset);
    if (fs.existsSync(abs)) { fs.unlinkSync(abs); console.log('  deleted ' + p.asset); }
    else console.log('  ⚠️  ' + p.asset + ' was declared in view-meta but does not exist');
  }

  console.log('\nNEXT: node scripts/generate-free-map.cjs && node scripts/generate-free-manifest.cjs && node scripts/generate-free-registry.cjs');
  console.log('      node scripts/verify-view-meta-routes.cjs && npm run build');
  return errors.length ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
