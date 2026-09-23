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
 * ⚠️ ON DEMAND, NOT IN PREBUILD — deliberately.
 * A prose-style divergence should not fail the build for a change that has nothing to do with
 * reply formatting. A gate that fires for reasons unrelated to the work in hand is a gate that
 * gets allowlisted, and an allowlisted gate is worse than none. Run this after editing either copy.
 *
 * USAGE
 *   node scripts/validate-output-style-sync.cjs          # report drift; exit 1 if drifted
 *   node scripts/validate-output-style-sync.cjs --sync   # copy the source body into the mirror
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
  const src = sourcePath();

  const sourceText = readOrNull(src);
  const mirrorText = readOrNull(MIRROR);

  // A check that cannot read its input must ERROR, never pass. Silently reporting OK when the
  // source is missing is the defect this whole file exists to avoid.
  if (sourceText === null) {
    console.error(`[style-sync] ✖ source not found — cannot verify anything: ${src}`);
    console.error('[style-sync]   If VS Code moved, update sourcePath() in this script.');
    process.exit(2);
  }
  if (mirrorText === null) {
    console.error(`[style-sync] ✖ mirror not found: ${path.relative(REPO_ROOT, MIRROR)}`);
    process.exit(2);
  }

  const expected = norm(sourceText).replace(/\n+$/, '\n');
  const actual = extractMirrorBody(mirrorText);

  if (actual === null) {
    console.error(`[style-sync] ✖ the mirror has no ${BEGIN} / ${END} markers.`);
    console.error('[style-sync]   Without them the sync cannot be checked at all.');
    process.exit(2);
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

  console.error('[style-sync] ✖ DRIFT — the mirror and the portable source disagree.');
  console.error(`[style-sync]   source: ${src}`);
  console.error(`[style-sync]   mirror: ${path.relative(REPO_ROOT, MIRROR)}`);
  console.error(`[style-sync]   first difference at line ${line + 1} of the mirrored region:`);
  console.error(`[style-sync]     mirror: ${JSON.stringify(a[line] ?? '<end of file>')}`);
  console.error(`[style-sync]     source: ${JSON.stringify(b[line] ?? '<end of file>')}`);
  console.error('[style-sync]   Repair with:  node scripts/validate-output-style-sync.cjs --sync');
  process.exit(1);
}

main();
