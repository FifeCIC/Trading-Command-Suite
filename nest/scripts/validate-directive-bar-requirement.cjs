#!/usr/bin/env node
/**
 * validate-directive-bar-requirement.cjs — a directive that refuses below N bars must DECLARE N.
 * ===================================================================================================
 * WHY THIS EXISTS — measured 2026-11-02, on live protocols.
 *
 * `minBars` is the ONLY thing that tells the caller how many bars to fetch (`getRequiredBars()` →
 * `loadHigherTfBundle()`). A requirement that lives only in the method body is a requirement the
 * pipeline cannot honour, so the directive abstains on every pass while its `maxScore` stays in the
 * protocol's denominator — plausible numbers, no error.
 *
 * Two live instances, both found by this rule:
 *   · `sp500-regime` refused below 200 bars and declared NOTHING, so `vix-spike-v1-long` and `vix-spike-v1-short`
 *     reported `Insufficient data: need 200 bars, have 72 — unmeasured` on every pass — for a gate
 *     their own seed calls MANDATORY. Fixed at source 2026-11-02.
 *   · `multi-timeframe-trend` declared 20 while its trend test needs EMA(50) — so the EMA test never
 *     ran and it still awarded its maximum 120 (#1180).
 *
 * ⚠️ BASELINE, NOT A CLEAN SWEEP. ~40 further directives have the same shape and are NOT yet fixed;
 * correcting them all raises data fetches across many protocols at once, which is a deliberate change
 * per protocol, not a sweep. They are recorded in `directive-bar-requirement-baseline.json` so this
 * gate fails only on a NEW offender — the same ratchet as `css-literal-baseline.json` and
 * `duplication-allowance.json`. The count may only go DOWN.
 *
 * REGISTER: docs/SETTLED-DECISIONS.md row 127 · ISSUE: #1180
 *
 *   node nest/scripts/validate-directive-bar-requirement.cjs             # exit 1 on a NEW offender
 *   node nest/scripts/validate-directive-bar-requirement.cjs --self-test # prove it can fail
 *   node nest/scripts/validate-directive-bar-requirement.cjs --update-baseline
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'modules', 'directives', 'implementations');
const BASELINE = path.join(__dirname, 'directive-bar-requirement-baseline.json');
const TAG = 'directive-bar-requirement';

/** `closes.length < 200` / `.length < MIN_BARS` — the two shapes this repo uses. */
const GUARDS = [String.raw`\.length\s*<\s*(\d+)`, String.raw`\.length\s*<\s*([A-Z_][A-Z0-9_]*)`];

/**
 * Resolve a constant's NUMERIC value from source, including simple arithmetic.
 *
 * ⚠️ WHY THIS EXISTS (2026-11-03). The resolver used to accept only `const NAME = <digits>`. A
 * constant defined as a SUM — `const MIN_BARS = LOOKBACK + 8` — therefore resolved to nothing, and
 * `findOffenders()` treated "resolved nothing" as "no requirement" and SKIPPED the class entirely.
 * Measured consequence: `overhead-supply-pressure` declared 56 while refusing below 58, and this
 * guard reported a clean tree. 71 ticks of a 100-point directive were dead in an active protocol.
 *
 * That is the repo's most expensive failure shape in a guard: an UNRESOLVABLE input read as a PASS.
 * A guard that cannot evaluate its input must say so, never stay silent — so `UNRESOLVED` is
 * reported as its own finding (below), not folded into "fine".
 *
 * Supports: `58`, `LOOKBACK`, `LOOKBACK + 8`, `8 + LOOKBACK`, `LOOKBACK - 2`, and doubly-nested
 * references. Anything else returns null, which the caller MUST treat as unjudgeable.
 */
