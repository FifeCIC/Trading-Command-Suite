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
/**
 * ⚠️ THE MIRROR MOVED OUT OF THE REPOSITORY (owner, 2026-11-16). The rule corpus now lives in the
 * docs store, so the mirror is resolved from two candidates: the old in-repo path (so checking out
 * an older commit still checks what that commit contains) and the docs-store copy.
 * When neither exists the check reports UNVERIFIED — it must never claim the pair agrees.
 */
const DOCS_STORE_MIRROR =
  'G:\\My Drive\\Project Management\\Live\\Trading-Command-Suite-Documentation\\agent-ops\\instructions\\output-style-guide.instructions.md';
const MIRROR_SOURCE = path.join(REPO_ROOT, '.github', 'instructions', 'output-style-guide.instructions.md');
/** Whichever copy exists. `readOrNull` below reports a missing one rather than throwing. */
const MIRROR = fs.existsSync(MIRROR_SOURCE) ? MIRROR_SOURCE : DOCS_STORE_MIRROR;

/**
 * The portable source.
 *
 * ⚠️ MEASURED 2026-11-17 — THE DECLARED LOCATION IS NOT WHERE THE FILE IS, and that is why this
 * gate has been exiting UNVERIFIED instead of checking anything. The VS Code prompt folder
 * (`%APPDATA%\Code\User\prompts\`) does not exist on this machine. The rules that are ACTUALLY
 * loaded into every agent session live at `~/.copilot/instructions/output-style-guide.instructions.md`
 * — confirmed by matching a section ("Mode first") that only that copy contains.
 *
 * So the real source is tried FIRST, and the declared location is kept as a fallback for a machine
 * where VS Code prompts are still in use. Returning the first that exists matters: pointing at a
 * path that holds nothing is what made this check silently unable to see its own input.
 */
function sourcePath() {
  const candidates = [
    path.join(os.homedir(), '.copilot', 'instructions', 'output-style-guide.instructions.md'),
    (() => {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(appData, 'Code', 'User', 'prompts', 'output-style-guide.instructions.md');
    })(),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[1];
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

/**
 * ── THE THIRD COPY ────────────────────────────────────────────────────────────────────────────────
 *
 * There are THREE copies of this document, and until 2026-11-18 this check knew about two:
 *
 *   LIBRARY   ReactStackCore/agent-library/instructions/…   ← `npm run library:install --apply` DEPLOYS THIS over the source
 *   SOURCE    ~/.copilot/instructions/…                     ← what every agent session receives
 *   MIRROR    the docs store copy                           ← what this check compares against SOURCE
 *
 * ⚠️ THE FAILURE THIS PREVENTS, MEASURED 2026-11-18: the library copy was two whole sections behind
 * the source — it had **7** `## ` headings against the source's **10**, missing `🥇 Mode first` and
 * `⛔ The no-wall rule` entirely. `library:install --apply` copies library → source, so running it
 * would have **deleted both sections from the file every agent obeys**, with no warning, no error,
 * and no backup. The two missing sections are the ones that govern the shape of every reply.
 *
 * ⚠️ ADVISORY, ALWAYS — never fatal, in any mode. The library lives in a DIFFERENT repository that
 * another agent may be mid-edit in; this repo's build must not red for that. The point is only that
 * the risk stops being silent: the build now says the install would lose specific sections, by name.
 *
 * ⚠️ COMPARES `## ` HEADINGS, NOT BYTES. The library is deliberately not byte-identical (it carries
 * the same explanatory header), and a byte comparison would fail for reasons that are not this. A
 * missing HEADING is the thing that loses a rule.
 */
const LIBRARY_SOURCE = 'C:\\wamp64\\www\\ReactStackCore\\agent-library\\instructions\\output-style-guide.instructions.md';

/** `## ` headings present in `from` and absent from `to`. Empty when `to` is null (cannot compare). */
function missingSections(from, to) {
  if (!from || !to) return [];
  const have = new Set(
    to
      .split(/\r?\n/)
      .filter((l) => /^## /.test(l))
      .map((l) => l.trim()),
  );
  return from
    .split(/\r?\n/)
    .filter((l) => /^## /.test(l))
    .map((l) => l.trim())
    .filter((h) => !have.has(h));
}

/** Print the third-copy advisory. Never exits, never changes the exit code. */
function reportLibraryDrift(sourceText) {
  const libraryText = readOrNull(LIBRARY_SOURCE);
  if (libraryText === null) {
    console.log('[style-sync] ℹ third copy: not on this machine — library install risk NOT assessed');
    return;
  }
  const missing = missingSections(sourceText, libraryText);
  if (!missing.length) {
    console.log('[style-sync] ✅ third copy: library is not missing any section of the source');
    return;
  }
  console.log(
    `[style-sync] ⚠ THIRD COPY IS BEHIND — \`npm run library:install --apply\` would DELETE ` +
      `${missing.length} section(s) from the source, which every agent obeys:`,
  );
  for (const h of missing) console.log(`[style-sync]     ${h}`);
  console.log('[style-sync]   Library:  ' + LIBRARY_SOURCE);
  console.log('[style-sync]   Port these into the library BEFORE any install. Advisory only — the');
  console.log('[style-sync]   library is another repository and never blocks this build.');
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

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

  // Printed in every mode and never fatal — see the doc comment on `reportLibraryDrift`.
  reportLibraryDrift(sourceText);

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

/**
 * Self-test for the THIRD-COPY advisory.
 *
 * ⚠️ A guard that has never been observed to fail is a decoration, and this one is easy to write in
 * a way that can never fire: `missingSections(from, null)` returns `[]` by design (nothing to
 * compare), so a test that only ever passes `null` would report a clean bill of health for a library
 * it never read. The cases below assert BOTH directions, and the "identical" case is what proves the
 * function is not simply returning everything.
 */
function selfTest() {
  const source = [
    '# Title',
    '## 🥇 Mode first',
    'body',
    '## ⛔ The no-wall rule — checkable',
    'body',
    '## Core rules',
    '### a sub-heading is not a section for this comparison',
    '## Reusable blocks',
  ].join('\n');

  const behind = ['# Title', '## Core rules', '## Reusable blocks'].join('\n');
  const equal = ['# Title', '## 🥇 Mode first', '## ⛔ The no-wall rule — checkable', '## Core rules', '## Reusable blocks'].join('\n');

  const cases = [
    ['a library two sections behind is REPORTED', () => missingSections(source, behind).length === 2],
    [
      'and the missing sections are NAMED, not just counted',
      () => missingSections(source, behind).join('|').includes('Mode first'),
    ],
    ['an identical library reports NOTHING', () => missingSections(source, equal).length === 0],
    ['an unreadable library (null) reports NOTHING — cannot compare', () => missingSections(source, null).length === 0],
    ['an unreadable SOURCE reports NOTHING — cannot compare', () => missingSections(null, equal).length === 0],
    [
      'a library with EXTRA sections is not a failure — extra is not loss',
      () => missingSections(behind, source).length === 0,
    ],
    [
      '`### ` sub-headings are not treated as sections',
      () => !missingSections(source, equal).some((h) => h.startsWith('###')),
    ],
  ];

  let failed = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try {
      ok = fn() === true;
    } catch {
      ok = false;
    }
    console.log(`  ${ok ? '✅' : '✖ '} ${name}`);
    if (!ok) failed++;
  }
  console.log(
    failed === 0
      ? `[style-sync] ✅ self-test ${cases.length}/${cases.length} — the third-copy advisory can fire and can stay quiet`
      : `[style-sync] ✖ self-test: ${failed} of ${cases.length} FAILED`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
