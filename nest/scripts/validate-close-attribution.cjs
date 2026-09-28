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

const ROOT = path.join(__dirname, '..', 'src');
const PARSER_REF = /extractStrategyFromComment|classifyMt5Comment|resolveStrategyForClose/;

/**
 * Files that legitimately mention `closeReason` without parsing a strategy, each with a
 * REASON. Keep this list short — a wide allowlist is the same as no guard.
 */
const ALLOWLIST = [
  {
    file: 'common/trading/close-reason.ts',
    why: 'Owns the reason vocabulary and the comment→REASON parser. Does not write Trade rows.',
  },
  {
    file: 'modules/providers/interfaces/provider-adapter.interface.ts',
    why: 'Type/doc declaration only — mentions the parser in a JSDoc note.',
  },
  {
    file: 'modules/symbols/symbols.service.ts',
    why: 'READS closeReason for an aggregation query (GROUP BY attribution, closeReason). Never writes.',
  },
  {
    file: 'modules/providers/adapters/mt5.adapter.ts',
    why: 'References closeReasonFromDealReason in a comment about deal reasons. Does not write Trade.closeReason.',
  },
  {
    file: 'modules/trading/trade-recorder.service.ts',
    why: 'RECEIVES `strategy` as an explicit parameter (#884) — the parser belongs to its callers. ' +
      'If this ever becomes the ONLY file with a parser reference, the callers have regressed.',
  },
  {
    file: 'modules/scoring/exit-consensus.service.ts',
    why: 'ADVISORY ONLY — mentions closeReason solely in a MEASURED-provenance comment (376 closes ' +
      'grouped by reason, which is the evidence that no exit directive has ever driven one). ' +
      'Queries prisma.tradingStrategy and prisma.symbol; never reads or writes prisma.trade.',
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
const violations = [];
const stale = [];

for (const full of walk(ROOT)) {
  const rel = path.relative(ROOT, full).replace(/\\/g, '/');
  const text = fs.readFileSync(full, 'utf8');
  const mentions = text.includes('closeReason');
  const hasParser = PARSER_REF.test(text);

  if (!mentions) {
    // An allowlisted file that no longer mentions closeReason is stale — surface it rather
    // than leaving a permanent hole in the guard.
    if (allow.has(rel)) stale.push(rel);
    continue;
  }
  if (hasParser) continue;
  if (allow.has(rel)) continue;

  violations.push(rel);
}

if (stale.length) {
  console.log('⚠️  STALE ALLOWLIST ENTRIES (file no longer mentions closeReason — remove them):');
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
  process.exit(1);
}

console.log(`✅ Close attribution — every closeReason writer routes through the parser (${ALLOWLIST.length} declared exceptions).`);
