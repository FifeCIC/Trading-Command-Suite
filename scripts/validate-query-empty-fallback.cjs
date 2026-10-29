#!/usr/bin/env node
/**
 * validate-query-empty-fallback.cjs — a failed query must not resolve to an EMPTY LIST.
 * =================================================================================================
 *
 * THE DEFECT THIS GUARDS (#782)
 * -----------------------------
 * `queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] }))`
 *
 * `apiGet` carefully builds an error carrying the status AND the server's message; the `.catch()`
 * throws all of it away and returns **the same shape as a successful empty response**. Three measured
 * consequences:
 *
 *   1. the page prints a confident factual claim — *"No active protocols."* — when the truth is
 *      "I could not ask";
 *   2. react-query records a **SUCCESS**, so `isError`, `error` and the retry policy never engage, and
 *      the stale-but-empty result is pinned for the whole `staleTime` (60s on the protocols list);
 *   3. 🔴 the empty list **destroyed the saved selection**: `LadderPage` prunes stored ids against the
 *      applicable protocol list, so one 502 during an API restart emptied the user's choice for good.
 *
 * ── WHY `[]` AND NOT `null` ────────────────────────────────────────────────────────────────────
 * `catch(() => null)` is ABSENCE — a caller can distinguish it (`data == null`) and render "unavailable".
 * `catch(() => [])` and `catch(() => ({ x: [] }))` are EMPTINESS — they assert "there is nothing", which
 * is a claim about the registry, not about the request. Only the second shape is failed here.
 *
 * ── THIS IS A RATCHET, NOT A CLEAN SWEEP ───────────────────────────────────────────────────────
 * Measured 2026-10-28: 21 matching lines, 3 of them COMMENTS that explicitly warn against the pattern,
 * so **18 live sites** — exactly the count in the issue. Rewriting all 18 needs each page to render an
 * error state, which is a page-by-page job; this gate stops the number GROWING today and prints the
 * shrinking number so the sweep is visible. A baselined file that grows fails; one that shrinks prints
 * the new number to bank (not a failure — a gate that fires when you FIX something gets allowlisted).
 *
 * ⚠️ Comment lines are skipped: the two places that document the anti-pattern in prose must not be
 * counted as instances of it. Narrow beats broad.
 *
 * Usage:
 *   node scripts/validate-query-empty-fallback.cjs            # gate
 *   node scripts/validate-query-empty-fallback.cjs --list     # every live site, with file:line
 *   node scripts/validate-query-empty-fallback.cjs --self-test
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/**
 * ⚠️ MEASURED 2026-10-28 — the fee is real and it is owed page by page. Each entry is a file that
 * currently converts a failure into an empty collection. Lower these as pages gain an error state;
 * a NEW file (or growth in one of these) fails the gate.
 */
const BASELINE = {
  'src/components/ProtocolPicker.jsx': 1,
  'src/components/SymbolAutocomplete.jsx': 1,
  'src/components/widgets/builtin-widgets.jsx': 2,
  'src/components/widgets/dashboard-widgets.jsx': 3,
  'src/core/broker-utils.js': 1,
  'src/core/hooks/useSpeedCockpit.js': 1,
  'src/core/protocol-status.js': 1,
  'src/hooks/useStrategyRegistry.js': 1,
  'src/hooks/useSymbolLookups.js': 1,
  'src/pages/ActiveSymbolsPage.jsx': 1,
  'src/pages/AutomationSettingsPage.jsx': 1,
  'src/pages/BacktestDataPage.jsx': 1,
  'src/pages/BacktestPage.jsx': 1,
  'src/pages/CapabilityMapPage.jsx': 1,
  'src/pages/CreateProtocolsPage.jsx': 3,
  'src/pages/DailyBriefingPage.jsx': 3,
  'src/pages/MarketContextPage.jsx': 2,
  'src/pages/MetaStackExplorerPage.jsx': 9,
  'src/pages/MonitoringPage.jsx': 1,
  'src/pages/PerformanceLabPage.jsx': 1,
  'src/pages/PortfolioPage.jsx': 1,
  'src/pages/ProtocolsPageB.jsx': 1,
  'src/pages/ProtocolsPerformancePage.jsx': 3,
  'src/pages/SeesArenaPage.jsx': 1,
  'src/pages/SnapshotReplayPage.jsx': 1,
  'src/pages/StrategiesListPage.jsx': 1,
  'src/pages/StrategyCreatePage.jsx': 3,
  'src/pages/StrategyMonitorPage.jsx': 2,
  'src/pages/SymbolsLadderPage.jsx': 1,
  'src/pages/T212PortfolioPage.jsx': 2,
  'src/pages/TradeJournalPage.jsx': 3,
  'src/pages/UserWatchlistsPage.jsx': 1,
};

/**
 * ⚠️ DOCUMENTATION-CONTENT MODULES ARE NOT CODE. Three files hold the pattern inside a STRING — the
 * architecture reference, the Architecture Framework page data and the QA checklist quote
 * `.catch(() => ({ protocols: [] }))` while DESCRIBING this very defect. Reporting those as instances
 * would make the permanent record of the bug look like a recurrence of it.
 */
const DOC_CONTENT_FILES = new Set([
  'src/core/architecture-reference.js',
  'src/pages/architecture-framework.data.js',
  'src/data/qa-checklist.js',
]);

/**
 * `catch(() => [])` or `catch(() => ({ key: [] }))` — emptiness, not absence.
 * ⚠️ The optional `\(?` matters: a returned OBJECT LITERAL is wrapped in parentheses by every formatter
 * (`() => ({ protocols: [] })`), so a pattern that expects `{` straight after `=>` misses the very shape
 * this repo uses most. The self-test caught that.
 */
