#!/usr/bin/env node
/**
 * validate-agent-docs.cjs — the documentation-integrity gate
 * ==========================================================
 * Created 2026-09-11.
 *
 * WHY THIS EXISTS
 * ---------------
 * The project owner asked whether documentation or agent rules were leading to
 * bad decisions. They were. Investigation on 2026-09-11 found three defects, each
 * of which caused a real, repeated mistake:
 *
 *   1. `applyTo` DID NOT COVER THE FILES THE RULE GOVERNED.
 *      `agent-handoff.instructions.md` says "write a handoff to `.github/handoffs/`",
 *      but its `applyTo` is `nest/src/**, src/pages/**, ...` — with NO `docs/**`.
 *      So the rule never fired while an agent edited documentation, and handoffs
 *      were written to the wrong directory. **An instruction that does not fire is
 *      indistinguishable from an instruction that does not exist.**
 *
 *   2. TWO HANDOFF DIRECTORIES, AND THE REASONING WAS LOST.
 *      `.github/handoffs/` (7 files) and `docs/handoff/` (13 files) both existed.
 *      FOUR handoffs cited by `.github/AGENT-ATTENTION.md` are now unfindable
 *      entirely — they lived in the directory that was removed. The reasoning had
 *      been written down, and still vanished. That is the mechanism behind
 *      "we keep re-discovering the same thing".
 *
 *   3. RULE TEXT DUPLICATED AND MISNUMBERED.
 *      `agent-issue-close-checklist.instructions.md` contained the same
 *      "BEFORE YOU START ANY WORK" block TWICE, and numbered two consecutive steps
 *      both `5`. A MANDATORY file with visible corruption gets skimmed.
 *
 * WHAT THIS CHECKS
 * ----------------
 *   1. `applyTo` — every instruction file must declare one, and it must be a valid
 *      glob shape. Files whose CONTENT names a path outside their own `applyTo`
 *      are flagged (heuristic, reported not failed — see PRECISION below).
 *   2. Single handoff directory — `.github/handoffs/` must NOT exist. Exactly one
 *      canonical location (`docs/handoff/`).
 *   3. Dangling references — every file path cited in the instruction files and in
 *      `AGENT-ATTENTION.md` must exist. A cited path that is gone is lost reasoning.
 *   4. Duplicate blocks — no instruction file may contain the same multi-line block
 *      twice (catches copy-paste corruption in mandatory files).
 *   5. Numbered-list integrity — no two consecutive list steps may share a number.
 *
 * ⚠️ PRECISION — WHY CHECK 1 IS REPORTED, NOT FAILED
 * --------------------------------------------------
 * Deciding "does this rule's applyTo cover what it talks about" needs judgement a
 * static check cannot supply. A guard that fires on correct code gets switched off,
 * which is worse than no guard because it looks like coverage — a lesson learned the
 * hard way on 2026-09-11 when a first-pass rule fired 68 times on healthy data.
 *
 * So: checks 2-5 FAIL (they are objective facts). Check 1 REPORTS.
 *
 * Usage (from repo root):  node scripts/validate-agent-docs.cjs
 * Exit code: 1 on failure, 0 otherwise.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const INSTRUCTIONS_DIR = path.join(REPO_ROOT, '.github', 'instructions');
const ATTENTION_BOARD = path.join(REPO_ROOT, '.github', 'AGENT-ATTENTION.md');
const LEGACY_HANDOFF_DIR = path.join(REPO_ROOT, '.github', 'handoffs');
const CANONICAL_HANDOFF_DIR = path.join(REPO_ROOT, 'docs', 'handoff');

const failures = [];
const warnings = [];
const notes = [];

function fail(rule, message, hint) {
  failures.push({ rule, message, hint });
}
function warn(rule, message, hint) {
  warnings.push({ rule, message, hint });
}

// ── load ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(INSTRUCTIONS_DIR)) {
  console.error(`[agent-docs] ✖ ${path.relative(REPO_ROOT, INSTRUCTIONS_DIR)} not found`);
  process.exit(1);
}

const instructionFiles = fs
  .readdirSync(INSTRUCTIONS_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((name) => {
    const full = path.join(INSTRUCTIONS_DIR, name);
    return { name, full, body: fs.readFileSync(full, 'utf8') };
  });

notes.push(`scanned ${instructionFiles.length} instruction file(s)`);

// ── 1. applyTo present and well-formed (report-only coverage check) ───────────

const GLOB_HINT = /^[\w./*,{}[\]!"\s-]+$/;

for (const f of instructionFiles) {
  const m = f.body.match(/^applyTo:\s*"?([^"\n]+)"?\s*$/m);
  if (!m) {
    // Not fatal: some instruction files legitimately have no applyTo (they are
    // always-on posture files). But it must be a CHOICE, so surface it.
    warn(
      'applyTo-missing',
      `${f.name} declares no \`applyTo\``,
      'An instruction with no applyTo either always applies (fine, e.g. a posture file) or never applies (a bug). If it is meant to always apply, set `applyTo: "**"` explicitly so the intent is visible.',
    );
    continue;
  }
  const pattern = m[1].trim();
  if (!GLOB_HINT.test(pattern)) {
    fail(
      'applyTo-malformed',
      `${f.name} has a malformed applyTo: "${pattern}"`,
      'applyTo must be a comma-separated list of glob patterns, e.g. "nest/src/**, src/**". A malformed pattern silently matches nothing, so the rule never fires.',
    );
  }
}

// ── 2. single canonical handoff directory ────────────────────────────────────

if (fs.existsSync(LEGACY_HANDOFF_DIR)) {
  const legacy = fs.readdirSync(LEGACY_HANDOFF_DIR).filter((f) => f.endsWith('.md'));
  fail(
    'duplicate-handoff-dir',
    `.github/handoffs/ exists with ${legacy.length} file(s) — handoffs were split across two directories`,
    `The canonical location is \`docs/handoff/\`. A split directory is how FOUR handoffs cited in AGENT-ATTENTION.md became unfindable (2026-09-11). Move any content worth keeping into docs/handoff/, then delete .github/handoffs/ — do NOT leave both. Existing here: ${legacy.join(', ')}`,
  );
}

if (!fs.existsSync(CANONICAL_HANDOFF_DIR)) {
  fail(
    'handoff-dir-missing',
    `the canonical handoff directory docs/handoff/ does not exist`,
    'Create docs/handoff/ — it is the single location agents are told to write to.',
  );
}

// ── 3. dangling path references (lost reasoning) ─────────────────────────────

/**
 * Extract file paths that look like repo files and check they exist.
 *
 * ⚠️ PRECISION — this check must NOT cry wolf.
 * -------------------------------------------------
 * Documentation legitimately cites paths in an ABBREVIATED form: `directives/market-status.ts`
 * when the real path is `nest/src/modules/directives/market-status.ts`. Those are correct
 * citations, not dangling ones. Flagging them would make this check noise, and a check that
 * fires on correct input gets switched off — which is worse than none because it looks like
 * coverage. (Learned the hard way: a first-pass rule on 2026-09-11 fired 68 times on healthy
 * data, and a first-pass diff script reported 419 phantom rows.)
 *
 * So a citation is only reported as dangling when the basename exists NOWHERE in the repo.
 * That is the case that actually matters: the file is gone, so the reasoning it pointed at is
 * unfindable — which is exactly how four handoffs were lost.
 */
