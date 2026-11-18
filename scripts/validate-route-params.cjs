#!/usr/bin/env node
/**
 * validate-route-params.cjs — a page may not read a `useParams()` key that no route declares.
 *
 * WHY THIS EXISTS (#1266, 2026-11-18)
 * `SymbolDetailPage` read `useParams().symbolId`. NO route declared `:symbolId`, so the value was
 * always `undefined`, every query on the page stayed `enabled: false`, and the page rendered —
 * with every panel blank — for its whole life. Nothing errored, nothing warned, and the component
 * was 450 lines of plausible code.
 *
 * That is the repo's most expensive signature: plausible output, no error. It is also mechanically
 * detectable, because the router's own route table is the authority on which params exist.
 *
 * ⚠️ THE CATCH-ALL ROUTE `/:area/:view` MAKES A DIFFERENT GUARD IMPOSSIBLE, AND THIS IS THE ONE
 * THAT REPLACED IT. "A view that no route reaches" cannot be tested — `/:area/:view` renders any
 * key in `view-routes.jsx` at `/<any-area>/<key>`. Measured 2026-11-18: 38 of 161 registered view
 * components are not nav ids, and every one of them is legitimately reachable. A "no nav entry"
 * guard would need 38 baselines, and a guard with 38 exemptions is decoration. This check has
 * ZERO today and names a real defect, so it can actually fail.
 *
 * WHAT IT PARSES
 *   declared: every `:param` in any `<Route path="…">` in `src/App.jsx`
 *   read:     every name destructured from `useParams()`, plus `p.<name>` where
 *             `const p = useParams()` (the two forms this repo uses)
 *
 * LIMITATIONS, stated so the next reader does not over-trust it
 *   • It reads App.jsx only. A param declared in another router file would be reported as
 *     undeclared — there is one router, and if a second appears this must learn about it.
 *   • It cannot see a param read via `useSearchParams` (a query string has no declaration site).
 *   • It proves a param EXISTS on some route, not that the right route supplies it. A page that
 *     reads `ticker` but is mounted where only `view` is present would pass this and still be
 *     blank — that is the `route-capability` question, not this one.
 *
 * USAGE
 *   node scripts/validate-route-params.cjs             # gate — exit 1 on any undeclared read
 *   node scripts/validate-route-params.cjs --report    # list every page and the params it reads
 *   node scripts/validate-route-params.cjs --self-test # prove the detector can fail, and pass
 *
 * ── DECISION (2026-11-18, primary) ──
 * WHAT:      The guard for a page that renders nothing checks the PARAM a page reads, not whether a
 *            view is reachable or has a nav entry.
 * WHY:       Both of the obvious guards are unbuildable here, and that was MEASURED, not assumed:
 *            the catch-all `/:area/:view` renders any registered view id, so "unreachable view" can
 *            only ever pass; "no nav entry" fires on 38 of 161 registered components, each one
 *            legitimately reached through sub-navigation. A guard with 38 exemptions is decoration
 *            (development-philosophy §5). The real defect in #1266 was narrower: a page whose every
 *            query is gated on a param the router never supplies.
 * INSTEAD OF: An orphan-view sweep, which the original #1266 body proposed and which its own
 *            correction retracted after measuring the catch-all route.
 * REVERSE BY: Removing this file from `prebuild` in package.json. No stored data, no runtime effect.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 220
 * GUARD:     this file's own `--self-test` (6 cases, both directions) — a detector that reports
 *            "OK — 0 reads" on a tree with 11 is the exact defect it exists to prevent.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'src', 'App.jsx');
const SRC = path.join(ROOT, 'src');

/** Declared route params, in the order App.jsx declares them. */
function declaredParams(appSource) {
  const out = new Set();
  for (const m of appSource.matchAll(/path="([^"]*)"/g)) {
    for (const p of m[1].matchAll(/:([A-Za-z0-9_]+)/g)) out.add(p[1]);
  }
  return out;
}

/**
 * Every `useParams()` read in one source file.
 * Returns `[{ param, line }]`, in source order.
 */