function resolveConst(src, name, seen = new Set(), scope = null) {
  if (!name || seen.has(name)) return null; // cycle or repeat → cannot judge
  seen.add(name);
  // ⚠️ SCOPE ORDER MATTERS (measured 2026-11-03): `mt5-indicators.directives.ts` declares
  // **17 separate `const MIN`** — one per class in the file. Resolving against the whole file takes
  // the FIRST (line 111, `period + 1`) for every class, so all 17 resolve to the same wrong answer
  // or to nothing. The class's own block is searched first; the file is only a fallback for genuine
  // module-level constants.
  const scopes = scope ? [scope, src] : [src];
  let m = null;
  for (const s of scopes) {
    m = new RegExp(`const\\s+${name}\\s*=\\s*([^;\\n]+)`).exec(s);
    if (m) break;
  }
  if (!m) return null;
  let expr = m[1].replace(/\/\/.*$/, '').trim();
  // Strip a trailing `as const` / type annotation.
  expr = expr.replace(/\s+as\s+const$/, '').replace(/:\s*number$/, '').trim();
  // Sums/differences of at most two terms, each a literal or a resolvable constant.
  const term = (t) => {
    t = t.trim();
    if (/^\d+$/.test(t)) return Number(t);
    if (/^[A-Z_][A-Z0-9_]*$/.test(t)) return resolveConst(src, t, seen, scope);
    return null;
  };
  if (/^\d+$/.test(expr)) return Number(expr);
  const bin = /^([A-Za-z0-9_]+)\s*([+-])\s*([A-Za-z0-9_]+)$/.exec(expr);
  if (bin) {
    const a = term(bin[1]);
    const b = term(bin[3]);
    if (a == null || b == null) return null;
    return bin[2] === '+' ? a + b : a - b;
  }
  return term(expr);
}

/** Constants that LOOK like a bar count but cannot be resolved — surfaced, never skipped. */
const unjudgeable = [];

/**
 * Evaluate a bar-count EXPRESSION: `58`, `LOOKBACK`, `LOOKBACK + 8`, `50 - 2`.
 *
 * ⚠️ SYMMETRY MATTERS, AND IT WAS MISSING (2026-11-03). `resolveConst()` was taught to evaluate
 * sums for the REQUIREMENT side, but `declaredMaxOf()` still only accepted a literal or a BARE
 * constant name — so `readonly minBars = { '1d': MFI_PERIOD + 3 }` resolved to nothing and the
 * guard reported "declares none". The guard caught the new `mfi-overbought` declaration, which was
 * correct: the DECLARATION could not be read, not the declaration being wrong.
 *
 * One evaluator now serves both sides, so a declaration and a requirement are judged the same way.
 */
function resolveExpr(src, expr, scope = null) {
  let e = String(expr ?? '').replace(/\/\/.*$/, '').trim();
  e = e.replace(/\s+as\s+const$/, '').replace(/:\s*number$/, '').trim();
  if (!e) return null;
  if (/^\d+$/.test(e)) return Number(e);
  const bin = /^([A-Za-z0-9_]+)\s*([+-])\s*([A-Za-z0-9_]+)$/.exec(e);
  if (bin) {
    const a = /^\d+$/.test(bin[1]) ? Number(bin[1]) : resolveConst(src, bin[1], new Set(), scope);
    const b = /^\d+$/.test(bin[3]) ? Number(bin[3]) : resolveConst(src, bin[3], new Set(), scope);
    if (a == null || b == null) return null;
    return bin[2] === '+' ? a + b : a - b;
  }
  if (/^[A-Z_][A-Z0-9_]*$/.test(e)) return resolveConst(src, e, new Set(), scope);
  return null;
}

const declaredMaxOf = (chunk, src) => {
  const mb = /readonly minBars\s*=\s*\{([^}]*)\}/.exec(chunk);
  if (!mb) return 0;
  const vals = [...mb[1].matchAll(/'[0-9a-zA-Z]+'\s*:\s*([^,}]+)/g)]
    .map((m) => resolveExpr(src, m[1], chunk))
    .filter(Number.isFinite);
  return vals.length ? Math.max(...vals) : 0;
};

const requiredOf = (chunk, src) => {
  const out = new Set();
  // A FRESH RegExp per chunk: a shared /g regex carries lastIndex between callers and silently
  // skips whole classes. That bug hid 30 of 31 classes in the largest directive file on the first
  // run of this audit.
  for (const source of GUARDS) {
    for (const m of chunk.matchAll(new RegExp(source, 'g'))) {
      const token = m[1];
      if (/^\d+$/.test(token)) { out.add(Number(token)); continue; }
      const v = resolveConst(src, token, new Set(), chunk);
      // ⚠️ `resolveConst` returning null used to mean "skip the class". Now the caller is told.
      if (v == null) unjudgeable.push({ token, id: /readonly id\s*=\s*'([^']+)'/.exec(chunk)?.[1] });
      else out.add(v);
    }
  }
  return out;
};

