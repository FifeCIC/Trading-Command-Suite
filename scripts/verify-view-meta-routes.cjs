#!/usr/bin/env node
/**
 * verify-view-meta-routes.cjs — canary the view-meta resolver against real paths.
 *
 * WHY THIS EXISTS
 * ---------------
 * `VIEW_META` in `src/core/view-meta.js` is looked up two ways: an exact key match, then a
 * prefix match (longest key first, requiring `pathname.startsWith(key + '/')`). Detail routes
 * like `/research/symbol/:ticker` are declared as the PREFIX — so the parameter never appears
 * in the map, and the correctness of that lives entirely in the matcher.
 *
 * The failure this guards is specifically an AMBIGUOUS PREFIX: adding the key `/research/symbol`
 * adds a string that `/research/symbols-browser` also begins with. The matcher requires the
 * literal `key + '/'` so it should NOT collide — but "should not" is a claim, and this repo has
 * a rule about those. So: assert both directions.
 *
 *   node scripts/verify-view-meta-routes.cjs
 *
 * Exit 0 = every path below resolved to the expected key.  Exit 1 = at least one did not.
 *
 * ⚠️ THIS SCRIPT EVALUATES THE REAL `getViewMeta` AND `VIEW_META` FROM view-meta.js.
 * The first version re-implemented the matcher locally, and that made it blind: breaking the
 * matcher in view-meta.js changed nothing, because the copy still behaved. A duplicate of the
 * thing you are guarding is not a guard — it is a second implementation that drifts, and the
 * canary proved it by reporting MISSED while the real matcher was broken. Do not reintroduce a
 * local `getViewMeta` here; import the shipped one or the script is worthless.
 */

const path = require('node:path');
const fs = require('node:fs');

const META_FILE = path.join(__dirname, '..', 'src', 'core', 'view-meta.js');
const src = fs.readFileSync(META_FILE, 'utf8');

// `view-meta.js` is ESM (`export function` / `export const`), so it cannot be `require`d from a
// .cjs file. Strip the `export` keywords and evaluate the WHOLE file in a function scope, then
// hand back its real bindings. This is deliberately reading the shipped source, not re-writing it.
let VIEW_META;
let getViewMeta;
try {
  const body = src
    // `export default X;` must become an assignment, NOT `default X;` (that is a syntax error —
    // "Unexpected token 'default'"). Order matters: handle `export default` before `export`.
    .replace(/^export\s+default\s+/gm, 'const __defaultExport = ')
    .replace(/^export\s+/gm, '');
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${body}\nreturn { VIEW_META, getViewMeta };`);
  ({ VIEW_META, getViewMeta } = factory());
} catch (e) {
  console.error('FATAL: could not evaluate view-meta.js —', e.message);
  process.exit(1);
}

if (typeof getViewMeta !== 'function' || !VIEW_META || typeof VIEW_META !== 'object') {
  console.error('FATAL: view-meta.js did not expose both `VIEW_META` and `getViewMeta`.');
  process.exit(1);
}

// path → the key we expect to resolve, or null for "no metadata".
const CASES = [
  // The route the user reported.
  ['/research/symbol/XAUUSD', '/research/symbol'],
  ['/research/symbol/USDCAD', '/research/symbol'],
  // ⚠️ The ambiguity this change introduced. Must stay on its own key.
  ['/research/symbols-browser', '/research/symbols-browser'],
  ['/research/symbols-browser/anything', '/research/symbols-browser'],
  // ⚠️ A path that shares a string prefix with a key but is NOT a child of it. This is the case
  // the matcher's `+ '/'` actually protects: without it, `startsWith('/research/symbol')` is true
  // here and this would wrongly resolve to the symbol page. (It is NOT what protects
  // `/research/symbols-browser` — longest-key-first sorting does that.)
  ['/research/symbolfoo', null],
  ['/research/symbol', '/research/symbol'],
  // The trading mirror, plus the strategy-* family it sits beside.
  ['/trading/symbol/EURUSD', '/trading/symbol'],
  ['/trading/strategy/7d3f1a2b', '/trading/strategy'],
  ['/trading/strategy-comparison', '/trading/strategy-comparison'],
  ['/trading/strategy-monitor', '/trading/strategy-monitor'],
  ['/trading/strategy-library', '/trading/strategy-library'],
  // Sanity: an unregistered path must still return null, not silently match a neighbour.
  ['/research/definitely-not-a-view', null],
];

let failures = 0;
const width = Math.max(...CASES.map(([p]) => p.length));

for (const [pathname, expectedKey] of CASES) {
  const got = getViewMeta(pathname);
  const gotKey = got ? Object.keys(VIEW_META).find((k) => VIEW_META[k] === got) : null;
  const ok = (expectedKey === null && got === null) || gotKey === expectedKey;
  if (!ok) failures++;
  console.log(
    `${ok ? '  ok  ' : '  FAIL'}  ${pathname.padEnd(width)}  ->  ${gotKey ?? 'null'}${ok ? '' : `   (expected ${expectedKey ?? 'null'})`}`,
  );
}

console.log();
if (failures) {
  console.error(`${failures} of ${CASES.length} route(s) resolved incorrectly.`);
  process.exit(1);
}
console.log(`All ${CASES.length} routes resolved to the expected metadata.`);
