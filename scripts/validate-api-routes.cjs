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
 * The scanner requires the first argument to be a literal starting `/api/`, so this shape is
 * dropped BEFORE the unresolved counter — it is silent, which makes it worse than the raw-`fetch`
 * gap above (that one at least leaves nothing ambiguous about why it is missing).
 *
 * A guard whose count does not move when you add calls is telling you it cannot see them.
 *
 * Fix, not yet applied: pre-scan module scope for `const X = '/api/...'` and substitute before
 * matching. Trivial to parse, and it would recover most of the gap. Tracked in #867.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * FIXED 2026-11-06 — FOUR PARSER FAULTS, EVERY ONE OF WHICH REPORTED LIVE ROUTES AS DEAD (#867)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The count was 19 and FIVE were phantoms. Each fault is recorded at the code that fixes it, and
 * each is canaried by `--self-test` — required by the repo's own rule that a guard never observed to
 * fail is a decoration:
 *
 *   1. `raw.split('?')[0]` cut at a `?` INSIDE an expression — `?.` optional chaining and ternaries.
 *   2. `arg.indexOf(quote)` stopped at a NESTED BACKTICK inside `${…}`.
 *   3. The call-argument regex stopped at the first `)` — including one inside the argument.
 *   4. The backend side never stripped comments, so a `@Controller(...)` QUOTED IN A DOCBLOCK set the
 *      prefix for the whole file; and `*.controller.ts` missed a controller in a `.module.ts`.
 *
 * ⚠️ A widening that lets more calls pass can also HIDE a defect, which is worse than a phantom. So
 * the trailing-expression rule is mechanical — a `${…}` directly after `/` is a PATH SEGMENT and is
 * never stripped — and `--self-test` asserts that direction too. Measured: without it,
 * `GET /api/market-data/candles/${symbol}` matched `@Get('candles')` (whose `symbol` is a QUERY
 * param) and the two genuinely broken calls on `SymbolDetailPage` and `PatternScannerPage` vanished.
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

/**
 * Advance past the `${…}` expression beginning at `start` (the index of `$`), using brace matching
 * that understands NESTED template literals. Returns the index just past the closing `}`, or -1.
 *
 * ⚠️ Naive brace counting is wrong here, and it showed up as a truncated URL the moment the
 * argument capture was fixed (2026-11-06):
 *
 *     `/api/broker-symbols/classes${brokerFilter ? `?brokerId=${brokerFilter}` : ''}`
 *
 * The `{` of the INNER `${brokerFilter}` was counted as an opening brace of the outer expression, so
 * the match ran past the real close and left `` :p` : ''} `` dangling on the end of the URL. A
 * URL with debris on it matches no route, so a live endpoint is reported dead — the same class of
 * false positive as the truncation, reached from the other direction.
 */
function endOfExpression(s, start) {
  let depth = 1;
  let i = start + 2;
  while (i < s.length && depth > 0) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === '`') {
      const nestedEnd = endOfStringLiteral(s, i);
      if (nestedEnd === -1) return -1;
      i = nestedEnd + 1;
      continue;
    }
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') depth -= 1;
    i += 1;
  }
  return depth === 0 ? i : -1;
}

/** Every complete `${…}` becomes `:p`. Template-aware, so a nested `${}` cannot leave debris. */
function replaceExpressions(raw) {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      const end = endOfExpression(raw, i);
      if (end === -1) { out += raw.slice(i); break; }
      out += ':p';
      i = end;
      continue;
    }
    out += raw[i];
    i += 1;
  }
  return out;
}

/** `:id`, `:id?` and `${expr}` all collapse to the same token so the two sides can be compared. */
const normalisePath = (s) => replaceExpressions(s).replace(/:[A-Za-z0-9_]+/g, ':p').replace(/\/+$/, '');

/**
 * Cut a query string from a template literal WITHOUT cutting inside a `${…}` expression.
 *
 * ⚠️ `raw.split('?')[0]` was the old implementation and it was WRONG. Measured 2026-11-06: it
 * produced FIVE phantom failures, every one of them a live route reported as dead.
 *
 *   `/api/scoring/protocols/${selectedProto?.id}/latest-score`
 *        the `?` here is OPTIONAL CHAINING (`?.`), not a query string
 *        → split gave  `/api/scoring/protocols/${selectedProto`   (an unclosed expression)
 *   `/api/broker-symbols/classes${brokerFilter ? '?brokerId=x' : ''}`
 *        the `?` here is a TERNARY inside the expression
 *        → split gave  `/api/broker-symbols/classes${brokerFilter `
 *
 * No route can match a truncated expression, so five endpoints that answer `200` were reported
 * dead — and the `?.` case is the house style, so the false positives grew with the codebase.
 *
 * This walks the string, skips each `${…}` by brace-matching, and cuts at the first `?` that is at
 * TOP LEVEL. A `?` inside an expression is never a query marker and is now never treated as one.
 */
