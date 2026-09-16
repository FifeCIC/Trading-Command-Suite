#!/usr/bin/env node
/**
 * validate-timezone-sources.cjs — timezone maths has ONE owner, and DST is never approximated.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * "What is the ET time?" was answered by MONTH ARITHMETIC in two separate files:
 *
 *     market-context.service.ts   const isDST = month >= 2 && month <= 10;  // Mar-Nov
 *     session-window.ts           const isDst = month >= 2 && month <= 10;  // identical
 *     let etHour = at.getUTCHours() - (isDst ? 4 : 5);
 *
 * Real US DST 2026 is **8 Mar → 1 Nov**. So the rule treated ALL of March and ALL of November as
 * EDT — the ET clock ran **an hour ahead for ~36 days a year** — and that value feeds
 * `sessions[].active`, `opensIn` and `closesIn`, i.e. *which markets report as open*.
 *
 * ⚠️ The two copies were DELIBERATELY identical. `session-window.ts` said so:
 * *"identical to the historic MarketContextService behaviour, so session boundaries do not move
 * as a side effect of this file."* That is a reasonable instinct — but it means fixing one alone
 * makes the two DISAGREE, which is worse than both being consistently wrong. **Both must move in
 * the same commit.** This guard fails if a hand-rolled rule reappears in either.
 *
 * The correct owner already existed: `common/utils/session-time.ts` resolves a zone's real offset
 * via `Intl` (`zoneOffsetMs`, `minutesInZone`, `zonedWallClockInstant`). It was written for epic
 * #731, where this exact class of bug made `session-open-effect` score 6,308 times without ever
 * leaving its no-signal branch.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE RULE
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 *   A UTC↔local conversion is declared once (`session-time.ts`) and imported everywhere.
 *   DST is NEVER inferred from a month range.
 *
 * USAGE (from nest/):
 *   node scripts/validate-timezone-sources.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** The owner of UTC↔zone conversion. */
const OWNER_FILE = 'nest/src/common/utils/session-time.ts';
const OWNER_EXPORTS = ['zoneOffsetMs', 'minutesInZone', 'zonedWallClockInstant', 'minutesFromOpen'];

/**
 * ⚠️ DETECTION IS BY SHAPE, NOT BY NAME — but it must ALSO be narrow enough to be trusted.
 *
 * The first version matched any `month >= N && month <= M` range and immediately produced a FALSE
 * POSITIVE: `sell-in-may.directive.ts` uses `month >= 4 && month <= 9` for the May–October
 * *seasonal window*, which has nothing to do with DST. A guard that fires on correct code gets
 * switched off — the exact outcome its own comments warn about — so the month range is no longer
 * sufficient on its own.
 *
 * DST inference has a SIGNATURE the seasonal window does not: a month range that DECIDES AN HOUR
 * OFFSET. Requiring both means the seasonal window, OpEx week, and every other calendar range
 * are ignored, while a reintroduced `isDst = month >= 2 && month <= 10` still fails.
 */
