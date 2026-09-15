#!/usr/bin/env node
/**
 * validate-text-encoding.cjs — mojibake guard
 * ==========================================
 * Created 2026-09-15 after the protocol Theory text reached the Protocols Registry as mangled
 * characters. The outstanding DiagramsPage case is tracked in #815.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Protocols Registry showed an em dash as three wrong characters (D4 C7 F6) on six
 * protocols. The seed file
 * (`scripts/db/protocol-theory-seed.sql`) is clean UTF-8 — the corruption happened when it
 * was APPLIED. On Windows the mysql client defaults to the OEM code page (CP850), so the
 * em-dash bytes E2 80 94 were read as three characters (D4 C7 F6) and written to the
 * database as mojibake. The data was wrong; nothing errored.
 *
 * Same shape as every other silent defect in this repo: **plausible output, no error**.
 * A file that looks fine in the editor becomes corrupted by the tool that consumes it, and
 * the only evidence is the rendered result.
 *
 * WHAT IT CHECKS
 * --------------
 * Scans source, seed and documentation files for the two classic signatures:
 *
 *   CP850  (OEM, the Windows console default):  E2 80 94  read as  D4 C7 F6
 *   CP1252 (ANSI):                              E2 80 94  read as  E2 20AC 201D
 *
 * Detection is by CHARACTER, not bytes: the artefacts introduce characters from the CP1252
 * 0x80-0x9F block (code points U+20AC, U+201A, U+0192, U+201E, U+2026, U+2020, U+2021,
 * U+02C6, U+2030, U+0160, U+2039, U+0152, U+017D, U+2018, U+2019, U+201C, U+201D, U+2022,
 * U+2013, U+2014, U+2122, U+0161, U+203A, U+0153, U+017E, U+0178) plus the CP850 lead
 * characters (U+00C2, U+00C3, U+00D4, U+00E2, U+00F0). Those are essentially never
 * legitimate in this codebase, so a hit is a real hit.
 *
 * ⚠️ PRECISION. Legitimate typography is NOT flagged: an em dash (U+2014), en dash
 * (U+2013), curly quote (U+2019), arrow (U+2192), middot (U+00B7) or Greek delta (U+0394)
 * all pass untouched — only the corrupted decodings are rejected. A guard that fires on
 * correct text gets switched off.
 *
 * Usage (from repo root):
 *   node scripts/validate-text-encoding.cjs           # check (exit 1 on a hit)
 *   node scripts/validate-text-encoding.cjs --list    # also print file:line of each hit
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SHOW_LINES = process.argv.includes('--list');

/** Directories scanned, relative to the repo root. Generated output is deliberately excluded. */
const SCAN_ROOTS = [
  'src',
  'nest/src',
  'nest/prisma',
  'nest/scripts',
  'scripts',
  '.github',
  'docs',
];
const SCAN_ROOT_FILES = ['README.md', 'SETUP.md', 'DEVELOPMENT.md', 'NEXT-AGENT.md', 'USER_GUIDE.md', 'CHANGELOG.md'];
const SCAN_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.sql', '.md', '.css', '.html', '.ps1', '.py', '.yml', '.yaml', '.prisma']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', 'backups', 'logs', 'data']);

/**
 * Known-mojibake-only characters.
 *
 * = the CP1252 misread lead characters U+00C2, U+00C3, U+00D4, U+00E2, U+00F0 plus the
 * CP1252 0x80-0x9F glyphs that are never legitimate in this repo (U+0152, U+0153, U+0160,
 * U+0161, U+0178, U+017D, U+017E, U+0192, U+02C6, U+02DC, U+2030, U+2020, U+2021, U+201A,
 * U+201E).
 *
 * ⚠️ DELIBERATELY EXCLUDED — these are REAL, correct typography used throughout the codebase
 * and must never be flagged:
 *   U+20AC  euro sign, e.g. trading-constraints.md "~EURO 1,000 notional"
 *   U+2013 U+2014  en/em dash — the repo's standard punctuation
 *   U+2018 U+2019 U+201C U+201D  curly quotes
 *   U+2022 U+2026 U+2122 U+2039 U+203A
 *
 * Every observed corruption still contains a lead character, so dropping these costs no
 * detection power but removes all false positives. A guard that fires on correct text gets
 * switched off, so precision is the whole design here.
 */
const MOJIBAKE_CHARS = /[\u00C2\u00C3\u00D4\u00E2\u00F0\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2030\u2020\u2021\u201A\u201E]/;

