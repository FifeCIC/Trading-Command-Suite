#!/usr/bin/env node
/**
 * validate-close-attribution.cjs — every close path must also record WHAT it closed (#949).
 * ===========================================================================================
 * ⚠️ THE DEFECT THIS PREVENTS RECURRING.
 *
 * Four paths close a trade:
 *   1. manual/UI close      → `trade-recorder.close()`, tags `strategy` since #884
 *   2. broker SL / terminal → `position-sync.finalizeClosedPosition()`
 *   3. stranded-row reap    → `position-sync` (no broker comment exists to parse)
 *   4. time-stop close      → `position-time-stop.service.ts`
 *
 * Paths 2 and 4 wrote `closeReason` and NOT `strategy`. Measured 2026-09-22: 184 of 186 closed
 * trades carried no strategy, so the Strategy Comparison page and the bot rating (#894) had
 * nothing to group — a "plausible output, no error" defect: every per-bot number rendered,
 * built on a column that was almost always NULL.
 *
 * The rule: a source file that mentions `closeReason` must reference the canonical comment
 * parser (`extractStrategyFromComment` / `classifyMt5Comment` / `resolveStrategyForClose`),
 * or be declared below with a reason. The next close path fails the BUILD, not the reader.
 */
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./lib/comment-stripper.cjs');

const ROOT = path.join(__dirname, '..', 'src');
const PARSER_REF = /extractStrategyFromComment|classifyMt5Comment|resolveStrategyForClose/;

/**
 * Files that legitimately mention `closeReason` in CODE without parsing a strategy, each with a
 * REASON. Keep this list short — a wide allowlist is the same as no guard.
 *
 * ⚠️ NARROWED 2026-10-01. This list had SIX entries and three of them existed only because a file
 * named `closeReason` in a COMMENT (`provider-adapter.interface.ts`, `mt5.adapter.ts`,
 * `exit-consensus.service.ts`). A comment cannot write a Trade, so the mention check was measuring
 * prose. Comments are now stripped before the check, those three entries are gone, and this list
 * is half the size — which is a STRONGER guard, not a weaker one.
 *
 * ⚠️ The rule only fires when the allowlist DECLINES to cover the file. Adding an entry for a file
 * that writes `closeReason` in real code without attributing the strategy is not an exemption, it
 * is the defect the guard exists to catch.
 */
