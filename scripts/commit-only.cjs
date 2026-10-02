#!/usr/bin/env node
/**
 * commit-only.cjs — commit EXACTLY the files you name, in a working tree eight agents share.
 * ================================================================================
 * Not a build gate and deliberately not wired into `prebuild`: this is a COMMIT-time tool, and
 * `prebuild` runs at build time. It guards the one moment where a shared tree bites.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS PREVENTS (measured in anger, 2026-09-23)
 * ─────────────────────────────────────────────────────────────────────────
 * **The git index is shared state.** All agents run in ONE working tree, so when another agent
 * runs `git add`, their files sit in the same index. `git commit -m "..."` with no pathspec
 * commits the whole index.
 *
 * Measured: an agent ran `git add <one file>`, printed `git diff --cached --name-status` — which
 * showed **15 files, 14 of them not theirs** — and committed anyway. The commit carried another
 * agent's editions work including their `0.71.0 -> 0.72.0` version bump, under a `docs(handoff)`
 * message.
 *
 * ⚠️ **The check worked and its output was ignored.** That is the same shape as a ticked box for a
 * check that was never run: a verification step whose result is not consumed. So this script does
 * not merely REPORT — it removes the ambiguity:
 *
 *   1. `git commit -- <pathspec>` commits ONLY the named paths, ignoring the rest of the index
 *      entirely. The safe path becomes the default path rather than advice.
 *   2. After committing it READS THE COMMIT BACK (`git show --name-only`) and asserts the file set
 *      matches what was asked for. A commit that silently absorbed something else is caught by
 *      observation, not by trusting the command that ran.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────
 *   node scripts/commit-only.cjs -m "message" -- <file> [<file>...]
 *   node scripts/commit-only.cjs -m "subject" -m "body para" -- <file>     (repeat -m)
 *   node scripts/commit-only.cjs --check -- <file> [<file>...]             (report, commit nothing)
 *   node scripts/commit-only.cjs --self-test
 *
 * Exit codes: 0 committed (or check clean) · 1 refused, with the reason.
 *
 * ⚠️ A file you name that has NO changes is reported and the script REFUSES. Naming a file is a
 * claim that it changed; a claim with no evidence behind it is worth failing on, because it usually
 * means the wrong path was typed and something else was meant to be committed.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * ⚠️ `COMMIT_ONLY_REPO` exists ONLY so `--self-test` can point the real CLI at a throwaway repo.
 * It is what makes the canary test THIS SCRIPT end to end rather than merely re-asserting how
 * `git commit -- <pathspec>` behaves, which would prove nothing about the code here.
 */
const REPO_ROOT = process.env.COMMIT_ONLY_REPO
  ? path.resolve(process.env.COMMIT_ONLY_REPO)
  : path.resolve(__dirname, '..');

const TAG = '[commit-only]';

function die(message, hint) {
  console.error(`[commit-only] \u2716 ${message}`);
  if (hint) console.error(`    \u2192 ${hint}`);
  process.exit(1);
}

/** Run git and return trimmed stdout, or throw with git's own message attached. */
function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/**
 * Run git and return the output as LINES, preserving each line's leading whitespace.
 *
 * ⚠️ `git()` above `.trim()`s the whole string, which is correct for a single value and WRONG for
 * `status --porcelain`. A worktree-only modification is emitted as `" M mine.js"` — the leading
 * space IS the index status (clean), and it is load-bearing. Trimming shifts every column, so
 * `slice(3)` chops into the filename and a genuinely modified file reads as "no changes". That
 * exact bug made this script refuse to commit a file it had just confirmed was dirty.
 */
function gitLines(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.length > 0);
}

/** git wants forward slashes even on Windows. */
function toGitPath(p) {
  return path.relative(REPO_ROOT, path.resolve(REPO_ROOT, p)).split(path.sep).join('/');
}