const EMPTY_FALLBACK_RE = /\.catch\(\s*\(\s*\)\s*=>\s*\(?\s*(\[\s*\]|\{[^{}]*:\s*\[\s*\][^{}]*\})/;

/**
 * A line inside a comment cannot be an instance — several pages document the anti-pattern in prose, and
 * one of those prose lines begins with `(` (so a prefix test alone reports it as a hit; measured
 * 2026-10-28 on `StrategyCreatePage.jsx`). The scanner therefore tracks block-comment state.
 */
function scanText(file, text) {
  const found = [];
  let inBlock = false;
  text.split(/\r?\n/).forEach((line, i) => {
    const opening = inBlock;
    if (inBlock && line.includes('*/')) inBlock = false;
    else if (!inBlock && /\/\*/.test(line) && !/\*\//.test(line)) inBlock = true;
    if (opening) return;
    if (/^\s*(\/\/|\*)/.test(line)) return;
    // A trailing `// …` must not make a code line invisible, so only the code part is tested.
    const code = line.split('//')[0];
    if (EMPTY_FALLBACK_RE.test(code)) found.push({ file, line: i + 1, text: line.trim() });
  });
  return found;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!/\.(js|jsx)$/.test(e.name)) continue;
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (DOC_CONTENT_FILES.has(rel)) continue;
    out.push(full);
  }
}

function collect() {
  const files = [];
  walk(SRC, files);
  const hits = [];
  for (const full of files) {
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    hits.push(...scanText(rel, fs.readFileSync(full, 'utf8')));
  }
  return hits;
}

function evaluate(hits, baseline) {
  const counts = {};
  for (const h of hits) counts[h.file] = (counts[h.file] ?? 0) + 1;

  const newFiles = [];
  const grown = [];
  const shrunk = [];
  for (const [file, n] of Object.entries(counts)) {
    const allowed = baseline[file];
    if (allowed === undefined) newFiles.push({ file, n });
    else if (n > allowed) grown.push({ file, n, allowed });
    else if (n < allowed) shrunk.push({ file, n, allowed });
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    if (counts[file] === undefined) shrunk.push({ file, n: 0, allowed });
  }
  return { newFiles, grown, shrunk, total: hits.length };
}

function selfTest() {
  let failures = 0;
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`   ${ok ? '✅' : '❌'} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) failures += 1;
  };

  // 1. The cited shape is detected.
  check(
    'detects catch(() => [])',
    scanText('a.js', "queryFn: () => apiGet('/x').catch(() => []),").length,
    1,
  );
  // 2. The object form is detected too.
  check(
    'detects catch(() => ({ protocols: [] }))',
    scanText('a.js', "queryFn: () => apiGet('/x').catch(() => ({ protocols: [] })),").length,
    1,
  );
  // 3. `null` is ABSENCE, not emptiness — must NOT be reported.
  check('ignores catch(() => null)', scanText('a.js', "queryFn: () => apiGet('/x').catch(() => null),").length, 0);
  // 4. A comment documenting the anti-pattern is not an instance of it.
  check('ignores a comment', scanText('a.js', '// ⚠️ No `.catch(() => [])`. A failure must stay null.').length, 0);
  // 5. Growth in a baselined file fails; a shrink is reported, not failed.
  const two = [
    { file: 'src/a.jsx', line: 1 },
    { file: 'src/a.jsx', line: 2 },
  ];
  const grown = evaluate(two, { 'src/a.jsx': 1 });
  check('growth in a baselined file FAILS', grown.grown.length, 1);
  check('…and is not counted as new', grown.newFiles.length, 0);
  const shrunk = evaluate([{ file: 'src/a.jsx', line: 1 }], { 'src/a.jsx': 2 });
  check('a shrink is NOT a failure', shrunk.grown.length + shrunk.newFiles.length, 0);
  check('…but is reported', shrunk.shrunk.length, 1);
  // 6. A brand-new file is a failure.
  check('a new file FAILS', evaluate([{ file: 'src/b.jsx', line: 1 }], {}).newFiles.length, 1);

  console.log(failures === 0 ? '\n[self-test] ✅ PASS\n' : `\n[self-test] ❌ ${failures} case(s) failed\n`);
  return failures === 0 ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const hits = collect();
  if (args.includes('--list')) {
    for (const h of hits) console.log(`   ${h.file}:${h.line}  ${h.text}`);
    console.log(`\n${hits.length} live site(s) across ${new Set(hits.map((h) => h.file)).size} file(s)\n`);
    return 0;
  }

  const { newFiles, grown, shrunk, total } = evaluate(hits, BASELINE);
  console.log(`\n[query-empty-fallback] ${total} live site(s) where a failed query resolves to an EMPTY list`);

  if (shrunk.length > 0) {
    console.log('   ℹ️  fixed since the baseline was banked — lower these numbers:');
    for (const s of shrunk) console.log(`      • ${s.file}: ${s.allowed} → ${s.n}`);
  }

  if (newFiles.length === 0 && grown.length === 0) {
    console.log(`   ✅ no new site — every remaining one is baselined by page (${Object.values(BASELINE).reduce((a, b) => a + b, 0)} allowed)`);
    console.log('   ⚠️ each of those can still print "nothing here" for an outage; #782 tracks the sweep\n');
    return 0;
  }

  console.error('\n❌ a failed query now resolves to an EMPTY list — that is a claim about the data, not');
  console.error('   about the request, and it defeats react-query error handling (#782):\n');
  for (const f of newFiles) console.error(`   NEW   ${f.file} — ${f.n} site(s)`);
  for (const g of grown) console.error(`   GREW  ${g.file} — ${g.allowed} → ${g.n}`);
  console.error('\n   Remove the .catch() and let isError render, or return null (absence is distinguishable).\n');
  return 1;
}

process.exit(main());
