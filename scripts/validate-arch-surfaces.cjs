/**
 * validate-arch-surfaces.cjs — the two architecture surfaces must AGREE on the facts that are
 * supposed to be IDENTICAL (#902).
 *
 * WHY THIS EXISTS
 * ---------------
 * This repo carries the same architecture twice, on purpose:
 *
 *   src/core/architecture-reference.js        the AI-readable module (CURRENT_SLICE,
 *                                             CURRENT_ROUTE_CONTRACTS, DATABASE_SCHEMA)
 *   src/pages/architecture-framework.data.js  the human page (same sections, paraphrased)
 *
 * The duplication is a DESIGN choice (recorded in scripts/duplication-allowance.json), not a
 * mistake. The gap was that **nothing failed if one was updated and the other was not**. That is
 * not hypothetical: handoff batch #18 fixed a `CONTRACT_REGISTER_LAST_UPDATED` that one agent had
 * left at an older batch — and it was caught by a human reading both files, one batch late.
 *
 * WHAT IT ASSERTS — and, just as importantly, what it does NOT
 * -----------------------------------------------------------
 * The two files differ in LENGTH AND WORDING on purpose (the page paraphrases). A naive line-diff
 * or a "these files should be equal" check would fire constantly and would then be allowlisted —
 * and an allowlisted guard is worse than none, because it consumes attention and provides no cover.
 *
 * So this asserts ONLY the facts that are supposed to be byte-identical:
 *
 *   1. the `CONTRACT_REGISTER_LAST_UPDATED` **date + batch marker** — `YYYY-MM-DD (batch #N`.
 *      The trailing prose is EXPECTED to differ (the page truncates it); that is reported as INFO
 *      and never fails. The marker is the thing that actually broke.
 *   2. the **route set** in the contract register — routes are short, literal and exactly
 *      comparable. Both directions are checked.
 *
 * ⚠️ Known route drift is BASELINED, not ignored. `scripts/arch-surface-allowance.json` names every
 * route present in one surface and absent from the other, with a reason. A NEW divergence fails the
 * build. And a baselined route that has since been mirrored **also fails** (anti-rot): a stale
 * exemption silently widens the allowance and hides the next real drift.
 *
 * ⚠️ A verifier that cannot read its input must ERROR, never pass. If either file yields ZERO
 * routes, or the marker cannot be parsed, this exits 1 — a check that inspects nothing and reports
 * OK is worse than no check.
 *
 * Usage:  node scripts/validate-arch-surfaces.cjs              # check + exit code
 *         node scripts/validate-arch-surfaces.cjs --report     # full inventory
 *         node scripts/validate-arch-surfaces.cjs --self-test  # prove every rule can FAIL
 *         node scripts/validate-arch-surfaces.cjs --emit-baseline   # rewrite the allowance from
 *                                              # CURRENT reality, loudly, for deliberate review
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REF_FILE = path.join(ROOT, 'src', 'core', 'architecture-reference.js');
const PAGE_FILE = path.join(ROOT, 'src', 'pages', 'architecture-framework.data.js');
const ALLOWANCE_FILE = path.join(__dirname, 'arch-surface-allowance.json');

const LAST_UPDATED_RE = /export const CONTRACT_REGISTER_LAST_UPDATED\s*=\s*'([^']*)'/;
/**
 * `route: 'GET /api/x'` at the start of a line, optionally preceded by the opening `{` of the
 * object literal. Both shapes occur in these files. Anchored to the line so a `route:` mentioned
 * inside a contract's PROSE cannot be mistaken for a declaration.
 */
const ROUTE_RE = /^\s*\{?\s*route:\s*'([^']+)'/gm;
/** `2026-09-30 (batch #24: ...)` → date + batch. The prose after the colon is not compared. */
const MARKER_RE = /^\s*(\d{4}-\d{2}-\d{2})\s*\(batch\s*#(\d+)/i;

// ─────────────────────────────────────────────────────────────────────────────
// Pure parsing — every function below takes file CONTENT, so the self-test can
// feed synthetic input without touching the repository.
// ─────────────────────────────────────────────────────────────────────────────

/** The raw `CONTRACT_REGISTER_LAST_UPDATED` string, or null when the declaration is absent. */
function lastUpdatedValue(source) {
  const m = source.match(LAST_UPDATED_RE);
  return m ? m[1] : null;
}

/**
 * The comparable part of the value: its date and batch number.
 * Returns { date, batch, key } or null when it cannot be read.
 *
 * ⚠️ null is NOT "they agree". The caller must treat it as an error — see the header rule.
 */
function markerOf(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(MARKER_RE);
  if (!m) return null;
  return { date: m[1], batch: m[2], key: `${m[1]} (batch #${m[2]})` };
}

/** Every `route: '...'` literal in a contract register, de-duplicated and sorted. */
function routesOf(source) {
  const out = new Set();
  let m;
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(source)) !== null) out.add(m[1]);
  return [...out].sort();
}

