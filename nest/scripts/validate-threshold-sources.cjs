#!/usr/bin/env node
/**
 * validate-threshold-sources.cjs — no policy value may live outside its owner.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * The 2026-09-15 rescale (ADR-011) divided every strength percentage by ~6.3 so the pipeline
 * would trade at all. It updated the OWNERS correctly:
 *
 *     protocol-gating.service.ts   ENTRY_THRESHOLD 40 → 6,  STRONG_PCT 80 → 13
 *     style-thresholds.ts          STYLE_THRESHOLDS, BOT_BAR_DEFAULT 60 → 10,
 *                                  SIGNALS_GATE_DEFAULT 65 → 10
 *
 * …and left at least EIGHT literal copies of the old scale behind — in server fallbacks, an API
 * controller default, a UI form default, and two Prisma column defaults. Every one of them is a
 * bar that can no longer be cleared (measured `compositePct` ceiling is ~33).
 *
 * The consequence is the worst kind: a bot created through the UI or the API silently never
 * trades. It is active, it scores, it emits SKIP decisions with a *plausible* reason
 * ("composite 18 < minComposite 65"), and nothing errors. Same shape as the silent five-day
 * outage this rescale was fixing, pointing the other way. Issue #839.
 *
 * ⚠️ The lesson is NOT "be careful". Difficulty is not a control. `style-thresholds.ts` already
 * documented the unification of these very numbers — two services previously declared the same
 * five style→bar values with different fallbacks, and the comments admitted the duplication.
 * That fix was real and it still drifted, because nothing FAILED when a new literal was added.
 * This script is that failure.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE RULE
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 *   A strength threshold may be DECLARED in exactly one file, and CONSUMED by import elsewhere.
 *
 * This is the same contract the repo already applies to invariants (`INV-*` in
 * meta-stack-contracts.instructions.md, guarded at build time) and to schema safety. Thresholds
 * were the one policy family with no such guard.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * USAGE
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 *   node nest/scripts/validate-threshold-sources.cjs            # report + exit code
 *   node nest/scripts/validate-threshold-sources.cjs --list     # full inventory, always exit 0
 *   node nest/scripts/validate-threshold-sources.cjs --strict   # fail on warnings too
 *
 * Exit 0 = every threshold is declared once. Exit 1 = a literal was found outside its owner.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const argv = process.argv.slice(2);
const LIST_ONLY = argv.includes('--list');
const STRICT = argv.includes('--strict');

/**
 * OWNERS — the single declaration site for each threshold family.
 *
 * ⚠️ Adding a family here is a deliberate act. If a value has two owners, list the one that is
 * authoritative and let this script find the others.
 */
const OWNERS = {
  // ── Classification (does a reading classify as BUY/STRONG?) ──
  classification: {
    file: 'nest/src/modules/scoring/protocol-gating.service.ts',
    exports: ['ENTRY_THRESHOLD', 'STRONG_PCT', 'SIGNAL_THRESHOLDS'],
    why: 'Owns the BUY/STRONG bars. Exported via SIGNAL_THRESHOLDS and surfaced by GET /api/scoring/gated/thresholds.',
  },
  // ── Per-style / per-bot strength bars ──
  styleBars: {
    file: 'nest/src/common/utils/style-thresholds.ts',
    exports: ['STYLE_THRESHOLDS', 'BOT_BAR_DEFAULT', 'SIGNALS_GATE_DEFAULT', 'resolveStyleThreshold'],
    why: 'Owns the style→bar table AND the consumer defaults (bot bar, signals gate). Everything else must import from here.',
  },
};

/**
 * CONSUMERS — files allowed to reference a family, but only BY IMPORT.
 *
 * A file here may import `BOT_BAR_DEFAULT`; it may NOT write `?? 60`. That distinction is the
 * whole point: importing is single-sourced, re-declaring is drift.
 */
const CONSUMERS = [
  'nest/src/modules/trading/trading-strategy.service.ts',
  'nest/src/modules/automation/automation.controller.ts',
  'nest/src/modules/automation/automation-loop.service.ts',
  'nest/src/modules/scoring/scoring-strategy.service.ts',
  'nest/src/modules/scoring/scoring.service.ts',
  'nest/src/modules/replay/replay.service.ts',
  'nest/src/modules/signals/signal-envelope.service.ts',
  'src/pages/StrategyCreatePage.jsx',
  'src/core/broker-utils.js',
  'src/core/translators/focused-translator.js',
];

