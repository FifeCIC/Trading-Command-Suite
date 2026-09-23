#!/usr/bin/env node
/**
 * validate-ab-inputs.cjs — THE A/B RUNNER MAY NOT INVENT ITS INPUTS (#929).
 *
 * ⚠️ Both rules below were paid for by the same failure: A/B was "built, fully wired, and had
 * never run" for two months, and when it finally did run it produced ten `EXECUTED` rows with
 * `brokerTicket: NULL` and placed no orders at all. Neither fault threw, logged, or failed a
 * type check. Both were a value resolved from the WRONG PLACE.
 *
 * ── RULE 1: a trading mode must not come from a SNAPSHOT ────────────────────────────────
 *
 * `snapshot.mode` is written from `scoringStrategy.mode` (`metastack-versioning.service.ts` L42),
 * so it holds the SCORING style. Measured on the live database 2026-09-23:
 *
 *     scoring_strategy.mode -> 'score' x18 | 'semi-auto' x7 | 'manual' x2 | 'auto' x0
 *     trading_strategy.mode -> 'auto' x25 | 'manual' x2
 *
 * `'auto'` is not a value a scoring strategy has EVER held, so `mode !== 'auto'` was true for
 * every stack in existence and the ORDER BRANCH WAS UNREACHABLE. The trading authority is the
 * BOT — `trading_strategy.mode` — resolved by `AbTestService.resolveTradeAuthority()`.
 *
 * ── RULE 2: the cadence must not be a LITERAL ───────────────────────────────────────────
 *
 * `runAbTest` read `getBars(sym, '5m', …)` while every other scoring path resolves the cadence
 * through the canonical `selectBaseTimeframe(protocol.recommendedTimeframe)` (#908) — the
 * envelope, the protocol runner, consensus, and the main loop. Measured 2026-09-23, XAUUSD, same
 * protocol (`xau-speed-m15`), same second:
 *
 *     real pipeline (15m bars) : composite 94, signal BUY  -> bot EXECUTED (ticket 152671245422)
 *     A/B runner   ( 5m bars) : composite 15, signal HOLD -> SKIP — no order, ever
 *
 * An M15 protocol scored on 5-minute bars is a different configuration. The runner was measuring
 * something that does not exist in production.
 *
 * ── SCOPE, DELIBERATELY NARROW ──────────────────────────────────────────────────────────
 *
 * Rule 1 scans all live code for `controlCfg.mode` / `variantCfg.mode`. Rule 2 scans only the
 * `runAbTest` method body for a literal timeframe in `getBars()` — a file-wide version would fire
 * on legitimate price lookups elsewhere in the same file, and a guard that produces false
 * positives gets allowlisted, which is worse than no guard because it consumes attention and
 * provides no cover.
 *
 * Comments are stripped before matching, so the explanations above do not trip it. Those
 * occurrences are the record of WHY the rules exist; failing on them would force the reasoning to
 * be deleted to satisfy the check.
 */
const fs = require('fs');
const path = require('path');

const NEST = path.join(__dirname, '..');
const SRC = path.join(NEST, 'src');
const LOOP = path.join(SRC, 'modules', 'automation', 'automation-loop.service.ts');

/** Rule 1 — a snapshot config's `mode` read as a trading mode. */
const SNAPSHOT_MODE = /\b(?:control|variant)Cfg\.mode\b/;

/** Rule 2 — a literal cadence handed to `getBars()`. */
const LITERAL_CADENCE = /getBars\([^;]*?'(?:1m|5m|15m|30m|1h|4h|1d|1w)'/;

/** Remove block + line comments, preserving line numbers. Keeps `https://` intact. */
function stripComments(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  out = out
    .split('\n')
    .map((line) => {
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === '/' && line[i + 1] === '/' && line[i - 1] !== ':') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
  return out;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walk(full));
    } else if (entry.name.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ⚠️ A check that cannot read its input must ERROR, never pass. A verifier that inspects nothing
// and reports OK is worse than no check at all.
for (const required of [SRC, LOOP]) {
  if (!fs.existsSync(required)) {
    console.error(`❌ validate-ab-inputs: required path not found: ${required}`);
    console.error('   Cannot verify anything — refusing to report success.');
    process.exit(1);
  }
}

const files = walk(SRC);
if (files.length === 0) {
  console.error(`❌ validate-ab-inputs: Found 0 TypeScript files under ${SRC}`);
  console.error('   Nothing was inspected — refusing to report success.');
  process.exit(1);
}

const violations = [];

// ── Rule 1 — across all live code ──────────────────────────────────────────────────────
for (const file of files) {
  const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (SNAPSHOT_MODE.test(line)) {
      violations.push({
        rule: 1,
        file: path.relative(NEST, file),
        line: i + 1,
        text: line.trim(),
        fix: 'resolve the mode from the owning BOT: AbTestService.resolveTradeAuthority(snapshotId)',
      });
    }
  });
}

// ── Rule 2 — inside runAbTest only ─────────────────────────────────────────────────────
{
  const source = stripComments(fs.readFileSync(LOOP, 'utf8'));
  const start = source.indexOf('private async runAbTest(');
  if (start === -1) {
    console.error('❌ validate-ab-inputs: `private async runAbTest(` not found in automation-loop.service.ts');
    console.error('   The A/B cadence could NOT be inspected — refusing to report success.');
    console.error('   If the method was renamed, update this guard rather than deleting the check.');
    process.exit(1);
  }
  const rest = source.slice(start + 1);
  const endRel = rest.search(/\n  (?:private|public|protected|async|\/\*\*)/);
  const body = endRel === -1 ? rest : rest.slice(0, endRel);
  const bodyStartLine = source.slice(0, start).split('\n').length;

  body.split('\n').forEach((line, i) => {
    if (LITERAL_CADENCE.test(line)) {
      violations.push({
        rule: 2,
        file: 'src/modules/automation/automation-loop.service.ts',
        line: bodyStartLine + i + 1,
        text: line.trim(),
        fix: "use selectBaseTimeframe(this.protocolDb.getCached(protocolId)?.recommendedTimeframe) (#908)",
      });
    }
  });
}

if (violations.length > 0) {
  console.error('❌ validate-ab-inputs: the A/B runner is sourcing an input from the WRONG PLACE (#929).');
  console.error('');
  for (const v of violations) {
    console.error(`   [rule ${v.rule}] ${v.file}:${v.line}  ${v.text}`);
    console.error(`              FIX: ${v.fix}`);
  }
  console.error('');
  if (violations.some((v) => v.rule === 1)) {
    console.error('   Rule 1 — a snapshot holds the SCORING style in `mode` ("score"), never a trading');
    console.error("             mode. `'auto'` is not a value a scoring strategy has ever held, so any");
    console.error('             comparison against it is silently false and the order path becomes');
    console.error('             unreachable. A/B ran a day without one order because of this.');
  }
  if (violations.some((v) => v.rule === 2)) {
    console.error('   Rule 2 — a hardcoded cadence scores a protocol against bars it was never designed');
    console.error('             for. Measured: 94/BUY on 15m became 15/HOLD on 5m — the runner was');
    console.error('             measuring a configuration that does not exist in production.');
  }
  console.error('');
  console.error('   See #929 and nest/src/modules/automation/ab-trade-authority.spec.ts');
  process.exit(1);
}

console.log(`✅ validate-ab-inputs: A/B sources its mode from the bot and its cadence from the protocol (${files.length} files scanned)`);
