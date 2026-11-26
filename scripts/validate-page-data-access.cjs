/**
 * validate-page-data-access.cjs — one HTTP transport, and it is the shared client.
 *
 * ── THE DEFECT THIS PREVENTS ─────────────────────────────────────────────────────────────────────
 * Measured 2026-11-26: **64 occurrences of `fetch(` in `src/`**, of which 35 are real calls in
 * `src/pages` (37 lines, 2 of them prose in a comment). Every one of them bypasses
 * `src/core/api/client.js`, and that client is not a convenience wrapper — it exists because of two
 * measured failures:
 *
 *   1. **A request with no timeout hangs `Loading…` forever.** The client aborts at 28 s and marks the
 *      error `timedOut`, because an abandoned request has no HTTP status and reporting one would be a
 *      fabrication.
 *   2. **A non-2xx body is thrown away.** The client turns Nest's `{ message }` into `err.detail`, so
 *      "market closed", "duplicate", "diversification" can be shown as the CAUSE instead of a bare
 *      status code. A raw `fetch` + `res.json()` reads `data.success` and silently renders nothing
 *      when the server says why.
 *
 * ⚠️ **A RAW `fetch` IS NOT ONLY MISSING A HELPER — IT IS MISSING AN ERROR PATH**, which is why this
 * is a data-integrity standard and not a style rule.
 *
 * ── THE TWO RULES ──────────────────────────────────────────────────────────────────────────────
 *   R1 ONE TRANSPORT   `fetch(` may appear only in `src/core/api/client.js`, or in a file listed in
 *                      ALLOWED with a reason it cannot use the client. A new raw call fails.
 *   R2 RATCHET         files still carrying calls are frozen per file in
 *                      `docs/data-access-baseline.json`. A file may not grow; a file that shrinks makes
 *                      the baseline stale and fails until it is regenerated in the same change.
 *
 * ── THE SCANNER STRIPS COMMENT AND STRING CONTENT FIRST ────────────────────────────────────────
 * ⚠️ Measured: 10 of the 64 occurrences were PROSE — `// a failed fetch (next block)` in a comment,
 * `'37 raw `fetch()` calls'` in a data file, and the architecture docs quoting the route guard. A
 * scanner that counts those inflates its own finding and then reports a violation nobody can fix
 * (that is exactly how the colour count reached "2,487"). So the tokenizer strips comments and string
 * literals — **but keeps the code inside `${…}`**, because that is where a call can actually live.
 *
 * Usage:
 *   node scripts/validate-page-data-access.cjs                 # check R1 + R2
 *   node scripts/validate-page-data-access.cjs --report        # every remaining call, by file
 *   node scripts/validate-page-data-access.cjs --write-baseline
 *   node scripts/validate-page-data-access.cjs --self-test     # prove BOTH rules and the tokenizer
 *
 * Exit: 0 = no undeclared transport and the ratchet holds · 1 = a violation or a stale baseline ·
 *       2 = could not judge (never 0 — a scan that reads nothing has checked nothing).
 *
 * ── DECISION (2026-11-26, primary) ──
 * WHAT:      every HTTP call in `src/` goes through `src/core/api/client.js`; five files are allowed
 *            their own transport, each with a stated reason, and the list is code not prose.
 * WHY:       measured — 45 raw calls in 21 files had no timeout and no error path, so a stalled
 *            request showed `Loading…` forever and a server refusal ("market closed") was discarded
 *            and rendered as nothing. The client is the only surface that fixes both, and the router
 *            guard cannot see a call that did not use it.
 * INSTEAD OF: Leaving the 5 exemptions out of the gate, which is how a rule becomes a suggestion.
 * REVERSE BY: Delete the script, remove it from `prebuild` and `src/data/standards.js`, and delete
 *            `docs/data-access-baseline.json`.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 298
 * GUARD:     this file — R1 undeclared transport, R2 ratchet, 14 self-test cases, canaried live
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sourceFiles, repoRelative, readBaseline, compareToBaseline, writeBaseline: writeRatchet } = require('./lib/validator-ratchet.cjs');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CLIENT = 'src/core/api/client.js';
const BASELINE = path.join(ROOT, 'docs', 'data-access-baseline.json');

/**
 * Files that legitimately own their own transport. Each entry carries WHY the shared client cannot
 * serve it — an entry without a reason is a widened pattern with extra steps.
 */
const ALLOWED = {
  'src/analytics/client.js': 'an analytics beacon with its own endpoint, retry and failure policy; it must never be blocked by, or block, an API call',
  'src/utils/networkStatus.js': 'it IS the health probe — routing the health check through the client would make the client the thing it is testing',
  'src/components/DevOverlay.jsx': 'developer-only overlay posting to a dev endpoint on an absolute host; not part of the product surface',
  'src/pages/ServerControlsPage.jsx': 'calls the INTRANET task runner (a different origin and a different contract), not the TCS API — apiUrl() would prefix the TCS base URL and 404',
  'src/pages/HomeDashboard.jsx': 'calls the INTRANET task runner (a different origin and a different contract), not the TCS API',
};

