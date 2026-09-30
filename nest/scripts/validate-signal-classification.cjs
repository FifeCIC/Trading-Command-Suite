#!/usr/bin/env node
/**
 * validate-signal-classification.cjs — INV-NO-SIGNAL-PREFIX-TEST (build-time)
 * ===========================================================================
 *
 * Fails the build when a SIGNAL CLASS is tested by prefix, substring or index rather than by the
 * whole token. **#1029 is the second time this exact defect shipped.**
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE DEFECT, TWICE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `signal-direction.ts` was written 2026-09-17 after several call sites decided direction with
 * `signal.startsWith('SELL')`:
 *
 *     'STRONG_SELL'.startsWith('SELL')  ->  false  ->  LONG/BUY   ❌ INVERTED
 *
 * `STRONG_SELL` begins with `STRONG`, not with `SELL`, so **the highest-conviction bearish signal in
 * the system was routed as a BUY.** The helper (`classifySignal` / `isSellSignal`) was extracted and
 * carries a table-driven spec.
 *
 * ⚠️ AND IT HAPPENED AGAIN ANYWAY. Measured 2026-09-29 (#1029): `score-history.service.ts` still read
 *
 *     entry.latestSignal?.startsWith('BUY') ? 'entry' : ...startsWith('SELL') ? 'defensive' : 'watch'
 *
 * so `STRONG_BUY` and `STRONG_SELL` BOTH fell through to `watch` — the two strongest findings the
 * system can produce, rendered as "no view".
 *
 * WHY THE EXISTING PROTECTION DID NOT CATCH IT: **it is a unit spec on the helper, not a gate over
 * call sites.** A spec proves the helper is right; it says nothing about a file that never calls it.
 * A wrong prefix test compiles, passes every test, and READS as correct — which is why it shipped
 * twice. This file is the missing half: it checks the SHAPE of the call site, not the behaviour of
 * the helper.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ NARROW ON PURPOSE — a guard that fires falsely gets allowlisted, which is worse than none
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A test is flagged only when BOTH hold:
 *
 *   1. the RECEIVER names a signal concept (`signal`, `signalClass`, `latestSignal`, `direction`,
 *      `side`, `bias` …), and
 *   2. the ARGUMENT is a signal token (`BUY` / `SELL` / `LONG` / `SHORT` / `STRONG…`).
 *
 * So `comment.includes('TCS')` is NOT flagged — the receiver is not a signal — and neither is any
 * `startsWith` on a path, a name or a code. Tests (`*.spec.ts`) are skipped, because a spec asserting
 * the false behaviour is the point of a spec. Comments are stripped, because this repo documents the
 * defect in prose and the documentation must not trip its own guard.
 *
 * ⚠️ KNOWN BLIND SPOT, stated rather than implied: a signal held in a variable that does not name one
 * (`s.startsWith('BUY')`) is NOT caught. Widening the receiver would start matching ordinary code.
 *
 * Usage:
 *   node nest/scripts/validate-signal-classification.cjs              # check (build gate)
 *   node nest/scripts/validate-signal-classification.cjs --self-test  # prove it can fail
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOTS = [path.join(ROOT, 'nest', 'src'), path.join(ROOT, 'src')];

/** A spec deliberately asserts the WRONG behaviour, so it must not be scanned. */
const SKIP_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;
const SCAN_EXT = /\.([cm]?[jt]sx?)$/;

/** Words that mean "this value IS a signal class" — the guard's first condition. */
const RECEIVER = String.raw`(?:signal|signalClass|latestSignal|direction|dir|side|bias)`;
/** The signal classes, plus `STRONG` so a partial literal token is caught too. */
const TOKEN = String.raw`(?:STRONG|BUY|SELL|LONG|SHORT)`;
/**
 * ⚠️ `(?:\?\.|\.)` — EITHER an optional-chain segment OR a plain dot, NEVER both. The first version
 * wrote `(?:\?\.)?\s*\.` , which demands a second dot, so `latestSignal?.startsWith('BUY')` — the
 * EXACT shipped line from #1029 — did not match. The self-test caught it: a guard that cannot see the
 * defect it was written for is the decoration this repo keeps warning about.
 */
const PATTERN = new RegExp(
  String.raw`\b${RECEIVER}\w*\s*(?:\?\.|\.)\s*(startsWith|includes|indexOf)\s*\(\s*['"\`]${TOKEN}`,
  'gi',
);