/**
 * Compare two route sets.
 * @returns {{ onlyInReference: string[], onlyInPage: string[] }}
 */
function compareRoutes(refRoutes, pageRoutes) {
  const ref = new Set(refRoutes);
  const page = new Set(pageRoutes);
  return {
    onlyInReference: refRoutes.filter((r) => !page.has(r)),
    onlyInPage: pageRoutes.filter((r) => !ref.has(r)),
  };
}

/**
 * The whole check, over two file CONTENTS plus an allowance object.
 * Pure: no I/O, no process.exit — so the self-test exercises the same code the build runs.
 *
 * @returns {{ failures: string[], infos: string[], stats: object }}
 */
function check(refSource, pageSource, allowance) {
  const failures = [];
  const infos = [];
  const allow = allowance || {};
  const allowRef = allow.onlyInReference || {};
  const allowPage = allow.onlyInPage || {};

  // ---- fact 1: the contract-register date + batch marker --------------------
  const refValue = lastUpdatedValue(refSource);
  const pageValue = lastUpdatedValue(pageSource);
  const refMarker = markerOf(refValue);
  const pageMarker = markerOf(pageValue);

  if (refValue === null) failures.push('architecture-reference.js has no CONTRACT_REGISTER_LAST_UPDATED declaration — cannot compare.');
  if (pageValue === null) failures.push('architecture-framework.data.js has no CONTRACT_REGISTER_LAST_UPDATED declaration — cannot compare.');
  if (refValue !== null && refMarker === null) {
    failures.push(`CONTRACT_REGISTER_LAST_UPDATED in architecture-reference.js does not start with "YYYY-MM-DD (batch #N" — cannot compare. Got: ${JSON.stringify(refValue.slice(0, 60))}`);
  }
  if (pageValue !== null && pageMarker === null) {
    failures.push(`CONTRACT_REGISTER_LAST_UPDATED in architecture-framework.data.js does not start with "YYYY-MM-DD (batch #N" — cannot compare. Got: ${JSON.stringify(pageValue.slice(0, 60))}`);
  }
  if (refMarker && pageMarker && refMarker.key !== pageMarker.key) {
    failures.push(
      `CONTRACT_REGISTER_LAST_UPDATED disagrees: reference says "${refMarker.key}", page says "${pageMarker.key}". ` +
      'This is the exact divergence that reached the repo in handoff batch #16 and was found by a human one batch late (#902).',
    );
  }
  if (refMarker && pageMarker && refMarker.key === pageMarker.key && refValue !== pageValue) {
    infos.push(`CONTRACT_REGISTER_LAST_UPDATED marker agrees (${refMarker.key}); the trailing prose differs by ${pageValue.length - refValue.length} chars — expected, the page paraphrases.`);
  }

  // ---- fact 2: the route set ------------------------------------------------
  const refRoutes = routesOf(refSource);
  const pageRoutes = routesOf(pageSource);

  if (refRoutes.length === 0) failures.push('architecture-reference.js yielded ZERO routes — a check that reads nothing must not pass.');
  if (pageRoutes.length === 0) failures.push('architecture-framework.data.js yielded ZERO routes — a check that reads nothing must not pass.');

  const { onlyInReference, onlyInPage } = compareRoutes(refRoutes, pageRoutes);

  const unexpectedRef = onlyInReference.filter((r) => !(r in allowRef));
  const unexpectedPage = onlyInPage.filter((r) => !(r in allowPage));
  for (const r of unexpectedRef) failures.push(`route only in architecture-reference.js: "${r}" — mirror it on the page, or declare it in scripts/arch-surface-allowance.json with a reason.`);
  for (const r of unexpectedPage) failures.push(`route only in architecture-framework.data.js: "${r}" — mirror it in the reference module, or declare it in scripts/arch-surface-allowance.json with a reason.`);

  // ---- anti-rot: a baselined divergence that is now FIXED must be removed ---
  for (const r of Object.keys(allowRef)) {
    if (onlyInReference.includes(r)) continue;
    failures.push(`stale allowance: "onlyInReference" still lists "${r}", but the page now carries it. Delete the entry — a stale exemption silently widens the allowance.`);
  }
  for (const r of Object.keys(allowPage)) {
    if (onlyInPage.includes(r)) continue;
    failures.push(`stale allowance: "onlyInPage" still lists "${r}", but the reference module now carries it. Delete the entry — a stale exemption silently widens the allowance.`);
  }
  for (const r of Object.keys(allowRef)) {
    if (!refRoutes.includes(r)) failures.push(`stale allowance: "onlyInReference" lists "${r}", which is not in the reference module at all any more. Delete the entry.`);
  }
  for (const r of Object.keys(allowPage)) {
    if (!pageRoutes.includes(r)) failures.push(`stale allowance: "onlyInPage" lists "${r}", which is not on the page at all any more. Delete the entry.`);
  }

  return {
    failures,
    infos,
    stats: {
      refRoutes: refRoutes.length,
      pageRoutes: pageRoutes.length,
      onlyInReference: onlyInReference.length,
      onlyInPage: onlyInPage.length,
      baselined: Object.keys(allowRef).length + Object.keys(allowPage).length,
      marker: refMarker && pageMarker && refMarker.key === pageMarker.key ? refMarker.key : null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// I/O
// ─────────────────────────────────────────────────────────────────────────────

function readAllowance() {
  if (!fs.existsSync(ALLOWANCE_FILE)) return { onlyInReference: {}, onlyInPage: {} };
  return JSON.parse(fs.readFileSync(ALLOWANCE_FILE, 'utf8'));
}

function run() {
  const report = process.argv.includes('--report');
  const refSource = fs.readFileSync(REF_FILE, 'utf8');
  const pageSource = fs.readFileSync(PAGE_FILE, 'utf8');
  const allowance = readAllowance();
  const { failures, infos, stats } = check(refSource, pageSource, allowance);

  console.log(`[arch-surfaces] reference ${stats.refRoutes} routes · page ${stats.pageRoutes} routes · baselined drift ${stats.baselined}`);
  console.log(`[arch-surfaces] CONTRACT_REGISTER_LAST_UPDATED marker: ${stats.marker ?? 'UNREADABLE'}`);
  if (report) {
    for (const r of Object.keys(allowance.onlyInReference || {})) console.log(`   [ref-only]    ${r}`);
    for (const r of Object.keys(allowance.onlyInPage || {})) console.log(`   [page-only]   ${r}`);
  }
  for (const i of infos) console.log(`   ℹ ${i}`);
  for (const f of failures) console.error(`   ✗ ${f}`);
  if (failures.length) {
    console.error(`[arch-surfaces] ✗ ${failures.length} problem(s) — the two architecture surfaces disagree (#902).`);
    return 1;
  }
  console.log('[arch-surfaces] ✅ OK — the two architecture surfaces agree on every fact that is meant to be identical.');
  return 0;
}

/** Rewrite the allowance from CURRENT reality. Deliberate, loud, for review. */
function emitBaseline() {
  const { onlyInReference, onlyInPage } = compareRoutes(
    routesOf(fs.readFileSync(REF_FILE, 'utf8')),
    routesOf(fs.readFileSync(PAGE_FILE, 'utf8')),
  );
  const reason = (side) => `Mirrored on the ${side} only — route-contract drift recorded by #902. Remove this entry the moment the other surface carries the route; the guard FAILS on a stale entry.`;
  const out = {
    _why: 'Known route drift between the two architecture surfaces (#902). Both directions are checked; a NEW divergence fails the build, and a baselined route that has since been mirrored ALSO fails (anti-rot).',
    onlyInReference: Object.fromEntries([...onlyInReference].sort().map((r) => [r, reason('reference module')])),
    onlyInPage: Object.fromEntries([...onlyInPage].sort().map((r) => [r, reason('page')])),
  };
  fs.writeFileSync(ALLOWANCE_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`[arch-surfaces] wrote ${ALLOWANCE_FILE}: ${onlyInReference.length} ref-only, ${onlyInPage.length} page-only. REVIEW THEM — this is a backlog, not a fix.`);
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-test — a guard that has never been observed to fail is a decoration.
// Every canary below BREAKS the rule it names and asserts the failure is seen.
// ─────────────────────────────────────────────────────────────────────────────

function selfTest() {
  const REF_OK = `
export const CONTRACT_REGISTER_LAST_UPDATED = '2026-09-30 (batch #24: 25 handoffs — long prose.)';
export const CURRENT_ROUTE_CONTRACTS = [
  { route: 'GET /api/alpha', method: 'GET' },
  { route: 'GET /api/beta', method: 'GET' },
];
`;
  const PAGE_OK = `
export const CONTRACT_REGISTER_LAST_UPDATED = '2026-09-30 (batch #24: 25 handoffs — short.)';
export const CURRENT_ROUTE_CONTRACTS = [
  { route: 'GET /api/alpha', method: 'GET' },
  { route: 'GET /api/beta', method: 'GET' },
];
`;
  const NONE = { onlyInReference: {}, onlyInPage: {} };

  const cases = [];
  const t = (name, fn) => cases.push({ name, fn });

  t('baseline: identical markers + identical routes PASS', () => {
    const r = check(REF_OK, PAGE_OK, NONE);
    return r.failures.length === 0 && r.infos.some((i) => /trailing prose differs/.test(i));
  });

  t('CANARY marker date disagrees → FAIL', () => {
    const r = check(REF_OK, PAGE_OK.replace('2026-09-30', '2026-09-17'), NONE);
    return r.failures.some((f) => /disagrees/.test(f));
  });

  t('CANARY marker batch disagrees → FAIL', () => {
    const r = check(REF_OK, PAGE_OK.replace('batch #24', 'batch #19'), NONE);
    return r.failures.some((f) => /disagrees/.test(f));
  });

  t('CANARY unparseable marker → ERROR, never PASS', () => {
    const r = check(REF_OK, PAGE_OK.replace(/2026-09-30 \(batch #24/, 'sometime recently'), NONE);
    return r.failures.some((f) => /cannot compare/.test(f));
  });

  t('CANARY declaration absent → ERROR, never PASS', () => {
    const r = check(REF_OK, PAGE_OK.replace(/export const CONTRACT_REGISTER_LAST_UPDATED[^\n]*\n/, ''), NONE);
    return r.failures.some((f) => /no CONTRACT_REGISTER_LAST_UPDATED declaration/.test(f));
  });

  /** REF has beta, PAGE does not ⇒ beta is "only in the reference module". */
  const REF_MORE = REF_OK;
  const PAGE_LESS = PAGE_OK.replace("  { route: 'GET /api/beta', method: 'GET' },\n", '');

  t('CANARY route only in the reference module, undeclared → FAIL', () => {
    const r = check(REF_MORE, PAGE_LESS, NONE);
    return r.failures.some((f) => /route only in architecture-reference\.js/.test(f));
  });

  t('CANARY route only on the page, undeclared → FAIL', () => {
    const r = check(PAGE_LESS, REF_MORE, NONE);
    return r.failures.some((f) => /route only in architecture-framework\.data\.js/.test(f));
  });

  t('declared route drift PASSES', () => {
    const r = check(REF_MORE, PAGE_LESS, { onlyInReference: { 'GET /api/beta': 'backlog' }, onlyInPage: {} });
    return r.failures.length === 0;
  });

  t('CANARY stale allowance (now mirrored) → FAIL', () => {
    const r = check(REF_OK, PAGE_OK, { onlyInReference: { 'GET /api/beta': 'backlog' }, onlyInPage: {} });
    return r.failures.some((f) => /stale allowance/.test(f));
  });

  t('CANARY allowance names a route that is gone entirely → FAIL', () => {
    const r = check(REF_OK, PAGE_OK, { onlyInReference: {}, onlyInPage: { 'GET /api/gamma': 'x' } });
    return r.failures.some((f) => /not on the page at all any more/.test(f));
  });

  t('CANARY a file yields ZERO routes → ERROR, never PASS', () => {
    const r = check('export const X = 1;', PAGE_OK, NONE);
    return r.failures.some((f) => /ZERO routes/.test(f));
  });

  t('duplicate route declarations are de-duplicated, not counted twice', () => {
    const dup = REF_OK.replace("  { route: 'GET /api/beta', method: 'GET' },\n", "  { route: 'GET /api/beta', method: 'GET' },\n  { route: 'GET /api/beta', method: 'GET' },\n");
    const r = check(dup, PAGE_OK, NONE);
    return r.failures.length === 0;
  });

  t('CANARY both directions are checked independently (asymmetry is not silently one-way)', () => {
    const a = check(REF_MORE, PAGE_LESS, NONE);
    const b = check(PAGE_LESS, REF_MORE, NONE);
    return a.failures.some((f) => /only in architecture-reference\.js/.test(f))
      && !a.failures.some((f) => /only in architecture-framework\.data\.js/.test(f))
      && b.failures.some((f) => /only in architecture-framework\.data\.js/.test(f))
      && !b.failures.some((f) => /only in architecture-reference\.js/.test(f));
  });

  let passed = 0;
  for (const c of cases) {
    let ok = false;
    let err = null;
    try {
      ok = c.fn() === true;
    } catch (e) {
      err = e.message;
    }
    if (ok) {
      passed++;
      console.log(`   ✓ ${c.name}`);
    } else {
      console.error(`   ✗ ${c.name}${err ? ` — threw: ${err}` : ''}`);
    }
  }
  console.log(`\n[arch-surfaces] --self-test ${passed}/${cases.length} passed`);
  return passed === cases.length ? 0 : 1;
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  else if (process.argv.includes('--emit-baseline')) process.exit(emitBaseline());
  else process.exit(run());
}

module.exports = { lastUpdatedValue, markerOf, routesOf, compareRoutes, check };