const FETCH = /(?<![\w.$])fetch\s*\(/g;

/**
 * stripNonCode(text) — comments and string literals removed, `${…}` code KEPT.
 *
 * Not a full parser: it tracks only the states that matter (line comment, block comment, single and
 * double quotes, template literal), which is enough because the question is "is this token code".
 */
function stripNonCode(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  // Stack of template-literal brace depths, so a `${}` inside a template can hold a nested template.
  const tpl = [];
  let mode = 'code'; // code | line | block | single | double | template
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && next === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") { mode = 'single'; i += 1; continue; }
      if (c === '"') { mode = 'double'; i += 1; continue; }
      if (c === '`') { mode = 'template'; i += 1; continue; }
      if (c === '{' && tpl.length) tpl[tpl.length - 1] += 1;
      if (c === '}' && tpl.length) {
        if (tpl[tpl.length - 1] === 0) { tpl.pop(); mode = 'template'; i += 1; continue; }
        tpl[tpl.length - 1] -= 1;
      }
      out += c; i += 1; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += '\n'; } i += 1; continue; }
    if (mode === 'block') { if (c === '*' && next === '/') { mode = 'code'; i += 2; continue; } i += 1; continue; }
    if (mode === 'single' || mode === 'double') {
      if (c === '\\') { i += 2; continue; }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"')) mode = 'code';
      i += 1; continue;
    }
    // template: a backtick closes it, `${` switches back to code
    if (c === '\\') { i += 2; continue; }
    if (c === '`') { mode = 'code'; i += 1; continue; }
    if (c === '$' && next === '{') { tpl.push(0); mode = 'code'; i += 2; continue; }
    i += 1;
  }
  return out;
}

/** Every real `fetch(` in one source, with the code left on its line. */
function scanSource(text) {
  const stripped = stripNonCode(text);
  const originalLines = text.split('\n');
  const hits = [];
  FETCH.lastIndex = 0;
  let m;
  while ((m = FETCH.exec(stripped)) !== null) {
    const line = stripped.slice(0, m.index).split('\n').length;
    hits.push({ line, code: (originalLines[line - 1] || '').trim().slice(0, 110) });
  }
  return hits;
}

/**
 * analyse(sources, baseline) — pure, so the self-test can drive every branch.
 * `sources` is [{ file, text }]; `baseline` is { files: { path: count } }.
 */
function analyse(sources, baseline) {
  const counts = new Map();
  const sites = [];
  const undeclared = [];
  for (const { file, text } of sources) {
    if (file === CLIENT) continue;
    const hits = scanSource(text);
    if (!hits.length) continue;
    for (const h of hits) sites.push({ file, ...h });
    if (ALLOWED[file]) continue;
    counts.set(file, hits.length);
    undeclared.push({ file, count: hits.length });
  }
  const { total, grown, newFiles, shrunk } = compareToBaseline(counts, baseline);
  return { sites, undeclared, counts, total, grown, newFiles, shrunk, allowed: Object.keys(ALLOWED) };
}

function check() {
  if (!fs.existsSync(path.join(ROOT, CLIENT))) throw new Error(`${CLIENT} not found — cannot judge`);
  const files = sourceFiles(SRC).map((f) => repoRelative(ROOT, f));
  const sources = files.map((file) => ({ file, text: fs.readFileSync(path.join(ROOT, file), 'utf8') }));
  const declared = sources.find((s) => s.file === CLIENT);
  if (!scanSource(declared.text).length) {
    // ⚠️ The client itself must contain the one `fetch(`. Zero means the tokenizer is blind, and every
    // "clean" result below would be a false negative — the false pass this repo keeps re-finding.
    throw new Error(`the scanner found no fetch( in ${CLIENT} — the tokenizer is not reading code`);
  }
  return { ...analyse(sources, readBaseline(BASELINE)), scanned: files.length };
}