/** The canonical call. Anything that already routes through the authority is fine. */
const CANONICAL = /\b(classifySignal|isSellSignal|isBuySignal|signalToDirection|signalToSide|signalToBrokerSide)\s*\(/;

/**
 * Remove comments so this repo's own prose about the defect does not fail its own guard.
 *
 * ⚠️ Deliberately crude: block comments, then any line whose first non-space character starts a
 * comment. An inline trailing comment survives — which risks a FALSE POSITIVE, so the check below
 * also requires the line NOT to mention the canonical helper. Over-stripping would only cause false
 * negatives, which is the safer direction for a gate.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

/** Findings for one source string. Exported shape so the self-test can drive it directly. */
function scanSource(src, rel) {
  const out = [];
  const clean = stripComments(src);
  for (const line of clean.split(/\r?\n/)) {
    if (CANONICAL.test(line)) continue;      // already using the authority
    PATTERN.lastIndex = 0;
    const m = PATTERN.exec(line);
    if (!m) continue;
    out.push({ rel, method: m[1], text: line.trim().slice(0, 120) });
  }
  return out;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (SCAN_EXT.test(e.name) && !SKIP_FILE.test(e.name)) out.push(full);
  }
  return out;
}

function scanTree() {
  const findings = [];
  for (const root of SCAN_ROOTS) {
    for (const full of walk(root)) {
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      findings.push(...scanSource(fs.readFileSync(full, 'utf8'), rel));
    }
  }
  return findings;
}

function selfTest() {
  const cases = [
    // ── the two SHIPPED defects, verbatim in shape ──────────────────────────────────────────
    ['flags the score-history prefix test that shipped (#1029)',
      () => scanSource(`const signal = entry.latestSignal?.startsWith('BUY') ? 'entry' : 'watch';`, 'f.ts').length === 1],
    ['flags the original router defect (STRONG_SELL routed LONG)',
      () => scanSource(`const side = env.signal.startsWith('SELL') ? 'SHORT' : 'LONG';`, 'f.ts').length === 1],
    ['flags includes() on a signal — same class, different method',
      () => scanSource(`if (row.signal.includes('BUY')) return 1;`, 'f.ts').length === 1],
    ['flags indexOf() on a direction',
      () => scanSource(`const i = q.direction.indexOf('LONG');`, 'f.ts').length === 1],
    ['flags a side field',
      () => scanSource(`const short = o.side.startsWith('SELL');`, 'f.ts').length === 1],

    // ── must NOT fire: the false positives that would get this guard allowlisted ─────────────
    ['does NOT flag the canonical classifier',
      () => scanSource(`const c = classifySignal(entry.latestSignal);`, 'f.ts').length === 0],
    ['does NOT flag a signal held in a comment',
      () => scanSource(`// was: entry.latestSignal?.startsWith('BUY') ? 'entry' : 'watch'`, 'f.ts').length === 0],
    ['does NOT flag a signal held in a DOCBLOCK',
      () => scanSource(`/**\n * 'STRONG_SELL'.startsWith('SELL') === false\n * signal.startsWith('BUY') is wrong\n */`, 'f.ts').length === 0],
    ['does NOT flag an unrelated substring test',
      () => scanSource(`if (p.comment.includes('TCS')) continue;`, 'f.ts').length === 0],
    ['does NOT flag a path or name prefix test',
      () => scanSource(`const ok = rel.startsWith('src/'); const n = name.startsWith('TCS');`, 'f.ts').length === 0],
    ['does NOT flag a line that already uses the authority',
      () => scanSource(`const isShort = isSellSignal(env.signal) && !env.signal.startsWith('SELL');`, 'f.ts').length === 0],

    // ── the tree itself ─────────────────────────────────────────────────────────────────────
    ['the REAL tree is clean', () => scanTree().length === 0],
  ];

  const { runCases } = require('../../scripts/lib/validator-helpers.cjs');
  process.exit(runCases(cases) ? 1 : 0);
}

if (process.argv.includes('--self-test')) selfTest();

const findings = scanTree();
if (findings.length) {
  console.log(`[signal-classification] ✖ ${findings.length} prefix/substring test(s) on a SIGNAL CLASS:\n`);
  for (const f of findings) console.log(`  ${f.rel}  .${f.method}()\n    ${f.text}\n`);
  console.log('  A signal class must be classified by the WHOLE TOKEN:');
  console.log("    import { classifySignal } from '<...>/common/utils/signal-direction';");
  console.log("    const c = classifySignal(value);   // 'buy' | 'sell' | 'hold' | 'unknown'");
  console.log("  ⚠️ 'STRONG_SELL'.startsWith('SELL') === false — this has shipped twice (#1029).");
  process.exit(1);
}
console.log('[signal-classification] ✅ OK — no prefix or substring test on a signal class');
