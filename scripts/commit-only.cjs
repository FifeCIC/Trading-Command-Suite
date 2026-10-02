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
 *   node scripts/commit-only.cjs -m "..." --why="<reason>" -- <file>...    (override a gate below)
 *
 * ── TWO GATES ON THE MESSAGE, ADDED 2026-10-02 AT THE OWNER'S REQUEST ───────────────────────
 *
 * > *"I do not mind commits not happening straight away and agent AI goes on about it too much.
 * >  I commit manually myself 2-3 times a day. A lot of text is being output about commits and I
 * >  want it to reduce."*
 *
 * The rule already existed in `agent-environment.instructions.md` and **agents kept breaking it
 * anyway** — including the agent that wrote the rule into this file. A rule with no mechanism does
 * not fire, so the two things that cost the owner reading time are now checked HERE:
 *
 *   1. **CADENCE** — WARN if the previous commit was under 4 hours ago. The owner reads every
 *      commit; one every few minutes — 18 in 4.5 hours was measured on 2026-09-23 — trains them to
 *      skim, which is identical to having no evidence trail. Batch instead.
 *   2. **BODY SIZE** — WARN on a message over 1,500 characters. The reasoning belongs in the
 *      HANDOFF or the ISSUE; the commit carries the what and the why in a few lines.
 *
 * ⚠️ **WARNINGS, NOT REFUSALS — owner's call, 2026-10-02:** *"I think 'warn' is fine — it would be
 * good to be able to commit in special circumstances."* A gate that blocks a legitimate commit gets
 * worked around, and a worked-around gate is worse than none. **The commit always proceeds.**
 *
 * ⚠️ The warnings fire at the ONE moment an agent is guaranteed to be looking at its own commit
 * behaviour. `--why="<reason>"` records a deliberate exception in the message and silences them.
 *
 * ⚠️ Thresholds are env-overridable so `--self-test` can drive the gates — `COMMIT_ONLY_CADENCE_HOURS`
 * and `COMMIT_ONLY_MAX_BODY`, either set to `0` to disable.
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
const { execFileSync, spawnSync } = require('node:child_process');

/**
 * ⚠️ `COMMIT_ONLY_REPO` exists ONLY so `--self-test` can point the real CLI at a throwaway repo.
 * It is what makes the canary test THIS SCRIPT end to end rather than merely re-asserting how
 * `git commit -- <pathspec>` behaves, which would prove nothing about the code here.
 */
const REPO_ROOT = process.env.COMMIT_ONLY_REPO
  ? path.resolve(process.env.COMMIT_ONLY_REPO)
  : path.resolve(__dirname, '..');

const TAG = '[commit-only]';

/**
 * The two message gates. Env-overridable SOLELY so `--self-test` can drive them; `0` disables.
 * See the USAGE note for why they exist and what `--why` is for.
 */