const FORBIDDEN = [
  {
    // The offset PAIR itself — `? 4 : 5` / `? -4 : -5`. This is the DST approximation in its
    // most recognisable form and appears only in that context.
    re: /\?\s*-?[45]\s*:\s*-?[45]\b/g,
    label: 'hardcoded EDT/EST offset pair',
    why:
      'A `? 4 : 5` pair IS the month approximation. Use minutesInZone() from ' +
      'common/utils/session-time.ts — it resolves the real offset via Intl.',
  },
  {
    // A UTC hour shifted by a ternary — `getUTCHours() - (isDst ? 4 : 5)`.
    re: /getUTCHours\(\)\s*[-+]\s*\(?\s*\w+\s*\?\s*\d+\s*:/gi,
    label: 'hand-rolled UTC→local hour shift',
    why: 'A literal hour offset cannot be DST-correct. Use minutesInZone().',
  },
  {
    // The DST-guess idiom named explicitly: `<ident containing dst> = <month comparison>`.
    // Anchored on the DST NAMING so a seasonal window is never matched.
    re: /\b\w*dst\w*\s*=\s*[^;\n]*\bmonth\w*\s*[<>]=?\s*\d+/gi,
    label: 'DST inferred from a MONTH RANGE',
    why:
      'Real US DST is 8 Mar → 1 Nov, so a Mar–Nov range is an hour wrong for ~36 days a year. ' +
      'Use minutesInZone() — it resolves the real offset at the actual instant.',
  },
];

/**
 * Files allowed to show the WRONG approach on purpose — because they exist to demonstrate it.
 * Each needs a reason; an unexplained exemption is how a guard dies.
 */
const INTENTIONAL_DEMOS = [
  {
    file: 'src/components/FeatureLab/TimezoneDecisionDemo.jsx',
    why:
      'FeatureLab demo that deliberately contrasts hardcoded offsets/DST months against IANA ' +
      'resolution to teach the difference. The wrong values are the SUBJECT, not the implementation.',
  },
];

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

const files = [
  ...walk(path.join(ROOT, 'nest', 'src')),
  ...walk(path.join(ROOT, 'src')),
  ...walk(path.join(ROOT, 'nest', 'scripts')),
  ...walk(path.join(ROOT, 'scripts')),
];

const problems = [];
const demos = [];
const ownerHits = [];

for (const file of files) {
  const relPath = rel(file);
  if (relPath === OWNER_FILE) continue; // the owner may do whatever it needs

  const demo = INTENTIONAL_DEMOS.find((d) => d.file === relPath);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const lines = text.split(/\r?\n/);

  for (const { re, label, why } of FORBIDDEN) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const lineNo = text.slice(0, m.index).split('\n').length;
      const lineText = (lines[lineNo - 1] || '').trim();

      // ⚠️ A comment or a doc string that QUOTES the bad shape is documentation, not a defect.
      // `architecture-reference.js` and the guards themselves quote old values to explain
      // history; flagging those would make this guard useless and get it switched off.
      const isComment = /^(\/\/|\*|\/\*|#)/.test(lineText) || /^\s*['"`]/.test(lineText);

      if (demo) {
        demos.push({ relPath, lineNo, label });
        continue;
      }
      if (isComment) continue;

      problems.push({ relPath, lineNo, label, why, lineText: lineText.slice(0, 120) });
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────────────────────
console.log('\nTimezone axis — one UTC↔local conversion, and DST resolved not approximated\n');
console.log(`OWNER: ${OWNER_FILE}`);
console.log(`       exports: ${OWNER_EXPORTS.join(', ')}\n`);

if (demos.length) {
  console.log(`ℹ ${demos.length} intentional demonstration(s) (wrong values are the SUBJECT):`);
  const byFile = new Map();
  for (const d of demos) byFile.set(d.relPath, (byFile.get(d.relPath) || 0) + 1);
  for (const [f, n] of byFile) {
    console.log(`   ${f}  (${n} match(es))`);
    console.log(`      ${INTENTIONAL_DEMOS.find((d) => d.file === f)?.why ?? ''}`);
  }
  console.log('');
}

if (problems.length) {
  console.log(`✖ ${problems.length} hand-rolled timezone conversion(s):\n`);
  for (const p of problems) {
    console.log(`  ${p.relPath}:${p.lineNo}  — ${p.label}`);
    console.log(`     ${p.lineText}`);
    console.log(`     → ${p.why}\n`);
  }
  console.log('\nFIX: import from the owner — typically `minutesInZone(instant, iana)`.');
  console.log('⚠️  If TWO files carry the same rule, change BOTH in one commit: a partial fix');
  console.log('    leaves them disagreeing, which is worse than both being wrong.\n');
  process.exit(1);
}

console.log('✅ OK — no hand-rolled timezone conversions; DST is resolved by the owner.\n');
process.exit(0);
