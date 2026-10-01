#!/usr/bin/env node
/**
 * validate-seed-literals.cjs — a seeder must not INVENT a value with a default literal.
 *
 * Extracted from #959 acceptance criterion 2. #959 was one line:
 *
 *     exchange: s.exchange ?? 'Xtrend',        // nest/prisma/seed-symbol-onboarding.ts
 *
 * `Xtrend` is not an exchange and has no adapter. It was a DEFAULT LITERAL standing in for a
 * missing value, and it put a confident, false label on 29 of 258 symbols (12%) — on screen and in
 * the CSV export, for three weeks, with no error anywhere.
 *
 * The fix removed that one line. NOTHING prevented the next one. `change-completion.instructions.md`
 * is explicit: *"Fix the instance, then guard the class. The guard is the deliverable; the fix is
 * the excuse."* #789 was 14 placements and #790 was 6 in the same class; the guard is why that was
 * one issue and not six.
 *
 * ── WHAT THIS GUARD IS, AND WHAT IT IS NOT ────────────────────────────────────────────────
 *
 * It flags a STRING LITERAL used as a `??` fallback for a field that must mirror an EXTERNAL FACT.
 * It does NOT check whether the value is true — it cannot, and pretending otherwise would be a
 * cause guard inheriting whatever was wrong with the theory.
 *
 * What it buys is DELIBERATENESS. To pass, the fallback must be a NAMED CONSTANT:
 *
 *     provider: r.provider ?? ROUTE_DEFAULT_PROVIDER      // passes
 *     provider: r.provider ?? 'mt5'                       // flagged
 *
 * A named constant has to be declared once, in the file, with a comment saying why it is real. An
 * inline literal can be typed by anyone, anywhere, and leaves no trace for a reviewer to weigh.
 * That is the whole difference, and it is the difference that #959 needed.
 *
 * ── NARROW BEATS BROAD ────────────────────────────────────────────────────────────────────
 *
 * A guard that over-fires gets allowlisted, and an allowlisted guard is WORSE than none: it
 * consumes attention and provides no cover. So:
 *
 *   • Only a small explicit field list — fields that describe the world, not the app's own state.
 *   • Only a literal immediately after `??` on the SAME LINE. No cross-line inference.
 *   • Only `.ts` files whose name contains `seed`. No `.spec.ts`.
 *
 * `?? null` and `?? undefined` are NOT flagged. Absence staying absence is the CORRECT answer —
 * `undefined` even has different meaning from `null` in a Prisma update (see #1009).
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────
 *
 *   node nest/scripts/validate-seed-literals.cjs              # scan, exit 1 on a finding
 *   node nest/scripts/validate-seed-literals.cjs --self-test  # canary BOTH directions + a real scan
 *
 * Wired into `prebuild`, so instance N+1 fails the build rather than reaching the owner's screen.
 */

const fs = require('fs');
const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');

/**
 * The fields this guard protects. Every one describes an EXTERNAL FACT — a thing that is true or
 * false about the world, which the app can only report and never invent.
 *
 * ⚠️ Kept deliberately short. Adding a field widens the guard, and a widened guard is one step
 * closer to being allowlisted. Each addition should be justified by a real fabrication.
 */
const EXTERNAL_FACT_FIELDS = [
  'exchange',
  'provider',
  'sector',
  'industry',
  'brokerSymbol',
  'currency',
  'country',
];

/**
 * classifySeedLine() — PURE. No filesystem, so `--self-test` can canary it in BOTH directions.
 *
 * Returns `{ field, literal }` when the line assigns a STRING LITERAL as a `??` fallback to a
 * protected field, otherwise `null`.
 *
 * The regex requires: the field name, a `:` (or `?:` for an optional property), then `??` and a
 * quote. Anything else on the line is irrelevant. A named constant does not match — that is the
 * point, and it is why the answer to a finding is "name the default", not "add an exemption".
 */
function classifySeedLine(line) {
  for (const field of EXTERNAL_FACT_FIELDS) {
    //                                 field           ??   'lit' | "lit" | `lit`
    const re = new RegExp(`\\b${field}\\??\\s*:[^,;]*?\\?\\?\\s*(['"\`])([^'"\`]*)\\1`);
    const m = line.match(re);
    if (m) return { field, literal: m[2] };
  }
  return null;
}

/** Every `.ts` seed source under `nest/`, excluding tests and declaration files. */
function seedFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        walk(full);
        continue;
      }
      if (!e.name.endsWith('.ts')) continue;
      if (e.name.endsWith('.spec.ts') || e.name.endsWith('.d.ts')) continue;
      if (!/seed/i.test(e.name)) continue;
      out.push(full);
    }
  };
  walk(NEST_ROOT);
  return out.sort();
}

/** Scan one file's text. Pure apart from the injected name, so the self-test can feed it strings. */
function scanText(name, text) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, i) => {
    // A commented-out example is documentation, not a seeder invention.
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const hit = classifySeedLine(line);
    if (hit) findings.push({ file: name, line: i + 1, field: hit.field, literal: hit.literal });
  });
  return findings;
}

/** Scan the real tree. */
function scanTree() {
  const findings = [];
  const files = seedFiles();
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch (err) {
      // ⚠️ A guard that cannot read its input must ERROR, never pass. Reporting "clean" because a
      // file was unreadable is how a check inspecting nothing reports OK.
      console.error(`[seed-literals] FATAL — cannot read ${f}: ${err.message}`);
      process.exit(2);
    }
    findings.push(...scanText(path.relative(NEST_ROOT, f), text));
  }
  return { findings, scanned: files.length };
}

// ── Self-test ───────────────────────────────────────────────────────────────────────────────