function stripQuery(raw) {
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      const end = endOfExpression(raw, i);
      if (end === -1) return raw;
      i = end;
      continue;
    }
    if (raw[i] === '?') return raw.slice(0, i);
    i += 1;
  }
  return raw;
}

/**
 * If the literal ENDS with a `${…}` expression, return the index where that expression starts.
 * Otherwise -1.
 *
 * ⚠️ The old variant-builder used `/\$\{[^}]*\}\s*$/`, which could not match a trailing expression
 * that itself contains a nested template — so `${qs ? `?${qs}` : ''}` at the end of a URL produced
 * no stripped variant at all, and the URL kept a spurious `:p` on the end. Measured 2026-11-06:
 * `stop-guardian-stats${qs ? …}` was reported dead while `GET /api/trading/stop-guardian-stats`
 * answers 200. Template-aware, so nesting is handled.
 */
function trailingExpressionStart(raw) {
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      const end = endOfExpression(raw, i);
      if (end === -1) return -1;
      if (end === raw.length) return i;
      i = end;
      continue;
    }
    i += 1;
  }
  return -1;
}

/**
 * A template literal can hide a query string inside the expression — `\`/api/x${qs}\`` where `qs`
 * begins with `?` — leaving nothing literal to split on. Try the URL as written, and again with a
 * trailing expression removed. Both are honest candidates; a match on either is accepted.
 *
 * ⚠️ Only a TRAILING expression is stripped, AND only when it cannot be a PATH SEGMENT. The rule is
 * mechanical: an expression immediately preceded by `/` occupies a segment, so stripping it would
 * let a wrong URL match. Measured 2026-11-06 — without this guard the widening was a false NEGATIVE
 * that HID a real defect:
 *
 *     GET /api/market-data/candles/${symbol}?timeframe=…     frontend
 *     @Get('candles')  @Query('symbol')                       backend — symbol is a QUERY param
 *
 * So the call 404s (confirmed live) and the guard must keep saying so. Stripping it produced
 * `/api/market-data/candles`, which matched the declared route and silently excused the bug.
 */
function urlVariants(raw) {
  const out = new Set();
  const push = (s) => {
    const v = normalisePath(stripQuery(s));
    // ⚠️ `/api` itself IS a route — `@Controller()` + `@Get()` is the server-info endpoint the
    // dashboard calls. A `length > 4` filter silently drops it and then reports a BLANK failure,
    // which reads as a parser crash rather than a missing route.
    if (v && v.startsWith('/api')) out.add(v);
  };
  push(raw);
  const cut = trailingExpressionStart(stripQuery(raw));
  const isPathSegment = cut > 0 && stripQuery(raw)[cut - 1] === '/';
  if (cut > 0 && !isPathSegment) push(raw.slice(0, cut));
  return [...out];
}

// ── 1. Backend: every declared route ────────────────────────────────────────────────────────────
const routes = new Set();
let controllerFiles = 0;