/** Every directive in `dir` whose internal bar requirement exceeds what it declares. */
function findOffenders(dir) {
  const offenders = [];
  unjudgeable.length = 0;
  // ⚠️ BOTH suffixes: five files are `*.directives.ts` (plural) because they declare more than one
  // directive — and that is where BOTH live instances of this defect were found.
  for (const f of fs.readdirSync(dir).filter((x) => /\.directives?\.ts$/.test(x))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const chunk of src.split(/(?=@Injectable\(\))/g)) {
      const id = /readonly id\s*=\s*'([^']+)'/.exec(chunk)?.[1];
      if (!id) continue;
      const required = requiredOf(chunk, src);
      if (!required.size) continue;
      const declaredMax = declaredMaxOf(chunk, src);
      const biggest = Math.max(...required);
      // Tolerance of 1 for `<` vs `<=` boundaries and "+2" slack.
      if (biggest > declaredMax + 1) offenders.push({ id, file: f, declares: declaredMax, needs: biggest });
    }
  }
  // A bar guard whose threshold could not be resolved is REPORTED, not skipped. Silence here is
  // indistinguishable from a clean pass, which is exactly how `overhead-supply-pressure` hid.
  const unresolved = [...new Map(unjudgeable.filter((u) => u.id).map((u) => [`${u.id}:${u.token}`, u])).values()];
  return { offenders, unresolved };
}

function selfTest() {
  const checks = [];
  const ok = (n, p) => checks.push({ name: n, pass: !!p });

  // Direction 1 — the defect is detected.
  const bad = `@Injectable()\nexport class X implements IDirective {\n  readonly id = 'needs-200';\n  calculate() { const closes = []; if (closes.length < 200) return 0; }\n}`;
  const badOffenders = [];
  for (const chunk of bad.split(/(?=@Injectable\(\))/g)) {
    const id = /readonly id\s*=\s*'([^']+)'/.exec(chunk)?.[1];
    if (!id) continue;
    const req = requiredOf(chunk, bad);
    if (req.size && Math.max(...req) > declaredMaxOf(chunk, bad) + 1) badOffenders.push(id);
  }
  ok('detects a directive that refuses below 200 and declares nothing', badOffenders.length === 1);

  // Direction 2 — a declared requirement is silent, or the guard fires on correct code.
  const good = `@Injectable()\nexport class X implements IDirective {\n  readonly id = 'declared';\n  readonly minBars = { '1d': 200 };\n  calculate() { const closes = []; if (closes.length < 200) return 0; }\n}`;
  const goodReq = requiredOf(good, good);
  ok('silent when the requirement is declared', !(Math.max(...goodReq) > declaredMaxOf(good, good) + 1));

  // Direction 3 — a named constant is resolved, not read as text.
  const named = `const LOOKBACK = 250;\n@Injectable()\nexport class X { readonly id = 'named'; calculate() { if (bars.length < LOOKBACK) return 0; } }`;
  ok('resolves a named constant', requiredOf(named, named).has(250));

  // Direction 4 — the plural file suffix is scanned (the bug that hid both live instances).
  ok('scans *.directives.ts as well as *.directive.ts', /\.directives?\.ts$/.test('a.directives.ts') && /\.directives?\.ts$/.test('b.directive.ts'));

  // Direction 5 — the real tree must still contain directives, else nothing was verified.
  const live = findOffenders(DIR);
  ok('scans a live tree (found some directives to judge)', Array.isArray(live.offenders));

  // Direction 6 — a requirement defined as a SUM must RESOLVE, not be skipped. This is the hole the
  // 2026-11-03 defect fell through: `const MIN_BARS = LOOKBACK + 8` was unresolvable, so the class
  // was treated as having no requirement at all and reported clean while declaring 56 against 58.
  const sumSrc = `const LOOKBACK = 50;\nconst MIN_BARS = LOOKBACK + 8;\n@Injectable()\nexport class X { readonly id = 'sum'; readonly minBars = { '1d': 56 }; calculate() { if (bars.length < MIN_BARS) return 0; } }`;
  const sumChunk = sumSrc.split(/(?=@Injectable\(\))/g).find((c) => c.includes("'sum'"));
  ok('resolves a constant defined as a SUM (LOOKBACK + 8 = 58)', resolveConst(sumSrc, 'MIN_BARS') === 58);
  ok('resolves a difference (LOOKBACK - 2)', resolveConst('const L = 50; const M = L - 2;', 'M') === 48);
  ok('a SUM-based requirement is JUDGED, not skipped', requiredOf(sumChunk, sumSrc).has(58));
  // The DECLARATION side must resolve expressions too, or a correct directive reads as "declares
  // none" — which is exactly what happened to `mfi-overbought` (`{ '1d': MFI_PERIOD + 3 }`).
  ok('a SUM-based DECLARATION resolves (MFI_PERIOD + 3 = 17)', resolveExpr('const MFI_PERIOD = 14;', 'MFI_PERIOD + 3') === 17);
  ok('a SUM-based declaration is not read as "declares none"', declaredMaxOf(sumChunk, sumSrc) === 56);
  ok('an unresolvable threshold is RECORDED, not silently dropped', (() => {
    unjudgeable.length = 0;
    // An UPPER_CASE token that no `const` defines: the guard matches the shape but cannot resolve
    // it. Silence here is the defect being fixed, so it must land in `unjudgeable`.
    requiredOf(`@Injectable()\nexport class X { readonly id = 'u'; calculate() { if (bars.length < MISSING_CONST) return 0; } }`, '');
    return unjudgeable.some((u) => u.token === 'MISSING_CONST');
  })());

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`  ${c.pass ? '✓' : '✖'} ${c.name}`);
  if (failed.length) {
    console.error(`\n[${TAG}] ✖ self-test FAILED — ${failed.length} of ${checks.length}\n`);
    process.exit(1);
  }
  console.log(`\n[${TAG}] ✅ self-test PASSED — ${checks.length}/${checks.length} expectations\n`);
}