/**
 * `--self-test` — prove the classifier can FAIL, in both directions, and prove the SCANNER
 * actually reads files.
 *
 * The second half matters as much as the first: this repo has already had a guard that
 * pattern-matched globally, hit nothing, and reported a working guard as broken. A classifier
 * canary alone cannot tell "the scan works" from "the scan reads no files".
 */
function selfTest() {
  let failed = 0;
  const check = (name, got, expect) => {
    const ok = JSON.stringify(got) === JSON.stringify(expect);
    if (!ok) failed++;
    console.log(
      `[self-test] ${ok ? 'PASS' : 'FAIL'}  ${name}` +
        (ok ? '' : ` (expected ${JSON.stringify(expect)}; got ${JSON.stringify(got)})`),
    );
  };

  // ── Direction 1: it MUST fire on the real #959 line ──
  check(
    'the real #959 line IS flagged',
    classifySeedLine("          exchange: s.exchange ?? 'Xtrend',"),
    { field: 'exchange', literal: 'Xtrend' },
  );
  check(
    'a provider literal IS flagged',
    classifySeedLine("        provider: r.provider ?? 'mt5',"),
    { field: 'provider', literal: 'mt5' },
  );
  check(
    'an optional property (?) IS flagged',
    classifySeedLine("  sector?: row.sector ?? 'Technology',"),
    { field: 'sector', literal: 'Technology' },
  );
  check(
    'double quotes ARE flagged',
    classifySeedLine('        currency: r.currency ?? "GBP",'),
    { field: 'currency', literal: 'GBP' },
  );

  // ── Direction 2: it must NOT fire on the correct forms ──
  check('a NAMED CONSTANT passes', classifySeedLine('        provider: r.provider ?? ROUTE_DEFAULT_PROVIDER,'), null);
  check('?? null passes (absence stays absence)', classifySeedLine('        exchange: s.exchange ?? null,'), null);
  check(
    '?? undefined passes (Prisma omits it, unlike null)',
    classifySeedLine('        brokerSymbol: r.brokerSymbol ?? undefined,'),
    null,
  );
  check(
    'a NON-protected field passes',
    classifySeedLine("        ticker: s.ticker ?? 'UNKNOWN',"),
    null,
  );
  check('a plain assignment passes', classifySeedLine("        provider: 'mt5',"), null);
  check(
    'a non-string fallback passes',
    classifySeedLine('        sector: map[sector] ?? FALLBACKS.unknown,'),
    null,
  );

  // ── Direction 3: the TEXT SCANNER, including comment suppression ──
  const planted = [
    "const a = { exchange: s.exchange ?? 'Xtrend' };", // flagged
    "// exchange: s.exchange ?? 'Xtrend',", // comment — not flagged
    "const b = { provider: r.provider ?? ROUTE_DEFAULT_PROVIDER };", // named const — not flagged
  ].join('\n');
  check('scanText finds exactly the live line, not the commented one', scanText('planted.ts', planted).length, 1);

  // ── Direction 4: the TREE SCANNER really reads files ──
  // A temp file is written, scanned through the real path, and removed. If `seedFiles()` returned
  // nothing, or the read silently failed, this fails — which is the failure mode that lets a check
  // inspect nothing and report OK.
  const tmpDir = path.join(NEST_ROOT, 'prisma');
  const tmpFile = path.join(tmpDir, 'zz-selftest-seed-literals.ts');
  try {
    fs.writeFileSync(tmpFile, "export const x = { exchange: s.exchange ?? 'INVENTED' };\n", 'utf8');
    const { findings, scanned } = scanTree();
    const hit = findings.find((f) => f.file.endsWith('zz-selftest-seed-literals.ts'));
    const treeOk = scanned > 0 && !!hit && hit.literal === 'INVENTED';
    if (!treeOk) failed++;
    console.log(
      `[self-test] ${treeOk ? 'PASS' : 'FAIL'}  the tree scan reads files and reports the planted literal` +
        (treeOk ? '' : ` (scanned=${scanned}, hit=${JSON.stringify(hit ?? null)})`),
    );
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* best effort */
    }
  }

  const restored = !fs.existsSync(tmpFile);
  if (!restored) failed++;
  console.log(`[self-test] ${restored ? 'PASS' : 'FAIL'}  the planted file was removed (tree restored)`);

  console.log(`[self-test] seed-literal guard: ${failed === 0 ? 'all canaries passed' : `${failed} FAILED`}.`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── Main ────────────────────────────────────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) selfTest();

const { findings, scanned } = scanTree();
if (findings.length === 0) {
  console.log(`[seed-literals] ✅ OK — ${scanned} seed file(s) scanned, no invented default literal.`);
  process.exit(0);
}

console.error(`\n[seed-literals] ❌ ${findings.length} invented default literal(s) in ${scanned} seed file(s):\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  ${f.field} ?? '${f.literal}'`);
}
console.error(
  '\n  A default literal on a field that mirrors an EXTERNAL FACT invents a value when the real\n' +
    '  one is missing. #959: `exchange: s.exchange ?? \'Xtrend\'` put a non-existent exchange on 29\n' +
    '  of 258 symbols, on screen, for three weeks, with no error.\n\n' +
    '  FIX ONE OF TWO WAYS:\n' +
    '    • `?? null` (or `undefined` where Prisma must OMIT the field) — absence stays absence.\n' +
    '    • A NAMED CONSTANT declared once with a comment saying why the default is real:\n' +
    '        const ROUTE_DEFAULT_PROVIDER = \'mt5\';   // real adapter, see mt5-connection.manager\n' +
    '        provider: r.provider ?? ROUTE_DEFAULT_PROVIDER,\n',
);
process.exit(1);