// ⚠️ EVERY `.ts` FILE, NOT JUST `*.controller.ts` (fixed 2026-11-06). Measured: `snapshots.module.ts`
// declares a full `@Controller('snapshots')` class — `@Post('import')`, `@Post('compare')`,
// `@Get(':id/replay')` and five more. A `*.controller.ts` glob cannot see it, so two LIVE routes were
// reported dead. A controller in a module file is poor placement, but the guard's job is to describe
// the routes that exist, not the routes that follow a naming convention. Specs are skipped because a
// test may legitimately quote `@Controller(...)`.
for (const file of walk(NEST_SRC, /\.ts$/)) {
  if (file.endsWith('.spec.ts')) continue;
  // ⚠️ COMMENTS ARE STRIPPED HERE TOO (fixed 2026-11-06). Without it, a `@Controller(...)` QUOTED IN
  // A DOCBLOCK sets the prefix for the whole file. Measured on `trend-read.controller.ts`, whose
  // comment says *"Writing `@Controller('api/trend')` produces `/api/api/trend`, which 404s"* —
  // and the guard read that quoted example as the prefix, producing `/api/api/trend/read` and
  // reporting two live routes as dead. The guard fell for the exact trap the comment documents.
  const src = stripComments(fs.readFileSync(file, 'utf8'));
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

/**
 * Find the index of the closing quote of the string literal that begins at `start`.
 *
 * ⚠️ `arg.indexOf(arg[0], 1)` was the old implementation and it stopped at a NESTED BACKTICK.
 * Measured 2026-11-06 on a route that answers `200`:
 *
 *     apiGet(`/api/broker-symbols/classes${brokerFilter ? `?brokerId=${brokerFilter}` : ''}`)
 *                                                    ^ inner template opens here
 *
 * so the extracted URL ended at `${brokerFilter ? ` — truncated mid-expression, and no route can
 * match a truncated expression. A nested template inside `${}` is ordinary JavaScript; the guard
 * has to read it rather than stop at it.
 */
function endOfStringLiteral(s, start) {
  const quote = s[start];
  if (quote === "'" || quote === '"') {
    for (let i = start + 1; i < s.length; i += 1) {
      if (s[i] === '\\') { i += 1; continue; }
      if (s[i] === quote) return i;
    }
    return -1;
  }
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === '`') return i;
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < s.length && depth > 0) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === '`') {
          const nestedEnd = endOfStringLiteral(s, i);
          if (nestedEnd === -1) return -1;
          i = nestedEnd + 1;
          continue;
        }
        if (s[i] === '{') depth += 1;
        else if (s[i] === '}') depth -= 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return -1;
}