const ALLOWLIST = [
  {
    file: 'common/trading/close-reason.ts',
    why: 'Owns the reason vocabulary and the comment→REASON parser. Does not write Trade rows. ' +
      'Matches in CODE via the identifier `closeReasonFromDealReason`.',
  },
  {
    file: 'modules/symbols/symbols.service.ts',
    why: 'READS closeReason for an aggregation query (GROUP BY attribution, closeReason). Never writes.',
  },
  {
    file: 'modules/trading/trade-recorder.service.ts',
    why: 'RECEIVES `strategy` as an explicit parameter (#884) — the parser belongs to its callers. ' +
      'If this ever becomes the ONLY file with a parser reference, the callers have regressed.',
  },
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

const allow = new Map(ALLOWLIST.map((a) => [a.file.replace(/\\/g, '/'), a.why]));

/**
 * The verdict for ONE file, as a pure function so `--self-test` can drive the same code the build
 * runs. Returns `'ok'` (no actionable mention), `'allowlisted'`, or `'violation'`.
 */
function verdict(rawText, rel, allowMap = allow) {
  const text = stripComments(rawText);
  if (!text.includes('closeReason')) return 'ok';
  if (PARSER_REF.test(text)) return 'ok';
  if (allowMap.has(rel)) return 'allowlisted';
  return 'violation';
}

/**
 * The scan. Called only from the `require.main` dispatch below, so importing this file (which the
 * self-test route does NOT need, but a future aggregator might) cannot exit the process as a
 * side effect — a validator that kills its importer is a trap.
 */
function run() {
  const violations = [];
  const stale = [];

  for (const full of walk(ROOT)) {
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    const raw = fs.readFileSync(full, 'utf8');
    const v = verdict(raw, rel);

    if (v === 'violation') {
      violations.push(rel);
      continue;
    }
    // ⚠️ ANTI-ROT, and it now covers MORE than before: with comments stripped, an allowlist entry
    // whose only justification was a comment mention becomes stale the moment it is written — which
    // is how the three prose entries above were found. A stale exemption is a permanent hole in the
    // guard, so surfacing it is part of the guard, not a nicety.
    if (allow.has(rel) && !stripComments(raw).includes('closeReason')) stale.push(rel);
  }

  if (stale.length) {
    console.log('⚠️  STALE ALLOWLIST ENTRIES (file no longer mentions closeReason in CODE — remove them):');
    for (const s of stale) console.log(`    ${s}`);
  }

  if (violations.length) {
    console.error('');
    console.error('✖ CLOSE-ATTRIBUTION GAP — file(s) write/mention closeReason without the strategy parser:');
    for (const v of violations) {
      console.error(`    nest/src/${v}`);
    }
    console.error('');
    console.error('FIX: derive the strategy through the canonical parser and pass it into the close:');
    console.error('     resolveStrategyForClose(existing, rowComment, dealComment)   // providers/mt5-comment.util.ts');
    console.error('     ...(strategy ? { strategy } : {})                            // into the trade update');
    console.error('');
    console.error('WHY: a close that records WHY but not WHAT leaves 184/186 trades ungroupable (#949), and');
    console.error('     the Strategy Comparison page + bot rating (#894) render numbers built on NULL.');
    console.error('');
    console.error('If the file genuinely does not write a Trade (a reader, a type, the reason vocabulary),');
    console.error('add it to ALLOWLIST in nest/scripts/validate-close-attribution.cjs WITH A REASON.');
    return 1;
  }

  console.log(`✅ Close attribution — every closeReason writer routes through the parser (${ALLOWLIST.length} declared exceptions).`);
  return 0;
}

/**
 * --self-test — proves the verdict can FAIL in both directions.
 *
 * ⚠️ Added 2026-10-01 with the comment-stripping change, because the change could have WEAKENED the
 * guard: stripping too much would hide a real writer, and a guard that cannot fail is a decoration.
 * Each case below is a direction this could go wrong.
 */
function selfTest() {
  const { runCases } = require('../../scripts/lib/self-test.cjs');
  const cases = [];
  const t = (n, fn) => cases.push({ name: n, fn });

  t('a CODE mention with the parser → ok', () =>
    verdict('const r = { closeReason: X }; import { resolveStrategyForClose } from "./x";', 'a.ts') === 'ok');

  t('CANARY a CODE mention WITHOUT the parser → violation', () =>
    verdict('await prisma.trade.update({ data: { closeReason: "system:x" } });', 'a.ts') === 'violation');

  t('a COMMENT-only mention → ok, with NO allowlist entry needed', () =>
    verdict('// we do not write closeReason here\nconst x = 1;', 'a.ts') === 'ok');

  t('a JSDoc mention → ok', () =>
    verdict('/* the closeReason column is written elsewhere */\nconst x = 1;', 'a.ts') === 'ok');

  t('a COMMENTED-OUT writer → ok (it is not a writer)', () =>
    verdict('// await prisma.trade.update({ data: { closeReason: X } });\n', 'a.ts') === 'ok');

  t('CANARY a comment does NOT hide a real writer on the same file', () =>
    // The false-negative direction: stripping must not swallow live code.
    verdict('// closeReason is set here\nawait prisma.trade.update({ data: { closeReason: X } });', 'a.ts') === 'violation');

  t('CANARY a `//` inside a STRING does not truncate the line', () =>
    // `/\/\/.*$/` would cut at the URL and lose the writer after it — a false negative.
    verdict('const u = "https://x/y"; await prisma.trade.update({ data: { closeReason: X } });', 'a.ts') === 'violation');

  t('a `closeReason` inside a string with the parser present → ok', () =>
    verdict('const s = "closeReason"; const p = resolveStrategyForClose;', 'a.ts') === 'ok');

  t('an allowlisted file with a code mention → allowlisted, not a violation', () =>
    verdict('closeReason', 'modules/symbols/symbols.service.ts') === 'allowlisted');

  t('line numbers survive comment stripping (block comments keep their newlines)', () => {
    const src = 'a\n/* one\ntwo\nthree */\nb';
    return stripComments(src).split('\n').length === src.split('\n').length;
  });

  return runCases(cases, 'close-attribution');
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  process.exit(run());
}