/**
 * ⚠️ OUT-OF-SCALE VALUES — the specific defect shape, not "any number near a threshold".
 *
 * A generic "find numbers between 20 and 100" rule would fire on hundreds of legitimate values
 * (SL/TP percentages, directive maxScores, position sizes) and would be switched off within a
 * week. That is how guards die. So this targets the ONE shape that actually broke:
 *
 *     a percentage-of-capacity threshold literal above the measured ceiling (~35)
 *
 * `compositePct` peaks at ~33 across every active protocol. Any default bar above that cannot be
 * cleared. Numbers below it are not flagged as errors — they may be deliberate (the VIX bot is
 * seeded at 0 on purpose to dodge a gate).
 */
const CEILING_PCT = 35;

/**
 * CANONICAL_VALUE — what a policy column default MUST equal.
 *
 * ⚠️ A schema `@default` is a SECOND OWNER, and it is the sneakiest one: it applies to any INSERT
 * that omits the field, so it can create an unclearable bot even when every line of application
 * code is correct. It cannot import a TS constant, so it cannot be single-sourced — the best that
 * can be done is to VERIFY it equals the owner, which is what this does.
 *
 * Must equal `BOT_BAR_DEFAULT` in `nest/src/common/utils/style-thresholds.ts`.
 */
const CANONICAL_VALUE = 10;

/**
 * Where a default bar is written. Anchored on the identifier, so the regex cannot drift into
 * unrelated arithmetic.
 */
const DEFAULT_BAR_PATTERNS = [
  // `minComposite: 65` / `tradeThreshold: 60` as a plain object property or assignment
  { re: /\b(?:minComposite|tradeThreshold)\s*:\s*(\d{1,3})\b/g, kind: 'property' },
  // `data.minComposite ?? 60` / `dto.tradeThreshold ?? 65`
  { re: /\b(?:minComposite|tradeThreshold)\s*\?\?\s*(\d{1,3})\b/g, kind: 'nullish-default' },
  // `stack.tradeThreshold || 3`
  { re: /\b(?:minComposite|tradeThreshold)\s*\|\|\s*(\d{1,3})\b/g, kind: 'or-default' },
  // ⚠️ The KEYED + COERCED form: `tradeThreshold: parseInt(e.target.value) || 65`.
  // Added 2026-09-15 (#839). Every pattern above requires the identifier to sit IMMEDIATELY before
  // the operator, so a value that is PARSED first was invisible to all of them — and that is the
  // form UI code actually writes. Found live in AutomationDashboardPage.jsx: a 65 fallback on an
  // empty input, i.e. the guard's own headline defect, sitting inside the guard's own scan root.
  // The negated class stops at a comma/brace/newline so the match cannot wander across a line.
  { re: /\b(?:minComposite|tradeThreshold)\s*:\s*[^,;}\n]{0,80}?\|\|\s*(\d{1,3})\b/g, kind: 'or-default-coerced' },
  // `useState(65)` where the state is named minComposite (StrategyCreatePage)
  { re: /\bconst\s*\[\s*(?:minComposite|tradeThreshold)\s*,\s*set\w+\s*\]\s*=\s*useState\(\s*(\d{1,3})\s*\)/g, kind: 'ui-initial-state' },
  // Prisma column default: `minComposite Float @default(60)`
  { re: /\b(?:minComposite|tradeThreshold)\s+\w+\s+@default\(\s*(\d{1,3})\s*\)/g, kind: 'prisma-default' },
];