// ── 1b. SELF-TEST — prove the parser fails when it should ───────────────────────────────────────
//
// ⚠️ REQUIRED by the repo's own rule: *"Any NEW audit or validator script must ship a `--self-test`…
// A guard that has never been observed to fail is a decoration."* This one has now been wrong three
// times in one afternoon (truncated at a nested template, split at a `?` inside an expression,
// debris left by naive brace counting), and every fault made LIVE routes look dead.
//
// TWO DIRECTIONS. Each case asserts the exact variant produced, and cases 1–4 and 6 additionally
// assert the result MATCHES a declared route. Case 5 asserts the opposite — that the stripped variant
// is ABSENT — because stripping there was a false NEGATIVE that hid a real defect.
if (process.argv.includes('--self-test')) {
  const CASES = [
    ['`?` inside an expression — optional chaining',
      '/api/scoring/protocols/${selectedProto?.id}/latest-score',
      '/api/scoring/protocols/:p/latest-score', true],
    ['`?` inside an expression — ternary, nested template',
      '/api/trading/stop-guardian-stats${qs ? `?${qs}` : \'\'}',
      '/api/trading/stop-guardian-stats', true],
    ['nested template must not truncate the literal',
      '/api/broker-symbols/classes${brokerFilter ? `?brokerId=${brokerFilter}` : \'\'}',
      '/api/broker-symbols/classes', true],
    ['function call inside the expression',
      '/api/scoring/exit-consensus${botName ? `?bot=${encodeURIComponent(botName)}` : \'\'}',
      '/api/scoring/exit-consensus', true],
    ['a trailing ${…} directly after "/" is a PATH SEGMENT — must NOT be stripped',
      '/api/market-data/candles/${symbol}?timeframe=${timeframe}',
      '/api/market-data/candles', false],
    ['plain query string after an expression',
      '/api/trend/read?symbol=${encodeURIComponent(symbol)}&bars=200',
      '/api/trend/read', true],
    // ⚠️ Covers the glob fix: this route lives in `snapshots.module.ts`, NOT a `*.controller.ts`.
    // The 5th element is the VERB — the match check defaults to GET, and this one is POST-only.
    ['a controller declared OUTSIDE *.controller.ts must still be found',
      '/api/snapshots/import',
      '/api/snapshots/import', true, 'POST'],
  ];

  let failures = 0;
  for (const [label, raw, expected, mustMatch, routeVerb = 'GET'] of CASES) {
    const variants = urlVariants(raw);
    const hasVariant = variants.includes(expected);
    const matches = variants.some((v) => routes.has(`${routeVerb} ${v}`));

    if (!mustMatch) {
      // NEGATIVE case: the variant must NOT be produced at all, because producing it hides a defect.
      if (hasVariant) {
        console.error(`  ✖ ${label} — the stripped variant exists, so a real defect is HIDDEN`);
        console.error(`      ${JSON.stringify(variants)}`);
        failures += 1;
      }
      continue;
    }

    if (!hasVariant) {
      console.error(`  ✖ ${label}`);
      console.error(`      expected variant ${expected}`);
      console.error(`      got            ${JSON.stringify(variants)}`);
      failures += 1;
      continue;
    }
    if (!matches) {
      console.error(`  ✖ ${label} — variant produced, but no declared route matches it`);
      console.error(`      ${JSON.stringify(variants)}`);
      failures += 1;
    }
  }

  // Sanity: a made-up route must never match, or the positive cases above prove nothing.
  const bogus = urlVariants('/api/self-test-these-words-do-not-exist/${id}');
  if (bogus.some((v) => routes.has(`GET ${v}`))) {
    console.error('  ✖ a made-up route matched a declared route — the positive cases are worthless');
    failures += 1;
  }

  if (routes.size === 0) {
    console.error('  ✖ no routes parsed — the self-test cannot judge anything');
    failures += 1;
  }

  if (failures) {
    console.error(`\n[validate-api-routes] ✖ SELF-TEST FAILED — ${failures} case(s)`);
    process.exit(1);
  }
  console.log(`[validate-api-routes] ✅ SELF-TEST — ${CASES.length} URL-shape case(s) + 1 bogus-route check, against ${routes.size} declared route(s)`);
  process.exit(0);
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
// ⚠️ THE ARGUMENT IS READ FROM THE SOURCE, NOT FROM A REGEX CAPTURE (fixed 2026-11-06). The old
// regex was `api(Get|…)\(([\s\S]{0,400}?)\)`, which stops at the FIRST `)` anywhere — including one
// inside the first argument:
//
//     apiGet(`/api/scoring/exit-consensus${botName ? `?bot=${encodeURIComponent(botName)}` : ''}`)
//                                                                   ^ capture ended here
//
// so the URL was truncated and a live route was reported dead. Since only the FIRST argument is
// needed, the literal is now read directly from its opening quote with `endOfStringLiteral`, which
// makes the capture immune to parentheses, nested templates and ternaries alike.
//
// Calls whose first argument is NOT a string literal cannot be resolved statically. They are counted
// as UNRESOLVED and reported separately — never silently dropped, and never counted as a failure.
const calls = [];
let unresolved = 0;

for (const file of walk(FE_SRC, /\.(jsx?|mjs)$/)) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  const re = /\bapi(Get|Post|Put|Patch|Delete)\s*\(\s*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const verb = m[1].toUpperCase();
    const line = src.slice(0, m.index).split('\n').length;
    const argStart = m.index + m[0].length;
    const q = src[argStart];

    if (q === '`' || q === "'" || q === '"') {
      const end = endOfStringLiteral(src, argStart);
      if (end === -1) { unresolved += 1; continue; }
      const raw = src.slice(argStart + 1, end);

      // ⚠️ CONCATENATION: `'/api/portfolio/accounts/' + id`. The literal is only a PREFIX, so the
      // real URL is unknowable here. Producing `/api/portfolio/accounts` from it invents a URL that
      // ends at the base — and for a POST that route does not exist, so the guard reported a defect
      // that is not there. Measured 2026-11-06: `ScreenOptions.jsx:526` was flagged `POST
      // /api/portfolio/accounts` while `@Post(':id')` declares `/api/portfolio/accounts/:id` and
      // answers 400 (route exists, body rejected). Counted as UNRESOLVED instead — the honest answer.
      if (/^\s*\+/.test(src.slice(end + 1, end + 8))) { unresolved += 1; continue; }

      if (!raw.startsWith('/api/')) continue; // a real call, just not to this API
      calls.push({
        verb,
        variants: urlVariants(raw),
        raw,
        file: rel,
        line,
        dynamic: /\$\{/.test(raw),
      });
    } else if (q !== ')') {
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

// `--report` prints the same finding set but does NOT fail the build.
//
// ⚠️ Only the FINDINGS are downgraded. The two INVALID checks above (no routes parsed / no calls
// parsed) still exit 1 under `--report`, because a run that inspected nothing must never pass —
// that is the whole reason they exist. `--self-test` is the fatal gate in `prebuild`; the count is
// reported until it reaches zero, at which point this flag should be dropped (see #867).
const REPORT_ONLY = process.argv.includes('--report');
if (REPORT_ONLY) {
  console.log(`⚠️  REPORT ONLY — ${missing.length} unresolved call(s) (build NOT failed; #867 drives this to 0)`);
} else {
  console.error(`❌ ${missing.length} frontend call(s) match NO declared route:`);
}
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
process.exit(REPORT_ONLY ? 0 : 1);
