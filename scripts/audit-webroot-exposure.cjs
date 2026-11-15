#!/usr/bin/env node
/**
 * audit-webroot-exposure.cjs — does the local Apache hand out a secret-shaped path?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * The same defect has now been found three times, and every time it was found by ACCIDENT:
 *
 *   2026-09-18  data/*.json served as plain text          → a deny rule was added to data/
 *   2026-11-08  .env served at the web root (intranet)    → a deny rule was added to www root
 *   2026-11-15  .git served in 18 of 31 project folders   → the rule above could not see it
 *
 * ⚠️ THE THIRD ONE IS THE POINT. `<FilesMatch "^\.">` matches the FINAL PATH COMPONENT, so it
 * closed `.env` (dotted filename) and left `.git/config` open (basename `config`). A guard written
 * against what the rule SAYS would have passed. The only thing that catches this is ASKING THE
 * SERVER — which is what this script does.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────────────────────────
 * Requests a small set of dot-paths against every project folder under the web root and reports
 * any that answer 200. It asserts nothing about why; a path answering 200 IS the finding.
 *
 *   node scripts/audit-webroot-exposure.cjs                # probe localhost, every folder
 *   node scripts/audit-webroot-exposure.cjs --self-test    # prove the classifier can fail
 *   node scripts/audit-webroot-exposure.cjs --only intranet trading-command-suite
 *
 * Exit codes: 0 = clean · 1 = at least one exposed path · 2 = could not judge (server down)
 *
 * ⚠️ IT PRINTS STATUS CODES ONLY, NEVER A BODY. A security scanner that echoes what it found has
 * become a second copy of the leak.
 */

const fs = require('fs');
const path = require('path');

const WEB_ROOT = 'C:\\wamp64\\www';
const BASE = 'http://localhost/';
/** The paths that must never be readable. `.git/config` is the one that was actually open. */
const PROBES = ['.git/config', '.git/HEAD', '.env', '.htaccess'];

/**
 * classify() — pure: which probes were served?
 * Separated from the network so `--self-test` can prove it fails in both directions without
 * needing a deliberately-broken server.
 */
function classify(results) {
  return results.filter((r) => r.status === 200);
}

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    return { url, status: res.status };
  } catch (err) {
    return { url, status: null, error: err?.message || String(err) };
  }
}

async function runSelfTest() {
  let failures = 0;
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (!ok) {
      console.log(`   expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      failures += 1;
    }
  };

  // Direction 1 — an exposed path IS reported.
  check(
    'a 200 on .git/config is reported as an exposure',
    classify([{ url: 'x/.git/config', status: 200 }]).map((r) => r.url),
    ['x/.git/config'],
  );

  // Direction 2 — a denied path is NOT reported (so the guard is not simply "always fire").
  check(
    'a 403 on .git/config is NOT reported',
    classify([{ url: 'x/.git/config', status: 403 }]).map((r) => r.url),
    [],
  );

  // Direction 3 — "could not judge" must not look like "clean".
  check(
    'a network failure is NOT reported as clean',
    classify([{ url: 'x/.env', status: null }]).map((r) => r.url),
    [],
  );
  check(
    'a network failure is distinguishable from a 403',
    [{ url: 'x/.env', status: null }].some((r) => r.status === null),
    true,
  );

  // Direction 4 — mixed input: only the 200 survives.
  check(
    'only the served path in a mixed set is reported',
    classify([
      { url: 'a/.env', status: 403 },
      { url: 'b/.git/HEAD', status: 200 },
      { url: 'c/.htaccess', status: 403 },
    ]).map((r) => r.url),
    ['b/.git/HEAD'],
  );

  console.log(failures === 0 ? '\nALL SELF-TESTS OK' : `\n${failures} SELF-TEST FAILURE(S)`);
  return failures === 0 ? 0 : 1;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return runSelfTest();

  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv.slice(onlyIdx + 1).filter((a) => !a.startsWith('--')) : null;

  // "Cannot judge" is a state: if the server is not answering at all, say so and exit 2 rather
  // than reporting a clean scan of a web root that was never read.
  const alive = await probe(`${BASE}intranet/index.php`);
  if (alive.status === null) {
    console.error(`CANNOT JUDGE — no response from ${BASE} (${alive.error}). Start WAMP, then re-run.`);
    return 2;
  }

  const folders = fs
    .readdirSync(WEB_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .filter((d) => !only || only.includes(d));

  const results = [];
  for (const folder of folders) {
    for (const p of PROBES) {
      results.push(await probe(`${BASE}${folder}/${p}`));
    }
  }

  const exposed = classify(results);
  const unreadable = results.filter((r) => r.status === null);

  console.log(`[webroot] probed ${folders.length} folder(s) × ${PROBES.length} path(s) = ${results.length} request(s)`);
  if (unreadable.length > 0) {
    console.log(`[webroot] ⚠️ ${unreadable.length} request(s) got no status — those paths are UNJUDGED, not clean`);
  }
  if (exposed.length === 0) {
    console.log('[webroot] ✅ no secret-shaped path is served');
    return 0;
  }

  console.log(`[webroot] 🛑 ${exposed.length} EXPOSED path(s):`);
  for (const r of exposed) console.log(`   ${r.url}`);
  console.log('\nFix at the web root (C:\\wamp64\\www\\.htaccess), not per folder:');
  console.log('   <FilesMatch "^\\.">Require all denied</FilesMatch>          # dotted FILENAMES');
  console.log('   RewriteRule (^|/)\\.(git|svn|hg|vscode)(/|$) - [F,L]        # dotted DIRECTORIES');
  return 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`[webroot] audit crashed: ${err.message}`);
    process.exit(2);
  });
}

module.exports = { classify, PROBES };