/** Files to scan. Source + schema only; never node_modules, dist, or docs. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|prisma)$/.test(e.name)) out.push(full);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

const files = [
  ...walk(path.join(ROOT, 'nest', 'src')),
  ...walk(path.join(ROOT, 'src')),
  ...walk(path.join(ROOT, 'nest', 'prisma')),
];

const findings = [];

for (const file of files) {
  const relPath = rel(file);
  const isOwner = Object.values(OWNERS).some((o) => o.file === relPath);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);

  for (const { re, kind } of DEFAULT_BAR_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = Number(m[1]);
      const upTo = text.slice(0, m.index);
      const lineNo = upTo.split('\n').length;
      const lineText = (lines[lineNo - 1] || '').trim();

      // ⚠️ A COMMENT IS DOCUMENTATION, NOT CONFIGURATION.
      // The rescale notes deliberately quote the old values (40 → 6, "was 65"). Flagging those
      // would make the guard useless and get it disabled — the exact failure it exists to stop.
      const isComment =
        /^\s*(\/\/|\*|\/\*|#)/.test(lineText) ||
        /^\s*['"`]/.test(lineText);

      const outOfScale = value > CEILING_PCT;

      if (isOwner) {
        if (!isComment && outOfScale) {
          findings.push({ level: 'info', relPath, lineNo, kind, value, lineText, note: 'owner declaration — allowed here' });
        }
        continue;
      }

      if (isComment) continue; // historical note, not a live default

      if (outOfScale) {
        findings.push({ level: 'error', relPath, lineNo, kind, value, lineText,
          note: `out-of-scale default (ceiling ≈ ${CEILING_PCT}). This bar CANNOT be cleared — the bot would silently never trade. Import BOT_BAR_DEFAULT / SIGNALS_GATE_DEFAULT instead (#839).` });
      } else if (kind === 'prisma-default' && value !== CANONICAL_VALUE) {
        // ⚠️ In-range but NOT the canonical value. A drifting schema default is still a second
        // owner — it would stamp new rows with a bar that disagrees with everything else.
        findings.push({ level: 'error', relPath, lineNo, kind, value, lineText,
          note: `schema default ${value} != canonical BOT_BAR_DEFAULT (${CANONICAL_VALUE}). A column default applies to any INSERT that omits the field, so it can create a bot that disagrees with every other bar. Change it in schema.prisma AND with an explicit ALTER TABLE — 'prisma db push' is destructive here (see database-schema.instructions.md). Driver: nest/scripts/apply-threshold-column-defaults.cjs` });
      } else {
        findings.push({ level: 'warning', relPath, lineNo, kind, value, lineText,
          note: 'hardcoded bar inside the valid range — still a second owner that will drift. Prefer the canonical constant.' });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// FRONTEND THRESHOLD MEMORY — a module-level numeric threshold declared in `src/`.
//
// WHY THIS WAS ADDED (2026-09-16, #847)
// --------------------------------------
// This guard already scanned `src/`, but only for `minComposite` / `tradeThreshold` literals. It
// therefore could not see `src/core/signal-utils.js`:
//
//     let _buyThreshold = 65;
//     let _holdThreshold = 40;
//
// Those two numbers were a hand-copied duplicate of the pre-rescale classification scale, and the
// comment above them claimed they came from `GET /api/settings/signals` — an endpoint that does
// NOT exist. `setSignalThresholds()` has no caller, so the frontend classified against 65/40 for its
// entire life. Measured live: `strategy_signal_queue.compositePct` runs 7-17, so **0 of 16 rows**
// could reach 40 and every queued signal rendered "low" while the server called some of them
// BUY/STRONG. Exactly the #839 shape — plausible output, no error.
//
// ⚠️ THE PATTERN IS DELIBERATELY NARROW AND ANCHORED. A looser `threshold\s*=\s*\d+` matches prose
// in architecture-reference.js, a scroll pixel value in StickyHeader.jsx and a comment in
// SettingsPage.jsx. Measured 2026-09-16: the anchored form matches 2 lines and both are real. A
// guard with false positives gets allowlisted, and an allowlisted guard is worse than none.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const FRONTEND_THRESHOLD_OWNERS = [
  {
    file: 'src/core/signal-utils.js',
    why: 'The declared owner of the legacy 0-100 DISPLAY scale (65/40). It is deliberately NOT the ADR-011 percent scale (entry 6 / strong 13) — percentages are classified by thresholdGeometry() in src/core/score-display.js. Two scales, two owners, both named.',
  },
];

const MODULE_THRESHOLD_RE = /^(?:let|const)\s+_?\w*(?:[Tt]hreshold|[Bb]ar|[Gg]ate)\w*\s*=\s*(\d+)/;

for (const file of files) {
  const relPath = rel(file);
  if (!relPath.startsWith('src/')) continue; // frontend only — backend bars are handled above
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const m = MODULE_THRESHOLD_RE.exec(lineText.trim());
    if (!m) continue;
    // A commented-out declaration is documentation, not configuration (same rule as above).
    if (/^\s*(\/\/|\*|\/\*|#)/.test(lineText)) continue;

    const owner = FRONTEND_THRESHOLD_OWNERS.find((o) => o.file === relPath);
    findings.push({
      level: owner ? 'info' : 'error',
      relPath,
      lineNo: i + 1,
      kind: 'frontend-threshold-memory',
      value: Number(m[1]),
      lineText: lineText.trim(),
      note: owner
        ? owner.why
        : 'A module-level numeric threshold declared in the frontend. The frontend must READ a bar, not remember one — two memory sites is exactly how the 65/40 copy survived the 2026-09-15 rescale (#839, #847). Read it from GET /api/scoring/gated/thresholds via fetchScoringThresholds(), or add this file to FRONTEND_THRESHOLD_OWNERS with a reason if it is a genuine owner.',
    });
  }
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────
const errors = findings.filter((f) => f.level === 'error');
const warnings = findings.filter((f) => f.level === 'warning');
const infos = findings.filter((f) => f.level === 'info');

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.relPath)) byFile.set(f.relPath, []);
  byFile.get(f.relPath).push(f);
}

console.log('\nThreshold source audit — one value, one owner\n');
console.log('OWNERS (the only declarations allowed to exist):');
for (const [family, o] of Object.entries(OWNERS)) {
  console.log(`  ${family.padEnd(15)} ${o.file}`);
  console.log(`  ${' '.repeat(15)} exports: ${o.exports.join(', ')}`);
}

if (LIST_ONLY || findings.length === 0) {
  console.log('\nCONSUMERS referencing bars:');
  for (const [file, fs_] of byFile) {
    console.log(`  ${file}`);
    for (const f of fs_) {
      const mark = f.level === 'error' ? '✖' : f.level === 'warning' ? '⚠' : '·';
      console.log(`     ${mark} L${String(f.lineNo).padStart(4)}  ${f.kind} = ${f.value}`);
    }
  }
  console.log('');
}

if (errors.length) {
  console.log(`\n✖ ${errors.length} THRESHOLD LITERAL(S) OUTSIDE AN OWNER:\n`);
  for (const f of errors) {
    console.log(`  ${f.relPath}:${f.lineNo}   (${f.kind} = ${f.value})`);
    console.log(`      ${f.lineText.slice(0, 130)}`);
    console.log(`      → ${f.note}\n`);
  }
}

if (infos.length) {
  console.log(`\nℹ ${infos.length} legitimate owner declaration(s):`);
  for (const f of infos) console.log(`  ${f.relPath}:${f.lineNo} = ${f.value}  (${f.note})`);
}

if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} in-range hardcoded bar(s) — second owners, will drift:`);
  for (const f of warnings) console.log(`  ${f.relPath}:${f.lineNo}  ${f.kind} = ${f.value}`);
}

if (LIST_ONLY) {
  console.log('\n(--list: reporting only, exiting 0)\n');
  process.exit(0);
}

const failed = errors.length > 0 || (STRICT && warnings.length > 0);

if (failed) {
  console.log(
    `\n${errors.length} error(s)${STRICT ? `, ${warnings.length} warning(s) (--strict)` : ''}.\n\n` +
    `FIX: import the canonical constant instead of writing a literal.\n` +
    `     nest/src/common/utils/style-thresholds.ts  →  BOT_BAR_DEFAULT, SIGNALS_GATE_DEFAULT, STYLE_THRESHOLDS\n` +
    `     nest/src/modules/scoring/protocol-gating.service.ts  →  SIGNAL_THRESHOLDS\n` +
    `     frontend: READ a bar, do not remember one  →  fetchScoringThresholds() + thresholdGeometry()\n\n` +
    `WHY: the 2026-09-15 rescale updated the owners and left literals on the old scale, producing\n` +
    `     bots that appear active and silently never trade (#839), and a UI that classified every\n` +
    `     percent-of-capacity value as "low" (#847).\n`,
  );
  process.exit(1);
}

console.log('\n✅ OK — every threshold has exactly one owner and every consumer imports it.\n');
process.exit(0);