/**
 * ALLOWLIST — EMPTY, and it must stay empty.
 *
 * It held one entry, `src/pages/DiagramsPage.jsx`, from 2026-09-15 until the same day, as the
 * visible marker of known debt (#815). `scripts/fix-mojibake.cjs` repaired that file — 214
 * reverse-decode repairs plus 36 botched arrows — and the entry was deleted.
 *
 * An allowlist is how a guard survives an inconvenient finding. If you are about to add an
 * entry here, repair the file instead: `node scripts/fix-mojibake.cjs <file>` (dry run by
 * default).
 */
const ALLOWLIST = new Map();

/**
 * SECOND SIGNATURE — the BOTCHED ARROW (`-` `>` U+2019).
 *
 * Not every corruption round-trips. In DiagramsPage 36 arrows had their lead bytes
 * (U+00E2 U+2020) stripped, leaving a bare U+2019 that reverse-decoding cannot see — it is
 * byte-for-byte the same as an ordinary apostrophe.
 *
 * Measured before adopting this check: across all 1,291 scanned files there were **zero**
 * occurrences of `>` immediately followed by U+2019 (or U+2019 immediately followed by `<`).
 * A signature with no legitimate occurrences is safe to fail the build on.
 *
 * ⚠️ Do NOT widen this to plain U+2019 — that would fire on every possessive apostrophe in
 * the codebase, which is exactly how a guard gets switched off.
 */
const ARROW_ARTIFACT = />\u2019|\u2019</;

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (SCAN_EXTS.has(path.extname(e.name).toLowerCase())) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

const files = [];
for (const r of SCAN_ROOTS) {
  const full = path.join(REPO_ROOT, r);
  if (fs.existsSync(full)) walk(full, files);
}
for (const f of SCAN_ROOT_FILES) {
  const full = path.join(REPO_ROOT, f);
  if (fs.existsSync(full)) files.push(full);
}

const hits = [];
for (const full of files) {
  const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
  const body = fs.readFileSync(full, 'utf8');
  const hasMojibake = MOJIBAKE_CHARS.test(body);
  const hasArrow = ARROW_ARTIFACT.test(body);
  if (!hasMojibake && !hasArrow) continue;
  const allowReason = ALLOWLIST.get(rel);
  const lines = [];
  const kinds = new Set();
  body.split(/\r?\n/).forEach((line, i) => {
    if (MOJIBAKE_CHARS.test(line)) {
      lines.push(i + 1);
      kinds.add('mojibake');
    }
    if (ARROW_ARTIFACT.test(line)) {
      if (!lines.includes(i + 1)) lines.push(i + 1);
      kinds.add('botched-arrow');
    }
  });
  hits.push({ rel, lines, allowReason, kinds: [...kinds].join('+') });
}

const realHits = hits.filter((h) => !h.allowReason);
const allowed = hits.filter((h) => h.allowReason);

console.log(`[text-encoding] scanned ${files.length} file(s) in ${SCAN_ROOTS.length + SCAN_ROOT_FILES.length} location(s)`);

if (allowed.length) {
  console.log(`[text-encoding] ℹ ${allowed.length} allowlisted file(s) with known debt:`);
  for (const a of allowed) console.log(`    - ${a.rel} (${a.lines.length} line(s)) — ${a.allowReason}`);
}

if (realHits.length === 0) {
  console.log('\n[text-encoding] ✅ OK — no mojibake signatures in source, seed or documentation files\n');
  process.exit(0);
}

console.error(`\n[text-encoding] ✖ ${realHits.length} file(s) contain mojibake:\n`);
for (const h of realHits) {
  console.error(`  ✖ ${h.rel} — ${h.lines.length} line(s) [${h.kinds}]`);
  if (SHOW_LINES) console.error(`      lines: ${h.lines.slice(0, 20).join(', ')}${h.lines.length > 20 ? ' …' : ''}`);
}
console.error(
  '\n  This is a CHARSET artefact, not typos. A file is UTF-8 but was read/written as CP850\n' +
    '  (OEM, the Windows console default) or CP1252 (ANSI). Most often it is a SQL seed applied\n' +
    '  without `--default-character-set=utf8mb4` — see scripts/db/protocol-theory-seed.sql.\n' +
    '  `botched-arrow` means a `>` was followed by U+2019: the lead bytes of a U+2192 arrow were\n' +
    '  stripped, leaving a bare apostrophe that reverse-decoding cannot detect.\n' +
    '  Repair it with:  node scripts/fix-mojibake.cjs <file> --apply\n',
);
process.exit(1);
