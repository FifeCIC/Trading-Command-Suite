#!/usr/bin/env node
/**
 * validate-output-style-sync.cjs — keeps the versioned style guide in step with its portable source.
 *
 * WHY THIS EXISTS
 * ---------------
 * The owner's reply-formatting rules live in a VS Code prompt file:
 *
 *   %APPDATA%\Code\User\prompts\output-style-guide.instructions.md
 *
 * That file is versioned NOWHERE — it is untracked in the home repo and lives outside this repo —
 * so a reinstall or a fresh clone loses it. `.github/instructions/output-style-guide.instructions.md`
 * is the mirror, committed here so the rules survive.
 *
 * A mirror drifts. Two copies of the same rules is the most expensive kind of technical debt:
 * both get edited, only one gets the next fix. This script is the guard that makes the drift
 * visible instead of silent.
 *
 * ⚠️ ADVISORY IN THE BUILD, STRICT ON DEMAND — the owner's decision, 2026-09-23.
 * Wired into `prebuild` as `--report`, where it PRINTS and always exits 0. A prose divergence
 * should be LOUD, not FATAL: a gate that reds the build for a reason unrelated to the work in
 * hand gets allowlisted or switched off, and `validate-agent-docs.cjs` already sets that
 * precedent for its documentation checks ("a gate that fails on day one gets switched off").
 * Run it directly, with no flag, and it IS strict — exit 1 on drift.
 *
 * USAGE
 *   node scripts/validate-output-style-sync.cjs            # strict: exit 1 when drifted
 *   node scripts/validate-output-style-sync.cjs --report   # advisory: always exit 0 (prebuild)
 *   node scripts/validate-output-style-sync.cjs --sync     # copy the source body into the mirror
 *
 * ⚠️ THREE OUTCOMES, NEVER COLLAPSED — OK (matches), DRIFT (differs), UNVERIFIED (the source is
 * not on this machine, so NOTHING WAS COMPARED). An unreadable input must never render as OK;
 * that is the silent-empty failure this repo keeps re-finding.
 *
 * THE MARKERS ARE THE MECHANISM
 * -----------------------------
 * The mirror wraps the copied content in `<!-- MIRROR:BEGIN -->` / `<!-- MIRROR:END -->`. Everything
 * between them must EQUAL the source file, byte-for-byte after newline normalisation. Without the
 * markers the check could not tell the mirrored rules from the mirror's own explanatory header —
 * and a check that cannot tell the difference would either pass everything or fail on its own prose.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIRROR = path.join(REPO_ROOT, '.github', 'instructions', 'output-style-guide.instructions.md');

/** The portable source, in the owner's VS Code prompt folder. */
function sourcePath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Code', 'User', 'prompts', 'output-style-guide.instructions.md');
}

const BEGIN = '<!-- MIRROR:BEGIN -->';
const END = '<!-- MIRROR:END -->';

/** Normalise newlines only. Whitespace is NOT normalised — a moved indent is a real difference. */
const norm = (s) => s.replace(/\r\n/g, '\n');

function readOrNull(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** Extract the mirrored region. Returns null when the markers are absent or out of order. */
function extractMirrorBody(text) {
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  if (b === -1 || e === -1 || e < b) return null;
  return norm(text.slice(b + BEGIN.length, e)).replace(/^\n+/, '').replace(/\n+$/, '\n');
}

function main() {
  const sync = process.argv.includes('--sync');
  const report = process.argv.includes('--report');
  const src = sourcePath();

  // `--report` is the prebuild mode: print, and ALWAYS exit 0. `--sync` WRITES files, so it has no
  // business running inside a build — combining the two is a misuse, not a preference, and stays
  // fatal whatever the flags say.
  if (sync && report) {
    console.error('[style-sync] ✖ --sync and --report are mutually exclusive (--sync writes files)');
    process.exit(2);
  }

  /** Advisory (exit 0) in report mode, fatal otherwise. `hard` marks a misuse, never advisory. */
  const stop = (code, lines, hard) => {
    const emit = hard || !report ? console.error : console.log;
    for (const line of [].concat(lines)) emit(line);
    process.exit(hard || !report ? code : 0);
  };

  const sourceText = readOrNull(src);
  const mirrorText = readOrNull(MIRROR);

  // A check that cannot read its input must ERROR, never pass — and the WORDS must match the
  // state. A missing source prints UNVERIFIED, never OK: this repo may legitimately be built on a
  // machine without the owner's prompt folder, but "nothing was compared" is not "matches".
  if (sourceText === null) {
    stop(2, [
      '[style-sync] ⚠ UNVERIFIED — the portable source is not on this machine, so nothing was compared:',
      `[style-sync]     ${src}`,
      '[style-sync]   This is NOT a pass. On the owner\'s machine, the likely cause is VS Code',
      '[style-sync]   having moved — update sourcePath() in this script.',
    ]);
  }
  if (mirrorText === null) {
    stop(2, `[style-sync] ✖ mirror not found: ${path.relative(REPO_ROOT, MIRROR)}`);
  }

  const expected = norm(sourceText).replace(/\n+$/, '\n');
  const actual = extractMirrorBody(mirrorText);

  if (actual === null) {
    stop(2, [
      `[style-sync] ✖ the mirror has no ${BEGIN} / ${END} markers.`,
      '[style-sync]   Without them the sync cannot be checked at all.',
    ]);
  }

  if (actual === expected) {
    console.log(`[style-sync] ✅ OK — mirror matches the portable source (${expected.length} chars)`);
    process.exit(0);
  }

  // Report the first differing line — a retyped diff is a claim; a line number is evidence.
  const a = actual.split('\n');
  const b = expected.split('\n');
  let line = 0;
  while (line < Math.max(a.length, b.length) && a[line] === b[line]) line++;

  if (sync) {
    const rebuilt = mirrorText.slice(0, mirrorText.indexOf(BEGIN) + BEGIN.length) +
      '\n\n' + expected + '\n' + END + mirrorText.slice(mirrorText.indexOf(END) + END.length);
    fs.writeFileSync(MIRROR, rebuilt, 'utf8');

    // Read it back and re-run the comparison — a command reporting success is a claim, and the
    // file on disk is the evidence.
    const after = extractMirrorBody(fs.readFileSync(MIRROR, 'utf8'));
    if (after !== expected) {
      console.error('[style-sync] ✖ --sync wrote the file but the read-back still differs');
      process.exit(2);
    }
    console.log(`[style-sync] ✅ synced — mirror now matches the source (${expected.length} chars)`);
    process.exit(0);
  }

  stop(1, [
    report
      ? '[style-sync] ⚠ DRIFT (advisory — this does NOT block the build)'
      : '[style-sync] ✖ DRIFT — the mirror and the portable source disagree.',
    `[style-sync]   source: ${src}`,
    `[style-sync]   mirror: ${path.relative(REPO_ROOT, MIRROR)}`,
    `[style-sync]   first difference at line ${line + 1} of the mirrored region:`,
    `[style-sync]     mirror: ${JSON.stringify(a[line] ?? '<end of file>')}`,
    `[style-sync]     source: ${JSON.stringify(b[line] ?? '<end of file>')}`,
    '[style-sync]   Repair with:  node scripts/validate-output-style-sync.cjs --sync',
  ]);
}

main();