// ── Argument parsing ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const messages = [];
  const files = [];
  let check = false;
  let selfTest = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') check = true;
    else if (a === '--self-test') selfTest = true;
    else if (a === '-m' || a === '--message') {
      const v = argv[++i];
      if (v === undefined) die(`${a} needs a value`);
      messages.push(v);
    } else if (a === '--') {
      files.push(...argv.slice(i + 1));
      break;
    } else if (a.startsWith('-')) die(`unknown flag ${a}`);
    else files.push(a);
  }
  return { messages, files, check, selfTest };
}

// ── The core: which named files actually have changes, and what else is staged ──
function inspect(files) {
  const named = files.map(toGitPath);

  // `git status --porcelain` is the authority on "has this path changed" — it covers staged,
  // unstaged, untracked and deleted in one place, which `git diff` alone does not.
  // ⚠️ MUST use gitLines, not git: see the note on gitLines for why trimming breaks this.
  const statusLines = gitLines(['status', '--porcelain']);
  const changedSet = new Set();

  for (const line of statusLines) {
    // Format: XY<space>path   — and `R  old -> new` for renames.
    const rest = line.slice(3);
    const p = rest.includes(' -> ') ? rest.split(' -> ')[1] : rest;
    changedSet.add(p.replace(/^"|"$/g, ''));
  }

  const withChanges = named.filter((p) => changedSet.has(p));
  const withoutChanges = named.filter((p) => !changedSet.has(p));

  // Everything currently in the index, so we can TELL the agent what we are deliberately leaving.
  const staged = gitLines(['diff', '--cached', '--name-only']);
  const namedSet = new Set(named);
  const leftBehind = staged.filter((p) => !namedSet.has(p));

  return { named, withChanges, withoutChanges, staged, leftBehind };
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const { messages, files, check } = parseArgs(process.argv.slice(2));

  if (files.length === 0) {
    die(
      'no files named',
      'name every file you intend to commit: node scripts/commit-only.cjs -m "msg" -- <file>...',
    );
  }
  if (!check && messages.length === 0) {
    die('no -m message given', 'a commit needs a message; use --check for a dry run');
  }

  // A verifier that cannot read its input must ERROR, never pass.
  try {
    git(['rev-parse', '--git-dir']);
  } catch {
    die('not inside a git repository', 'run this from the repo root');
  }

  // ⚠️ A path that is ABSENT is either a DELETION or a typo, and the two are told apart by EVIDENCE
  // rather than assumed. `git cat-file -e HEAD:<path>` answers it: HEAD holds the path and the
  // working tree does not ⇒ a deletion to commit. Absent from BOTH ⇒ still a typo.
  // Added 2026-10-02: the Execution Queue split produced `D src/pages/ExecutionQueuePage.jsx` and
  // this script REFUSED it, so a real deletion could not go through the safe path at all.
  for (const p of files) {
    if (fs.existsSync(path.resolve(REPO_ROOT, p))) continue;
    let inHead = true;
    try {
      git(['cat-file', '-e', `HEAD:${p}`]);
    } catch {
      inHead = false;
    }
    if (!inHead) {
      die(
        `${p} does not exist and is not in HEAD`,
        'a named path absent from BOTH the working tree and HEAD is a typo, not a deletion',
      );
    }
  }

  const { named, withChanges, withoutChanges, leftBehind } = inspect(files);

  if (withoutChanges.length > 0) {
    die(
      `${withoutChanges.length} named file(s) have NO changes: ${withoutChanges.join(', ')}`,
      'naming a file claims it changed. Check the path — something else was probably meant.',
    );
  }

  console.log(`[commit-only] committing ${named.length} named file(s):`);
  for (const p of withChanges) console.log(`    ${p}`);

  if (leftBehind.length > 0) {
    console.log(
      `[commit-only] \u2139 ${leftBehind.length} other file(s) are staged in the shared index and ` +
        'will NOT be included:',
    );
    for (const p of leftBehind.slice(0, 12)) console.log(`    (skipped) ${p}`);
    if (leftBehind.length > 12) console.log(`    (skipped) ...and ${leftBehind.length - 12} more`);
  }

  if (check) {
    console.log('[commit-only] \u2713 --check: index inspected, nothing committed');
    return;
  }

  // ⚠️ STAGE THE NAMED PATHS FIRST. `git commit -- <path>` requires the path to be KNOWN to git,
  // so a brand-new (untracked) file fails with "pathspec did not match any file(s) known to git".
  // Found by dogfooding: the first version of this script could not commit itself.
  // Adding to the shared index is safe here precisely BECAUSE the commit below is pathspec-limited —
  // anything already staged by another agent is left staged and untouched (proven in --self-test).
  try {
    git(['add', '--', ...named]);
  } catch (err) {
    die('git add failed', String(err.stderr || err.message).trim().split('\n').slice(-3).join(' | '));
  }

  // ⚠️ THE POINT OF THE SCRIPT: the explicit `--` pathspec means git commits ONLY these paths and
  // ignores the rest of the index. This is what stops another agent's staged work being absorbed.
  const args = ['commit'];
  for (const m of messages) args.push('-m', m);
  args.push('--', ...named);
  try {
    git(args);
  } catch (err) {
    die(
      'git commit failed',
      String(err.stderr || err.message).trim().split('\n').slice(-3).join(' | '),
    );
  }

  // ── Verify AFTER the fact, from the commit itself ────────────────────────────
  // A command that reported success is a claim. The commit's actual file list is the observation.
  const inCommit = gitLines(['show', '--name-only', '--format=', 'HEAD']);
  const committedSet = new Set(inCommit);
  const wantedSet = new Set(named);

  const missing = named.filter((p) => !committedSet.has(p));
  const extra = inCommit.filter((p) => !wantedSet.has(p));

  if (missing.length || extra.length) {
    console.error(
      `[commit-only] \u2716 THE COMMIT DOES NOT MATCH WHAT WAS ASKED FOR (HEAD = ${git([
        'rev-parse',
        '--short',
        'HEAD',
      ])})`,
    );
    if (missing.length) console.error(`    missing: ${missing.join(', ')}`);
    if (extra.length) console.error(`    UNINTENDED: ${extra.join(', ')}`);
    console.error(
      '    To unwind: git reset --mixed HEAD~1   (moves HEAD and the index; touches no working file)',
    );
    process.exit(1);
  }

  console.log(
    `[commit-only] \u2713 HEAD ${git(['rev-parse', '--short', 'HEAD'])} contains exactly the ` +
      `${inCommit.length} named file(s) — verified by reading the commit back`,
  );
}