function paramsRead(source) {
  const reads = [];
  for (const m of source.matchAll(/useParams\(\)/g)) {
    const line = source.slice(0, m.index).split('\n').length;
    // The assignment sits BEFORE the call: `const { a, b } = useParams()`. Reading it from the
    // preceding text is what makes `useParams()` itself the only anchor needed — matching forward
    // from `useParams()` finds the `;`, not the binding, and that mistake made this script report
    // zero reads on a tree where it should have seen dozens. (Caught by --self-test.)
    const before = source.slice(Math.max(0, m.index - 300), m.index);
    const head = before.match(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*$/);
    if (head) {
      for (const raw of head[1].split(',')) {
        const name = raw.split(':')[0].split('=')[0].trim();
        if (name) reads.push({ param: name, line });
      }
      continue;
    }

    const alias = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
    if (!alias) continue;
    const obj = alias[1].replace(/\$/g, '\\$');
    const body = source.slice(m.index);
    for (const use of body.matchAll(new RegExp(`\\b${obj}\\.([A-Za-z_$][\\w$]*)`, 'g'))) {
      reads.push({ param: use[1], line: source.slice(0, m.index + use.index).split('\n').length });
    }
  }
  return reads;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * The check itself. Takes the declared set and an iterable of `{ file, source }`, so the
 * self-test can drive it with fixtures instead of the real tree.
 */
function findUndeclared(declared, files) {
  const bad = [];
  const all = [];
  for (const { file, source } of files) {
    for (const r of paramsRead(source)) {
      all.push({ file, ...r });
      if (!declared.has(r.param)) bad.push({ file, ...r });
    }
  }
  return { bad, all };
}

function main() {
  if (process.argv.includes('--help')) {
    console.log('usage: validate-route-params.cjs [--report] [--self-test]');
    return 0;
  }

  if (process.argv.includes('--self-test')) {
    const declared = new Set(['ticker', 'view']);

    const withUndeclared = { file: 'A.jsx', source: "const { symbolId } = useParams();\nif (symbolId) apiGet('/x');" };
    const withDeclared = { file: 'B.jsx', source: 'const { ticker, view } = useParams();' };
    const viaObject = { file: 'C.jsx', source: 'const p = useParams();\nconst t = p.strategyId;' };
    const viaObjectOk = { file: 'D.jsx', source: 'const p = useParams();\nconst t = p.ticker;' };
    const renamed = { file: 'E.jsx', source: 'const { ticker: sym } = useParams();' };
    const noParams = { file: 'F.jsx', source: 'export default function X() { return null; }' };

    const cases = [
      ['undeclared destructure is caught', [withUndeclared], 1, 'symbolId'],
      ['declared destructure passes', [withDeclared], 0, null],
      ['undeclared object read is caught', [viaObject], 1, 'strategyId'],
      ['declared object read passes', [viaObjectOk], 0, null],
      ['renamed destructure is judged on the SOURCE key', [renamed], 0, null],
      ['a file with no useParams is silent', [noParams], 0, null],
    ];

    let failed = 0;
    for (const [name, files, expected, param] of cases) {
      const { bad } = findUndeclared(declared, files);
      const ok = bad.length === expected && (param === null || bad[0]?.param === param);
      if (!ok) failed += 1;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `  (got ${bad.length}${bad[0] ? `:${bad[0].param}` : ''}, expected ${expected}${param ? `:${param}` : ''})`}`);
    }
    console.log();
    if (failed) {
      console.error(`${failed} of ${cases.length} self-test case(s) failed.`);
      return 1;
    }
    console.log(`self-test: all ${cases.length} cases behaved (both directions).`);
    return 0;
  }

  const declared = declaredParams(fs.readFileSync(APP, 'utf8'));
  if (declared.size === 0) {
    // A parse that finds no params means the regex or the router changed. Passing here would be
    // "cannot judge" rendered as "fine" — the defect this whole script exists to prevent.
    console.error('CANNOT JUDGE — App.jsx declares no route params at all. The route table or this parser has changed.');
    return 2;
  }

  const files = walk(SRC).map((f) => ({ file: path.relative(ROOT, f), source: fs.readFileSync(f, 'utf8') }));
  const { bad, all } = findUndeclared(declared, files);
  if (process.argv.includes('--report')) {
    const byFile = new Map();
    for (const r of all) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r.param]);
    for (const [f, ps] of [...byFile].sort()) {
      const flag = ps.some((p) => !declared.has(p)) ? '  ⚠️' : '';
      console.log(`  ${f}  →  ${[...new Set(ps)].join(', ')}${flag}`);
    }
    console.log();
  }

  console.log(`declared route params: ${[...declared].sort().join(', ')}`);
  console.log(`${all.length} useParams() read(s) across ${new Set(all.map((r) => r.file)).size} of ${files.length} source file(s)`);
  if (files.length === 0 || all.length === 0) {
    // Zero reads over a tree this size is not a clean bill of health — it means the walk or the
    // parser found nothing, and reporting OK would be "cannot judge" dressed as "fine".
    console.error('CANNOT JUDGE — no useParams() reads were found at all. This repo has many; the walk or the parser has broken.');
    return 2;
  }

  if (bad.length) {
    console.error(`\n${bad.length} read(s) of a param NO route declares:`);
    for (const b of bad) console.error(`  ✖ ${b.file}:${b.line}  reads '${b.param}'`);
    console.error('\nA param the router never supplies is `undefined` forever. Every query gated on it');
    console.error('stays disabled and the page renders blank — with no error. Either declare the param');
    console.error('on a route in src/App.jsx, or read the one the route already supplies.');
    return 1;
  }
  console.log('✅ OK — every useParams() key is declared by a route.');
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { declaredParams, paramsRead, findUndeclared };