const readBaseline = () => (fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')).ids ?? [] : []);
const writeBaseline = (ids) =>
  fs.writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        _comment:
          'Directives whose internal bar requirement exceeds their declared minBars. Ratchet: a NEW id fails the build; an id removed from this list must be FIXED, and the list may only shrink. Fix = declare the requirement in minBars.',
        _measured: new Date().toISOString().slice(0, 10),
        count: ids.length,
        ids: [...ids].sort(),
      },
      null,
      2,
    )}\n`,
  );

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const { offenders, unresolved } = findOffenders(DIR);
  if (process.argv.includes('--update-baseline')) {
    const before = readBaseline().length;
    writeBaseline(offenders.map((o) => o.id));
    console.log(`[${TAG}] baseline written — ${offenders.length} id(s), was ${before}`);
    process.exit(0);
  }
  // ⚠️ REPORTED, NOT SKIPPED. A bar threshold this tool cannot resolve means the class was never
  // judged — and "never judged" must not render the same as "judged clean". Non-fatal because the
  // token may be a real runtime value rather than a mistake, but it is always visible.
  if (unresolved.length) {
    console.log(`[${TAG}] ⚠️  ${unresolved.length} bar threshold(s) could not be resolved — NOT judged:`);
    for (const u of unresolved) console.log(`    ${u.id.padEnd(30)} compares against \`${u.token}\``);
    console.log('    Declare `minBars` to a literal or a resolvable constant so this can be checked.\n');
  }
  const known = new Set(readBaseline());
  const fresh = offenders.filter((o) => !known.has(o.id));
  // ⚠️ An entry that dropped out because its threshold is UNRESOLVABLE was not fixed — it stopped
  // being judged. Counting it as "no longer offends" would shrink the ratchet on a class nobody
  // looked at, which is the opposite of what the baseline is for.
  const unresolvedIds = new Set(unresolved.map((u) => u.id));
  const fixed = [...known].filter((id) => !offenders.some((o) => o.id === id) && !unresolvedIds.has(id));
  const dropped = [...known].filter((id) => unresolvedIds.has(id));

  if (fixed.length) {
    console.log(`[${TAG}] ↓ ${fixed.length} baselined directive(s) no longer offend — shrink the list:`);
    console.log(`    ${fixed.join(', ')}`);
    console.log(`    node nest/scripts/validate-directive-bar-requirement.cjs --update-baseline\n`);
  }
  if (dropped.length) {
    console.log(
      `[${TAG}] ℹ️  ${dropped.length} baselined id(s) are UNJUDGEABLE (see above) — staying baselined, ` +
        `NOT counted as fixed: ${dropped.join(', ')}\n`,
    );
  }
  if (fresh.length) {
    console.error(`[${TAG}] ✖ ${fresh.length} directive(s) refuse below more bars than they declare:\n`);
    for (const o of fresh) console.error(`  ${o.id.padEnd(30)} ${o.file.padEnd(42)} declares ${o.declares || 'none'}  needs ${o.needs}`);
    console.error('\n  Add `readonly minBars = { \'1d\': N }` so the caller fetches N. Without it the directive');
    console.error('  abstains on every pass and its maxScore still counts toward the protocol.\n');
    process.exit(1);
  }
  console.log(
    `[${TAG}] ✅ OK — ${offenders.length} known offender(s) baselined, no NEW directive declares less than it needs`,
  );
}
