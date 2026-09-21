#!/usr/bin/env node
/**
 * validate-api-routes.cjs — every `/api/...` URL the frontend calls must exist on a NestJS controller.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (2026-09-17)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Two dead endpoints were found in one session, both by accident, both of the same shape:
 *
 *   1. `apiGet('/api/speed/scan')` — that route is POST-only, so the GET 404'd on every poll. The
 *      page showed "Awaiting live data" forever.
 *   2. `apiGet('/api/trading/strategies/bot-queue')` — **that route does not exist at all.** The
 *      strategies controller declares `@Get()`, `with-ratios`, `queues`, `risk-limits`, `bot-rules`
 *      and `:id`, so the URL fell through to `@Get(':id')` and called `findOne('bot-queue')`. It
 *      returned null; a `.catch(() => null)` hid the failure; a badge rendered `?` permanently.
 *
 * Neither produced an error anywhere. That is the signature this repo keeps re-finding — **plausible
 * output, no error, wrong thing underneath** — and it is exactly what a cross-boundary check is for.
 * Nothing checked that a URL the frontend invents is a URL the backend answers.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IT CHECKS
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   NestJS side :  `@Controller('trading/strategies')` + `@Get('bot-rules')`  →  GET /api/trading/strategies/bot-rules
 *   Frontend side:  `apiGet('/api/trading/strategies/queues')`               →  GET /api/trading/strategies/queues
 *
 * A frontend call whose URL matches no declared route is a **failure**. Path parameters are
 * normalised (`:id` and `${id}` both → `:p`), so `/api/trading/strategies/${id}/execute` matches
 * `@Post(':id/execute')`.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ HONEST LIMITS — read before trusting a pass
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   - **Static only.** It proves a route is DECLARED, never that it responds. A declared route can
 *     still 500 or return an empty body. `contract-probe.cjs` is the live check.
 *   - **Prefix assumption.** Every route is presumed to sit under `/api`. If a controller is
 *     registered elsewhere (or `setGlobalPrefix` changes), this reports false failures — it will
 *     say so loudly rather than passing quietly.
 *   - **Dynamic URLs are approximated.** `\`/api/x/${a}/${b}\`` normalises to `/api/x/:p/:p`, which
 *     can only be matched by a two-segment route. That is deliberate: it stays strict.
 *   - **`method` is part of the key.** A GET to a POST-only route fails here, which is the point
 *     (defect 1 above).
 *   - **Only the `apiGet`/`apiPost`/`apiPut`/`apiPatch`/`apiDelete` helpers are scanned.** A raw
 *     `fetch('/api/...')` is INVISIBLE. This was measured with a canary: a file containing only
 *     `fetch('/api/this-route-does-not-exist-at-all')` moved the call count by 0. The helpers are
 *     the house style, so the gap is currently theoretical — but it is a real blind spot, and the
 *     fix is to call the helper, not to widen this regex.
 *
 * ⚠️ THE WORST BLIND SPOT: A CONSTANT PREFIX. Measured 2026-09-18, after adding three calls to a
 * new page and watching the count NOT move (469 -> 469):
 *
 *     const TRADING = '/api/trading/strategies';
 *     apiGet(`${TRADING}/${id}`)            // <-- skipped entirely, not even counted
 *
 *     const API = '/api/trading/strategies';
 *     apiPost(`${API}`, body)               // <-- same
 *
 * The scanner requires the first argument to be a literal starting `/api/`, so this shape is
 * dropped BEFORE the unresolved counter — it is silent, which makes it worse than the raw-`fetch`
 * gap above (that one at least leaves nothing ambiguous about why it is missing).
 *
 * A guard whose count does not move when you add calls is telling you it cannot see them.
 *
 * Fix, not yet applied: pre-scan module scope for `const X = '/api/...'` and substitute before
 * matching. Trivial to parse, and it would recover most of the gap. Tracked in #867.
 *
 * ⚠️ **A check that scans nothing must FAIL, not pass.** If either side parses to zero entries this
 * exits non-zero and says which side is empty — an empty result is indistinguishable from a broken
 * parser otherwise, and a guard that inspects nothing is worse than no guard.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NEST_SRC = path.join(ROOT, 'nest', 'src');
const FE_SRC = path.join(ROOT, 'src');

/** Recursively collect files under `dir` whose name matches `re`. */
function walk(dir, re, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, re, out);
    } else if (re.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const VERBS = ['Get', 'Post', 'Put', 'Patch', 'Delete'];
/** `:id`, `:id?` and `${expr}` all collapse to the same token so the two sides can be compared. */
const normalisePath = (s) => s.replace(/\$\{[^}]*\}/g, ':p').replace(/:[A-Za-z0-9_]+/g, ':p').replace(/\/+$/, '');