function selfTest() {
  let failures = 0;
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };

  // —— the tokenizer, both directions. A scanner that cannot tell code from prose is the whole defect.
  expect(
    'a line comment is not a call',
    scanSource('const x = 1; // a failed fetch (next block)').length,
    0,
  );
  expect(
    'a block comment is not a call',
    scanSource('/* fetch("/api/x") */ const y = 2;').length,
    0,
  );
  expect(
    'a quoted string is not a call',
    scanSource("const why = '37 raw `fetch(\` calls';").length,
    0,
  );
  expect(
    'a template literal body is not a call',
    scanSource('const m = `see fetch( here`;').length,
    0,
  );
  expect('a REAL call IS found', scanSource("const r = await fetch('/api/x');").length, 1);
  expect(
    'a call inside ${} in a template IS found',
    scanSource('const u = `${await fetch("/api/x")}`;').length,
    1,
  );
  expect(
    'a call after a string on the same line IS found',
    scanSource("const a = 'x'; const r = fetch('/api/y');").length,
    1,
  );

  const base = { total: 1, files: { 'src/pages/A.jsx': 1 } };
  const run = (sources, b = base) => analyse(sources, b);

  // —— R1: an undeclared raw call is a violation; the client and the allowlist are not.
  expect(
    'R1: a raw call in a page is undeclared',
    run([{ file: 'src/pages/A.jsx', text: "fetch('/api/x')" }]).undeclared.length,
    1,
  );
  expect(
    'R1: the shared client may call fetch',
    run([{ file: CLIENT, text: "fetch('/api/x')" }]).undeclared.length,
    0,
  );
  expect(
    'R1: an allowlisted file may call fetch',
    run([{ file: 'src/analytics/client.js', text: "fetch('/x')" }]).undeclared.length,
    0,
  );

  // —— R2: three directions.
  expect(
    'R2: a file that GROWS fails',
    run([{ file: 'src/pages/A.jsx', text: "fetch('/a'); fetch('/b')" }]).grown[0]?.count,
    2,
  );
  expect(
    'R2: a NEW file with a call fails',
    run([{ file: 'src/pages/B.jsx', text: "fetch('/x')" }]).newFiles.length,
    1,
  );
  expect(
    'R2: a file that SHRINKS makes the baseline stale',
    run([{ file: 'src/pages/A.jsx', text: '' }]).shrunk[0]?.count,
    0,
  );
  expect(
    'R2: matching the baseline exactly is clean',
    (() => {
      const r = run([{ file: 'src/pages/A.jsx', text: "fetch('/x')" }]);
      return r.grown.length + r.newFiles.length + r.shrunk.length;
    })(),
    0,
  );

  console.log(failures === 0 ? '\n✅ self-test: R1, R2 and the tokenizer each report both directions' : `\n❌ self-test: ${failures} case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--help')) {
    console.log('usage: node scripts/validate-page-data-access.cjs [--report] [--write-baseline] [--self-test]');
    return;
  }
  let result;
  try {
    result = check();
  } catch (err) {
    console.error(`[data-access] ✖ could not judge: ${err.message}`);
    process.exit(2);
  }
  if (argv.includes('--write-baseline')) {
    writeRatchet(BASELINE, 'Raw `fetch(` call sites still bypassing src/core/api/client.js. Frozen so the count cannot grow; regenerate with `node scripts/validate-page-data-access.cjs --write-baseline` when a file shrinks.', result.counts, ROOT);
    return;
  }

  if (argv.includes('--report')) {
    console.log(`\n${result.total} raw call(s) in ${result.counts.size} file(s); ${result.allowed.length} file(s) allowed with a reason\n`);
    for (const [file, n] of [...result.counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${file}`);
    }
    for (const file of result.allowed) console.log(`  ⬜ allowed  ${file}`);
  }

  const failed = result.grown.length > 0 || result.newFiles.length > 0 || result.shrunk.length > 0;
  console.log(
    `[data-access] ${result.scanned} file(s): ${result.total} raw fetch call(s) in ${result.counts.size} file(s) · ${result.grown.length} grown · ${result.newFiles.length} undeclared · ${result.shrunk.length} shrunk`,
  );
  // ⚠️ A file with NO baseline entry is R1 — "this file may not carry a transport of its own" — not a
  // ratchet breach. Reporting it as R2 would send the reader looking for a baseline entry to raise,
  // and there is none: the repair is to use the client, or to add an ALLOWED entry WITH a reason.
  for (const n of result.newFiles) {
    console.log(`  ✖ R1 ${n.file} — ${n.count} raw call(s); use apiGet/apiPost/apiPatch/apiDelete, or declare WHY the client cannot serve it in ALLOWED`);
  }
  for (const g of result.grown) console.log(`  ✖ R2 ${g.file} — ${g.was} → ${g.count} raw call(s); use the shared client`);
  for (const s of result.shrunk) console.log(`  ⚠ R2 ${s.file} — ${s.was} → ${s.count}; baseline is stale, run --write-baseline in this change`);
  if (failed) {
    console.log('[data-access] a raw fetch skips the timeout and the server’s own error message — both were measured failures.');
    process.exit(1);
  }
  console.log('[data-access] ✅ every raw call is either declared or frozen, and the ratchet holds');
}

if (require.main === module) main();

module.exports = { analyse, scanSource, stripNonCode };
