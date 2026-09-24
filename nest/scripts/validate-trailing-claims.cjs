#!/usr/bin/env node
/**
 * validate-trailing-claims.cjs — nothing may ANNOUNCE a trailing stop that no path arms.
 * =======================================================================================
 * ⚠️ THIS GUARDS A CLASS, NOT AN INSTANCE — and it is the second time the class has bitten.
 *
 *   #913 (2026-09-21)  `RiskService.updateTrailingStop()` existed with ZERO callers while the bot
 *                      register documented `trailingStopAtProfit` as its input. A control nothing
 *                      ran. Retired.
 *   #936 (2026-09-21)  `trading-strategy.service.placeOrder()` announced "Trailing SL: 0.75% trail"
 *                      in the entry notification AND wrote it into the persisted
 *                      `strategyEvaluation.tradeResult`, returned a `trailingStop` object — and
 *                      `placeOrder()` sent NO trailing parameter while no consumer of that object
 *                      existed anywhere. Every auto entry asserted a mechanism that was not there.
 *
 * Both are the same defect: **a claim written into a durable record with no mechanism behind it.**
 * The damage is not the missing feature, it is that the record LIES — a reader (human or agent)
 * studying a trade's history is told a trailing stop was in place.
 *
 * ⚠️ WHY A SYMPTOM GUARD AND NOT A CAUSE GUARD.
 * The honest general form — "prove every announced mechanism exists" — is not mechanisable. This
 * instead matches the SIGNATURE the lie leaves in source (announcement text describing a trail),
 * which fires without needing to know why the mechanism went missing. It is deliberately narrow:
 * an 8-line description of the trailing mechanism in a COMMENT is fine and common; what is
 * forbidden is building that string into a message a user or the database will read.
 *
 * ⚠️ IF THIS FIRES LEGITIMATELY. The first real trailing stop must be per-bot data armed through a
 * copied configuration (maths-change-requires-ab), and when it ships the announcement becomes
 * TRUE. At that point do NOT allowlist the file — point the announcement at the mechanism that
 * arms it and delete this guard's reason to exist for that site. An allowlist entry here means an
 * announcement with nothing behind it, which is the defect.
 *
 * Usage:  node nest/scripts/validate-trailing-claims.cjs [--self-test]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCOPES = ['nest/src', 'src'];

/** The announcement signature — a user- or record-facing string describing a trail. */
const CLAIM = /`(?:Trailing SL:|Trailing:|Trailing stop:)/;

/**
 * Files allowed to carry the signature, each with a REASON. Keep this list EMPTY if possible —
 * see the header: an entry here means an announcement with no mechanism behind it.
 */
const ALLOWLIST = new Map([]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (/[\\/](node_modules|dist[^\\/]*|build|\.git)([\\/]|$)/.test(full)) continue;
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && !/\.(spec|test)\./.test(e.name)) out.push(full);
  }
  return out;
}

/** The rule, pure, so `--self-test` exercises THE SAME code the build runs. */
function scan(files) {
  const violations = [];
  let scanned = 0;
  for (const full of files) {
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (ALLOWLIST.has(rel)) continue;
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    scanned++;
    lines.forEach((line, i) => {
      const trimmed = line.trimStart();
      // Comments may DISCUSS the mechanism — the explanations in this file do. What is forbidden
      // is a string a user or the database will read.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (CLAIM.test(line)) violations.push({ rel, line: i + 1, text: line.trim() });
    });
  }
  return { violations, scanned };
}

function selfTest() {
  // ⚠️ Writes real temp files and calls the REAL `scan()`. A self-test against a copy would prove
  // nothing — this repo has already recorded that failure once.
  const dir = path.join(ROOT, 'nest', 'src', '__canary-trailing');
  fs.mkdirSync(dir, { recursive: true });
  const good = path.join(dir, 'ok.ts');
  const bad = path.join(dir, 'bad.ts');
  fs.writeFileSync(good, '// Trailing SL: a comment may discuss it\nconst x = 1;\n');
  fs.writeFileSync(bad, 'const msg = `Trailing SL: ${1}% trail`;\n');
  try {
    const { violations } = scan([good]);
    if (violations.length) return 'INVALID — a COMMENT was flagged; the rule cannot tell prose from a message.';
    const second = scan([bad]);
    if (second.violations.length !== 1) return 'INVALID — a real announcement string was NOT flagged.';
    console.log('  ✅ self-test: a comment passes, an announcement string fails (the real scan() both times).');
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv.includes('--self-test')) {
  const problem = selfTest();
  if (problem) {
    console.error(`  ✖ ${problem}`);
    process.exit(1);
  }
  process.exit(0);
}

const files = SCOPES.flatMap((s) => walk(path.join(ROOT, s)));
const { violations, scanned } = scan(files);

// A scan that read nothing must ERROR rather than pass — an empty result is not an all-clear.
if (scanned === 0) {
  console.error('✖ validate-trailing-claims: scanned 0 files — the scope is wrong, this is not a pass.');
  process.exit(1);
}

if (violations.length) {
  console.error('');
  console.error('✖ TRAILING CLAIM WITHOUT A MECHANISM (#913 / #936):');
  for (const v of violations) console.error(`    ${v.rel}:${v.line}  ${v.text}`);
  console.error('');
  console.error('An entry notification or a persisted trade record is telling the reader that a');
  console.error('trailing stop is in place. If that is true, name the code that arms it. If it is');
  console.error('not, delete the claim — the record must not assert a mechanism that does not exist.');
  console.error('');
  process.exit(1);
}

console.log(`✅ Trailing claims — ${scanned} source file(s), no announcement without a mechanism.`);