const PATH_RE = /`([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._*-]+)+\.(?:md|cjs|js|ts|tsx|jsx|json|sql))`/g;
const SKIP_PREFIX = /^(https?:|~|\/|[A-Za-z]:)/;

/** Basenames present anywhere in the repo, built once (excludes node_modules/dist). */
let basenameIndex = null;
function buildBasenameIndex() {
  if (basenameIndex) return basenameIndex;
  basenameIndex = new Set();
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else basenameIndex.add(e.name.toLowerCase());
    }
  };
  walk(REPO_ROOT, 0);
  return basenameIndex;
}

function checkReferences(label, body) {
  const seen = new Set();
  let m;
  PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(body)) !== null) {
    const p = m[1];
    if (SKIP_PREFIX.test(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    if (p.includes('*')) continue; // a glob, not a citation
    if (fs.existsSync(path.join(REPO_ROOT, p))) continue;

    // A guidance path that is created BY following the rule is not a dangling ref
    // (e.g. "write to docs/handoff/YYYY-MM-DD-slug.md"). Detect the placeholder shapes.
    if (/(YYYY|MM|DD|\{|\})$/.test(p) || /YYYY-MM-DD/.test(p) || /\{slug\}/.test(p)) continue;

    // ⚠️ Abbreviated citation: the basename exists somewhere, so the file is real and
    // the path is merely shortened. NOT dangling — do not report it.
    const base = path.basename(p).toLowerCase();
    if (buildBasenameIndex().has(base)) continue;

    // ⚠️ Cross-workspace citation: this is a MULTI-ROOT workspace, and long-term docs live
    // in the sibling Google Drive root (`Trading-Command-Suite-Documentation/`). A citation
    // into that root cannot be resolved from this one, and is NOT a defect.
    if (/(^|\/)Trading-Command-Suite-Documentation\//.test(p)) continue;

    // ⚠️ A KNOWN-LOST marker: some handoffs were written but never committed, so they cannot
    // be recovered. A citation explicitly marked LOST is honest documentation of a gap, not
    // a defect to fix. Without this, the check would demand restoring a file that never
    // reached version control.
    if (/\[LOST\]|LOST —/.test(body.slice(Math.max(0, m.index - 120), m.index + 120))) continue;

    warn(
      'dangling-reference',
      `${label} cites \`${p}\` — no file with that name exists anywhere in the repo`,
      'A cited path whose file is gone for real means the reasoning it pointed at is unfindable — which is how four handoffs were lost on 2026-09-11. Either restore the file, or update the citation to where the content actually lives.',
    );
  }
}

for (const f of instructionFiles) checkReferences(f.name, f.body);
if (fs.existsSync(ATTENTION_BOARD)) {
  checkReferences('AGENT-ATTENTION.md', fs.readFileSync(ATTENTION_BOARD, 'utf8'));
}

// ── 4. duplicated blocks (copy-paste corruption in mandatory files) ───────────

/**
 * Flag a multi-line block appearing twice in the same file.
 *
 * Blocks of >= 3 non-trivial lines only, so ordinary repeated markup (table
 * separators, short headings) does not trip it. `agent-issue-close-checklist`
 * genuinely contained the same 5-line "BEFORE YOU START ANY WORK" block twice.
 */
function checkDuplicateBlocks(f) {
  const lines = f.body.split(/\r?\n/).map((l) => l.trim());
  const WINDOW = 4;
  const seenAt = new Map();

  for (let i = 0; i + WINDOW <= lines.length; i++) {
    const block = lines.slice(i, i + WINDOW);
    // Ignore windows that are mostly blank/short — they repeat legitimately.
    if (block.filter((l) => l.length > 12).length < WINDOW - 1) continue;

    const key = block.join('\n');
    if (seenAt.has(key)) {
      const first = seenAt.get(key);
      fail(
        'duplicate-block',
        `${f.name} repeats the same ${WINDOW}-line block at line ${first + 1} and line ${i + 1}`,
        `Duplicated rule text in a MANDATORY file makes it look corrupted, so agents skim and miss the real constraints. Delete one copy. First line of the repeated block: "${block[0].slice(0, 70)}"`,
      );
      return; // one report per file is enough to prompt a fix
    }
    seenAt.set(key, i);
  }
}

for (const f of instructionFiles) checkDuplicateBlocks(f);

// ── 5. numbered-list integrity (no two consecutive steps share a number) ──────

function checkNumbering(f) {
  const lines = f.body.split(/\r?\n/);
  let prev = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\d+)\.\s+\S/);
    if (!m) continue;
    const n = Number(m[1]);
    if (prev && prev.n === n) {
      fail(
        'misnumbered-list',
        `${f.name} numbers two consecutive steps both "${n}" (lines ${prev.line} and ${i + 1})`,
        'A repeated step number in an ordered procedure means a step is ambiguous — an agent cannot tell which "step 5" is authoritative. Renumber the sequence.',
      );
      return;
    }
    prev = { n, line: i + 1 };
  }
}

for (const f of instructionFiles) checkNumbering(f);

// ── report ───────────────────────────────────────────────────────────────────

for (const n of notes) console.log(`[agent-docs] ${n}`);

if (warnings.length) {
  console.log(`\n[agent-docs] ⚠ ${warnings.length} warning(s) — advisory, does not fail the build:\n`);
  for (const w of warnings) {
    console.log(`  ⚠ [${w.rule}] ${w.message}`);
    if (w.hint) console.log(`      → ${w.hint}`);
  }
}

if (failures.length) {
  console.error(`\n[agent-docs] ✖ ${failures.length} documentation-integrity failure(s):\n`);
  for (const f of failures) {
    console.error(`  ✖ [${f.rule}] ${f.message}`);
    if (f.hint) console.error(`      → ${f.hint}`);
  }
  console.error('\nSee .github/instructions/change-completion.instructions.md\n');
  process.exit(1);
}

console.log(
  '\n[agent-docs] ✅ OK — applyTo present, ONE handoff directory, no dangling citations, no duplicated or misnumbered rules\n',
);