// ── Self-test — canary in BOTH directions, driving the REAL CLI on a throwaway repo ─────────
/**
 * Runs the actual script (via `COMMIT_ONLY_REPO`) against a temp repo, so every assertion is about
 * this code rather than about git's documented behaviour.
 *
 *   1. a named file with NO changes               -> must REFUSE
 *   2. another agent's file staged but not named  -> must be EXCLUDED, and must survive staged
 *   3. the commit must contain EXACTLY the named file, read back from the commit
 */
function selfTest() {
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-only-selftest-'));

  const g = (args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8' }).trim();

  /** Run THIS script against the temp repo and capture stdout + exit code. */
  const cli = (args) => {
    try {
      const out = execFileSync(process.execPath, [__filename, ...args], {
        cwd: tmp,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, COMMIT_ONLY_REPO: tmp },
      });
      return { code: 0, out };
    } catch (err) {
      return { code: err.status ?? 1, out: String(err.stdout || '') + String(err.stderr || '') };
    }
  };

  let pass = true;
  const say = (ok, msg) => {
    if (!ok) pass = false;
    console.log(`  ${ok ? '\u2713' : '\u2716'} ${msg}`);
  };

  try {
    g(['init', '-q']);
    g(['config', 'user.email', 't@t.t']);
    g(['config', 'user.name', 't']);
    fs.writeFileSync(path.join(tmp, 'mine.js'), 'mine\n');
    fs.writeFileSync(path.join(tmp, 'theirs.js'), 'theirs\n');
    g(['add', 'mine.js', 'theirs.js']);
    g(['commit', '-q', '-m', 'base']);

    // (1) Nothing to commit -> refuse, naming the file.
    const noChange = cli(['-m', 'nope', '--', 'mine.js']);
    say(
      noChange.code === 1 && /NO changes/.test(noChange.out),
      'a named file with NO changes is REFUSED (not silently committed)',
    );

    // (2) The shared-index condition: another agent staged a file we did NOT name.
    fs.writeFileSync(path.join(tmp, 'mine.js'), 'mine changed\n');
    fs.writeFileSync(path.join(tmp, 'theirs.js'), 'theirs changed\n');
    g(['add', 'mine.js', 'theirs.js']);
    const stagedBefore = g(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
    say(stagedBefore.length === 2, 'both files staged — the shared-index condition reproduced');

    // (3) Commit ONLY mine. Theirs is staged and must be ignored, and must stay staged.
    const committed = cli(['-m', 'only mine', '--', 'mine.js']);
    say(committed.code === 0, 'the CLI exits 0 on a clean single-file commit');
    say(
      /NOT be included/.test(committed.out) && /theirs\.js/.test(committed.out),
      'it NAMES the staged file it is deliberately skipping',
    );
    say(
      /verified by reading the commit back/.test(committed.out),
      'it verifies the commit after the fact',
    );

    const inCommit = g(['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
    say(
      inCommit.length === 1 && inCommit[0] === 'mine.js',
      'the commit contains ONLY the named file',
    );

    const stillStaged = g(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
    say(
      stillStaged.length === 1 && stillStaged[0] === 'theirs.js',
      "the other agent's file survives, still staged — nothing of theirs was taken",
    );

    // (4) An ABSORBED file must be detectable — the exact failure that happened in anger.
    //     ⚠️ BOTH files must be re-modified first: `mine.js` was committed at (3), so it currently
    //     has no changes and the script would (correctly) refuse. Asserting against a stale state
    //     is how a canary reports a working guard as broken.
    fs.writeFileSync(path.join(tmp, 'mine.js'), 'mine changed again\n');
    fs.writeFileSync(path.join(tmp, 'theirs.js'), 'theirs changed again\n');
    const both = cli(['-m', 'both', '--', 'mine.js', 'theirs.js']);
    say(both.code === 0, 'naming both commits both');
    const back = g(['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
    const wanted = new Set(['mine.js']);
    say(
      back.filter((p) => !wanted.has(p)).length === 1,
      'an unintended file in a commit IS detectable by reading it back',
    );

    // (5) A mistyped path must refuse rather than commit nothing quietly.
    const ghost = cli(['-m', 'ghost', '--', 'does-not-exist.js']);
    say(ghost.code === 1 && /does not exist/.test(ghost.out), 'a nonexistent path is REFUSED');

    // (6) AN UNTRACKED FILE MUST COMMIT. `git commit -- <path>` requires the path to be known to
    //     git, so a brand-new file fails with "pathspec did not match any file(s) known to git".
    //     The first version of this script could not commit itself. Guarded here so it cannot return.
    fs.writeFileSync(path.join(tmp, 'brand-new.js'), 'new\n');
    const fresh = cli(['-m', 'brand new', '--', 'brand-new.js']);
    say(fresh.code === 0, 'an UNTRACKED file commits (pathspec needs it known to git)');
    const freshBack = g(['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
    say(
      freshBack.length === 1 && freshBack[0] === 'brand-new.js',
      'and the commit contains only it',
    );

    // (7) A DELETION must commit. Case (5) covers the TYPO; this covers the deletion, and they are
    //     the same input shape — an absent path. Evidence separates them: present in HEAD ⇒ a
    //     deletion, absent from both ⇒ a typo. Added 2026-10-02 after a real deletion was refused.
    fs.rmSync(path.join(tmp, 'brand-new.js'));
    const del = cli(['-m', 'delete brand-new', '--', 'brand-new.js']);
    say(del.code === 0, 'a DELETED file commits (absent from the tree, present in HEAD)');
    const delBack = g(['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
    say(
      delBack.length === 1 && delBack[0] === 'brand-new.js',
      'and the deletion commit contains only it',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${TAG} SELF-TEST ${pass ? '\u2713 PASS' : '\u2716 FAIL'}`);
  process.exitCode = pass ? 0 : 1;
}

if (parseArgs(process.argv.slice(2)).selfTest) selfTest();
else main();