/**
 * A template literal can hide a query string inside the expression — `\`/api/x${qs}\`` where `qs`
 * begins with `?` — leaving nothing literal to split on. Try the URL as written, and again with a
 * trailing expression removed. Both are honest candidates; a match on either is accepted.
 * ⚠️ Only a TRAILING expression is stripped. Stripping from the middle would let a wrong URL match.
 */
function urlVariants(raw) {
  const out = new Set();
  const push = (s) => {
    const v = normalisePath(s.split('?')[0]);
    // ⚠️ `/api` itself IS a route — `@Controller()` + `@Get()` is the server-info endpoint the
    // dashboard calls. A `length > 4` filter silently drops it and then reports a BLANK failure,
    // which reads as a parser crash rather than a missing route.
    if (v && v.startsWith('/api')) out.add(v);
  };
  push(raw);
  const stripped = raw.replace(/\$\{[^}]*\}\s*$/, '');
  if (stripped !== raw) push(stripped);
  return [...out];
}

// ── 1. Backend: every declared route ────────────────────────────────────────────────────────────
const routes = new Set();
let controllerFiles = 0;

for (const file of walk(NEST_SRC, /\.controller\.ts$/)) {
  const src = fs.readFileSync(file, 'utf8');
  // ⚠️ `@Controller()` with NO argument is legitimate and contributes routes at the root
  // (`@Get('version')` → `/api/version`). Requiring a quoted argument here skips the whole file
  // and reports its routes as missing — which is exactly what the first version of this script did.
  const ctrl = src.match(/@Controller\(\s*(?:['"]([^'"]*)['"])?\s*\)/);
  if (!ctrl) continue;
  controllerFiles += 1;
  const prefix = (ctrl[1] || '').replace(/^\/+|\/+$/g, '');

  for (const verb of VERBS) {
    // `@Get()` → '' ; `@Get('queues')` → 'queues'
    const re = new RegExp(`@${verb}\\(\\s*(?:['"]([^'"]*)['"])?\\s*\\)`, 'g');
    let m;
    while ((m = re.exec(src)) !== null) {
      const sub = (m[1] || '').replace(/^\/+|\/+$/g, '');
      const full = normalisePath(`/api/${[prefix, sub].filter(Boolean).join('/')}`);
      routes.add(`${verb.toUpperCase()} ${full}`);
    }
  }
}