const CADENCE_HOURS = Number(process.env.COMMIT_ONLY_CADENCE_HOURS ?? 4);
const MAX_BODY = Number(process.env.COMMIT_ONLY_MAX_BODY ?? 1500);

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
  let why = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') check = true;
    else if (a === '--self-test') selfTest = true;
    else if (a.startsWith('--why=')) why = a.slice('--why='.length);
    else if (a === '--why') {
      const v = argv[++i];
      if (v === undefined) die('--why needs a value');
      why = v;
    }
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
  return { messages, files, check, selfTest, why };
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
  const { messages, files, check, why } = parseArgs(process.argv.slice(2));

  if (files.length === 0) {
    die(
      'no files named',
      'name every file you intend to commit: node scripts/commit-only.cjs -m "msg" -- <file>...',
    );
  }
  if (!check && messages.length === 0) {
    die('no -m message given', 'a commit needs a message; use --check for a dry run');
  }

  // ── THE TWO MESSAGE WARNINGS (2026-10-02) ──────────────────────────────────────────────────
  // ⚠️ WARNINGS, NOT REFUSALS — owner's call, 2026-10-02: *"I think 'warn' is fine - it would be
  // good to be able to commit in special circumstances."* A gate that blocks a legitimate commit
  // gets worked around, and a worked-around gate is worse than none. The commit proceeds.
  //
  // The point of saying it OUT LOUD at the moment of committing is that this is the only place an
  // agent is guaranteed to be paying attention to its own commit behaviour.
  if (!check) {
    const body = messages.join('\n\n');

    if (why) {
      // A recorded reason silences the warnings — the exception is now visible in the message,
      // which is what they were for.
      messages.push(`(--why: ${why})`);
    } else {
      if (CADENCE_HOURS > 0) {
        let lastAt = 0;
        try {
          lastAt = Number(git(['log', '-1', '--format=%ct'])) || 0;
        } catch {
          lastAt = 0; // no commits yet — nothing to batch against
        }
        if (lastAt > 0) {
          const mins = Math.round((Date.now() / 1000 - lastAt) / 60);
          if (mins < CADENCE_HOURS * 60) {
            console.warn(
              `${TAG} ⚠️  last commit was ${mins} min ago — the rule is ~${CADENCE_HOURS}h batching. ` +
                'Committing anyway.',
            );
            console.warn(
              '    The owner reads every commit; frequent small ones train them to skim. If this ' +
                'one is deliberate, --why="<reason>" records it.',
            );
          }
        }
      }

      if (MAX_BODY > 0 && body.length > MAX_BODY) {
        console.warn(
          `${TAG} ⚠️  message is ${body.length} chars (soft cap ${MAX_BODY}). Committing anyway.`,
        );
        console.warn(
          '    The reasoning belongs in the HANDOFF or the ISSUE — keep the commit to the what and ' +
            'the why in a few lines.',
        );
      }
    }
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
  // ── OWNER ASK, 2026-10-02: *"a noticable reduction in how often agents talk about commits."* ──
  //
  // The instruction already said "commit silently — at most one line naming the SHA, in the final
  // summary", and agents kept narrating anyway. This is the ONE moment an agent is guaranteed to be
  // thinking about its own commit, so the reminder is put here rather than in a document it may not
  // re-read. It costs the owner nothing because it is console output, not a reply.
  console.log(
    `${TAG}   \u2192 do NOT report this commit in chat. No SHA, no file list, no "committed" line. ` +
      'The owner reads every commit; restating it is the noise they asked to remove.',
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
 *   4. the CADENCE gate refuses, and `--why` overrides it AND records the reason
 *   5. the BODY gate refuses, and `--why` overrides it
 *
 * ⚠️ KNOWN, UNEXPLAINED: on 2026-10-02 case 7 (a DELETED file commits) failed ONCE and then passed
 * **nine consecutive runs**. The cause was NOT isolated — an earlier `git show` of this file's HEAD
 * version passed, and so did every run after. Do not treat a single failure here as a verdict, and
 * do not treat nine passes as proof it is fixed: **an unisolated flake is reported, not attributed.**
 * If it recurs, the first thing to check is whether `git add -A -- <path>` actually staged the
 * deletion before the CLI was invoked.
 */
function selfTest() {
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-only-selftest-'));

  const g = (args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8' }).trim();

  /**
   * Run THIS script against the temp repo and capture stdout + exit code.
   *
   * ⚠️ The two message gates are DISABLED by default here and re-enabled per case. This suite
   * commits seconds apart by construction, so leaving them on would make every unrelated case fail
   * for a reason that has nothing to do with what it tests — and a canary that cannot isolate its
   * subject reports a working guard as broken.
   */
  const cli = (args, env = {}) => {
    // ⚠️ `spawnSync`, NOT `execFileSync`. The message warnings go to STDERR, and `execFileSync`
    // only surfaces stderr when the process FAILS — so on the success path the warning text was
    // invisible and two canaries failed while the behaviour they check was correct. Capturing both
    // streams unconditionally is what makes a warning assertable at all.
    const r = spawnSync(process.execPath, [__filename, ...args], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        COMMIT_ONLY_REPO: tmp,
        COMMIT_ONLY_CADENCE_HOURS: '0',
        COMMIT_ONLY_MAX_BODY: '0',
        ...env,
      },
    });
    return { code: r.status ?? 1, out: String(r.stdout || '') + String(r.stderr || '') };
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
    //     deletion, absent from both ⇒ a typo.
    //     ⚠️ KNOWN LIMITATION, deliberately not hidden: this covers an UNSTAGED deletion. If the
    //     deletion is ALREADY staged, `git add -- <path>` matches nothing and the script fails at the
    //     staging step — measured 2026-10-02, one commit after this support was written. `-A` does not
    //     fix it either (also measured), so the workaround is `git reset -- <path>` to unstage, then
    //     name it. This canary covers what the code actually guarantees today.
    fs.rmSync(path.join(tmp, 'brand-new.js'));
    const del = cli(['-m', 'delete brand-new', '--', 'brand-new.js']);
    say(del.code === 0, 'a DELETED file commits (absent from the tree, present in HEAD)');
    const delBack = g(['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
    say(
      delBack.length === 1 && delBack[0] === 'brand-new.js',
      'and the deletion commit contains only it',
    );

    // (8) THE CADENCE WARNING — fires UNDER the window and MUST NOT block the commit.
    //     This suite's commits are seconds apart, which is exactly what the rule warns about.
    fs.writeFileSync(path.join(tmp, 'cadence.js'), 'c\n');
    const tooSoon = cli(['-m', 'too soon', '--', 'cadence.js'], { COMMIT_ONLY_CADENCE_HOURS: '4' });
    say(
      tooSoon.code === 0 && /min ago/.test(tooSoon.out),
      '⚠️ a commit UNDER the cadence window WARNS and STILL COMMITS (owner: warn, never block)',
    );
    say(
      g(['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean).includes('cadence.js'),
      'and the commit actually LANDED — the warning did not veto it',
    );

    // (9) --why RECORDS the reason and SILENCES the warning.
    fs.writeFileSync(path.join(tmp, 'cadence2.js'), 'c2\n');
    const withWhy = cli(
      ['-m', 'deliberate', '--why=another agent is blocked by a red tree', '--', 'cadence2.js'],
      { COMMIT_ONLY_CADENCE_HOURS: '4' },
    );
    say(withWhy.code === 0, '--why commits');
    say(!/last commit was|min ago/.test(withWhy.out), 'and SILENCES the cadence warning');
    say(
      /--why: another agent is blocked/.test(g(['log', '-1', '--format=%B'])),
      'and the reason is RECORDED in the message — an unrecorded exception is invisible',
    );

    // (10) THE BODY WARNING — the owner reads every commit, so the reasoning belongs in the handoff.
    fs.writeFileSync(path.join(tmp, 'long.js'), 'l\n');
    const longBody = cli(['-m', 'x'.repeat(2000), '--', 'long.js'], { COMMIT_ONLY_MAX_BODY: '1500' });
    say(
      longBody.code === 0 && /soft cap 1500/.test(longBody.out),
      '⚠️ an over-long message WARNS and STILL COMMITS',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${TAG} SELF-TEST ${pass ? '\u2713 PASS' : '\u2716 FAIL'}`);
  process.exitCode = pass ? 0 : 1;
}

if (parseArgs(process.argv.slice(2)).selfTest) selfTest();
else main();
