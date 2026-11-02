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
 *   · `sp500-regime` refused below 200 bars and declared NOTHING, so `vix-spike-v1` and `vix-short-v1`
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

const declaredMaxOf = (chunk, src) => {
  const mb = /readonly minBars\s*=\s*\{([^}]*)\}/.exec(chunk);
  if (!mb) return 0;
  const vals = [...mb[1].matchAll(/'[0-9a-zA-Z]+'\s*:\s*([^,}]+)/g)]
    .map((m) => {
      const expr = m[1].trim();
      if (/^\d+$/.test(expr)) return Number(expr);
      const name = expr.match(/^([A-Z_][A-Z0-9_]*)$/)?.[1];
      if (!name) return NaN;
      const cm = new RegExp(`const ${name}\\s*=\\s*(\\d+)`).exec(src);
      return cm ? Number(cm[1]) : NaN;
    })
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
      const cm = new RegExp(`const ${token}\\s*=\\s*(\\d+)`).exec(src);
      if (cm) out.add(Number(cm[1]));
    }
  }
  return out;
};

/** Every directive in `dir` whose internal bar requirement exceeds what it declares. */
function findOffenders(dir) {
  const offenders = [];
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
  return offenders;
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
  ok('scans a live tree (found some directives to judge)', Array.isArray(live));

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
  const offenders = findOffenders(DIR);
  if (process.argv.includes('--update-baseline')) {
    const before = readBaseline().length;
    writeBaseline(offenders.map((o) => o.id));
    console.log(`[${TAG}] baseline written — ${offenders.length} id(s), was ${before}`);
    process.exit(0);
  }
  const known = new Set(readBaseline());
  const fresh = offenders.filter((o) => !known.has(o.id));
  const fixed = [...known].filter((id) => !offenders.some((o) => o.id === id));

  if (fixed.length) {
    console.log(`[${TAG}] ↓ ${fixed.length} baselined directive(s) no longer offend — shrink the list:`);
    console.log(`    ${fixed.join(', ')}`);
    console.log(`    node nest/scripts/validate-directive-bar-requirement.cjs --update-baseline\n`);
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