/**
 * Blank out comments so a URL QUOTED IN DOCUMENTATION is not mistaken for a live call.
 *
 * ⚠️ Not optional. The first version of this script flagged `apiGet('/api/speed/scan?limit=8')` in
 * `MetaStackPipeline.jsx` — but that string sits inside the docblock explaining that the call was
 * REPOINTED to `/api/signals/best`. The real call, two lines below, is correct. Reporting an
 * already-fixed defect is how a guard loses its credibility, and a distrusted guard gets
 * allowlisted. Same fault class as a canary that matches globally and hits the wrong target.
 *
 * Characters become spaces rather than being removed, so reported line numbers still match.
 * Strings are preserved — the scanner needs them.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === '`' || c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j += 1;
        j += 1;
      }
      const stop = Math.min(j + 1, n);
      out += src.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// ── 2. Frontend: every URL it calls ─────────────────────────────────────────────────────────────
// ⚠️ Scanned as ONE string per file, not line by line. A call is frequently formatted across lines:
//
//     apiGet(
//       `/api/scoring/breakdown/${id}${qs}`,
//     )
//
// A per-line scanner captures nothing from that and reports a blank URL as a failure. A guard that
// cries wolf about its own parse gets allowlisted, and an allowlisted guard is worse than none.
//
// Calls whose first argument is NOT a string literal cannot be resolved statically. They are counted
// as UNRESOLVED and reported separately — never silently dropped, and never counted as a failure.
const calls = [];
let unresolved = 0;

for (const file of walk(FE_SRC, /\.(jsx?|mjs)$/)) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  const re = /\bapi(Get|Post|Put|Patch|Delete)\s*\(([\s\S]{0,400}?)\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const verb = m[1].toUpperCase();
    const line = src.slice(0, m.index).split('\n').length;
    const arg = m[2].trim();

    if (arg.startsWith('`') || arg.startsWith("'")) {
      const end = arg.indexOf(arg[0], 1);
      const raw = end === -1 ? null : arg.slice(1, end);
      if (raw == null) { unresolved += 1; continue; }
      if (!raw.startsWith('/api/')) continue; // a real call, just not to this API
      calls.push({
        verb,
        variants: urlVariants(raw),
        raw,
        file: rel,
        line,
        dynamic: /\$\{/.test(raw),
      });
    } else if (arg.length > 0) {
      // A variable, a helper, or a concatenation — real, but not statically knowable here.
      unresolved += 1;
    }
  }
}

// ── 3. Compare ──────────────────────────────────────────────────────────────────────────────────
// A call with no resolvable candidate URL is a PARSE gap, not a missing route — count it as
// unresolved rather than as a failure. Reporting a blank URL as a defect is how a guard loses trust.
const parseGaps = calls.filter((c) => c.variants.length === 0);
const checkable = calls.filter((c) => c.variants.length > 0);
const missing = checkable.filter((c) => !c.variants.some((v) => routes.has(`${c.verb} ${v}`)));

// ── 4. Report ───────────────────────────────────────────────────────────────────────────────────
console.log('validate-api-routes — frontend URL vs declared NestJS route');
console.log('─'.repeat(72));
console.log(`controllers scanned : ${controllerFiles}`);
console.log(`routes declared     : ${routes.size}`);
console.log(`frontend calls      : ${calls.length}  (${calls.filter((c) => c.dynamic).length} dynamic)`);
console.log(`unresolved (var arg): ${unresolved}  — not statically checkable, NOT counted as passing`);
if (parseGaps.length) {
  console.log(`parse gaps          : ${parseGaps.length}  — no candidate URL extracted (reported, not failed)`);
}
console.log('');

if (controllerFiles === 0 || routes.size === 0) {
  console.error('❌ CHECK INVALID — no routes parsed. The guard cannot judge anything.');
  console.error('   A check that inspects nothing must fail, never pass.');
  process.exit(1);
}
if (calls.length === 0) {
  console.error('❌ CHECK INVALID — no frontend API calls parsed.');
  console.error('   Either the call style changed, or this script is reading the wrong tree.');
  process.exit(1);
}

// ── 4b. Envelope must be called WITH a protocol ─────────────────────────────────────────────────
//
// WHY THIS EXISTS (2026-09-21, #925)
// ---------------------------------
// `GET /api/signals/envelope/:symbol` REFUSES to run unscoped — it returns
// `400 TCS-SYS-002 "Scoring requires a protocol"`. THREE pages called it with no protocol and
// rendered an empty card with no explanation, so the refusal was invisible:
//
//   src/pages/SymbolPage.jsx                 (empty Score card)
//   src/pages/AutomationDashboardPage.jsx    (empty Why Panel)
//   src/pages/ScoringActivityLogsPage.jsx    ("No directive data for X")
//
// The route-existence check above cannot catch this: the route EXISTS and the verb is right. The
// defect is a MISSING REQUIRED PARAMETER, which is the same class as the two dead endpoints this
// script was built for — a call that is syntactically fine and semantically refused.
//
// ⚠️ Scanned from SOURCE LINES, not from the captured URL. `urlVariants()` normalises and may drop
// a query string, so relying on it here would make this check blind to exactly the thing it checks.
// A guard that cannot see its own subject must not silently pass.
//
// The predicate is deliberately narrow: a line mentioning `signals/envelope` must also mention
// `protocol=`. Anything stricter would invent rules the API does not have.
const ENVELOPE = 'signals/envelope';
// ⚠️ NARROW ON PURPOSE. A bare `line.includes('signals/envelope')` matches DOCUMENTATION as well
// as callers — measured first run: 6 false positives, all of them prose (`view-meta.js` api lists,
// `qa-checklist.js` procedures, `architecture-framework.data.js`, a `PipelineGraphLabPage` endpoint
// array). A guard that cries wolf on its own docs gets allowlisted, and an allowlisted guard is
// worse than none. So the predicate requires an actual CALL: the route AND one of the house
// request helpers on the same line. Tighten this; never add an exemption list.
const CALL_HELPER = /\b(apiGet|apiPost|apiPut|apiPatch|apiDelete)\s*\(/;
const envelopeOffenders = [];
for (const file of walk(FE_SRC, /\.(jsx?|mjs)$/)) {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const lines = stripComments(src).split('\n');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  lines.forEach((line, i) => {
    if (!line.includes(ENVELOPE)) return;
    if (!CALL_HELPER.test(line)) return;   // documentation, not a call
    if (!line.includes('protocol=')) {
      envelopeOffenders.push(`${rel}:${i + 1}`);
    }
  });
}

if (envelopeOffenders.length) {
  console.error(`❌ ${envelopeOffenders.length} call(s) to /api/signals/envelope WITHOUT \`?protocol=\`:`);
  console.error('');
  for (const o of envelopeOffenders) console.error(`   ${o}`);
  console.error('');
  console.error('   That endpoint refuses to run unscoped (400 TCS-SYS-002). Resolve the protocol');
  console.error('   first with `useSymbolEnvelope(symbol)` from src/core/hooks/useSymbolEnvelope.js,');
  console.error('   which reads /api/symbols/:ticker/focus — NOT /api/symbols/:ticker/protocols,');
  console.error('   which is a dead endpoint that returns an empty list for every symbol (#926).');
  console.error('');
  process.exit(1);
}
console.log(`envelope calls      : ${envelopeOffenders.length} without ?protocol= (must be 0)`);

if (missing.length === 0) {
  console.log(`✅ OK — all ${checkable.length} resolvable frontend calls match a declared route.`);
  console.log('   ⚠️ Static only: this proves the route is DECLARED, not that it responds.');
  process.exit(0);
}

console.error(`❌ ${missing.length} frontend call(s) match NO declared route:`);
console.error('');
/**
 * Declared routes that share a prefix with `url`, ranked by shared segments.
 *
 * A bare "no route matches" forces the reader to go and parse the controller themselves, which is
 * how a finding gets deferred. Naming the near-miss turns it into a one-line fix: the usual causes
 * are a wrong verb, a missing segment, or a route on a different controller prefix.
 */
function nearMisses(pathStr, verb, limit = 3) {
  const seg = pathStr.split('/').filter(Boolean);
  const scored = [];
  for (const r of routes) {
    const sp = r.indexOf(' ');
    const rVerb = r.slice(0, sp);
    const rPath = r.slice(sp + 1);
    const rseg = rPath.split('/').filter(Boolean);
    let shared = 0;
    while (shared < seg.length && shared < rseg.length && seg[shared] === rseg[shared]) shared += 1;
    if (shared >= 2) scored.push({ r, shared, sameVerb: rVerb === verb });
  }
  scored.sort((a, b) => b.shared - a.shared || (b.sameVerb ? 1 : 0) - (a.sameVerb ? 1 : 0));
  return scored.slice(0, limit).map((s) => s.r);
}

for (const c of missing) {
  console.error(`   ${c.verb} ${c.variants.join(' | ')}`);
  console.error(`      ${c.file}:${c.line}${c.dynamic ? '  (built from a template literal)' : ''}`);
  const near = nearMisses(c.variants[0], c.verb);
  if (near.length) console.error(`      did you mean: ${near.join(', ')}`);
}
console.error('');
console.error('A URL the frontend invents that no controller answers 404s silently when wrapped in');
console.error('`.catch(() => …)`. Check the route spelling, the HTTP verb, and whether the endpoint');
console.error('lives on a different controller prefix.');
process.exit(1);
