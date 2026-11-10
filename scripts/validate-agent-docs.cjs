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
 *      (2026-09-13: the surviving set moved OUT of the app package to the central
 *      docs store, because the repo becomes public. Check 8 now asserts the rule still
 *      names that store.)
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
 *   6. Retired handoff target — no file under `.github/` may tell an agent to WRITE/READ
 *      `.github/handoffs/`. Check 2 fails only if the DIRECTORY exists; it does not stop a
 *      prompt, skill, or instruction from citing the retired path. On 2026-09-13 four such
 *      citations remained (start.prompt.md, the librarian skill ×2, agent-qa-testing) even
 *      though the directory itself was already gone — the same defect class as the original
 *      `applyTo` bug (a rule pointing at the wrong location). Historical mentions are allowed.
 *   7. Doc headers — every `.md` under `docs/` should carry a date/status header so its age is
 *      visible (documentation-standards.instructions.md §3). REPORTED, not failed, while the
 *      legacy backlog is back-filled — a gate that fails on day one gets switched off.
 *   9. Docs are not task trackers — an open `- [ ]` under `docs/` FAILS. Open work belongs on a
 *      GitHub issue. A reusable template opts out with `<!-- doc-tasks-allowed -->`.
 *      (2026-09-13: ~40 open boxes were found across 10+ non-roadmap files in both roots, most
 *      already done or moot. Same failure mode as the retired `prompts/` queue.)
 *
 * ⚠️ PRECISION — WHY CHECK 1 IS REPORTED, NOT FAILED
 * --------------------------------------------------
 * Deciding "does this rule's applyTo cover what it talks about" needs judgement a
 * static check cannot supply. A guard that fires on correct code gets switched off,
 * which is worse than no guard because it looks like coverage — a lesson learned the
 * hard way on 2026-09-11 when a first-pass rule fired 68 times on healthy data.
 *
 * So: checks 2-6, 8 and 9 FAIL (they are objective facts). Checks 1 and 7 REPORT.
 *
 * Usage (from repo root):  node scripts/validate-agent-docs.cjs
 * Exit code: 1 on failure, 0 otherwise.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const INSTRUCTIONS_DIR = path.join(REPO_ROOT, '.github', 'instructions');
const AGENTS_DIR = path.join(REPO_ROOT, '.github', 'agents');
const ATTENTION_BOARD = path.join(REPO_ROOT, '.github', 'AGENT-ATTENTION.md');
const LEGACY_HANDOFF_DIR = path.join(REPO_ROOT, '.github', 'handoffs');

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
    `.github/handoffs/ exists with ${legacy.length} file(s) — the retired in-repo location`,
    `Handoffs live in the central docs store (\`…\\Trading-Command-Suite-Documentation\\handoff\\\`), NOT in the app package. A split directory is how FOUR handoffs cited in AGENT-ATTENTION.md became unfindable (2026-09-11). Move any content worth keeping to the central store, then delete .github/handoffs/ — do NOT leave both. Existing here: ${legacy.join(', ')}`,
  );
}

// The canonical handoff store is EXTERNAL as of 2026-09-13 — it is outside the repo, so it cannot
// be checked on disk from CI. Check 8 asserts the RULE still names it instead, which is the thing
// that actually governs where agents write. (The old `handoff-dir-missing` check was removed:
// requiring an in-repo directory is what kept handoffs inside the public package.)

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

    // ⚠️ A citation into the CENTRAL DOCS STORE: handoffs, theory, commercial and archived working
    // docs all live OUTSIDE the repo by rule (2026-09-13), so a citation to one cannot be resolved
    // here and is NOT a defect. Only repo-local citations are checked for existence.
    if (/^(handoff|archive|commercial|website)\//.test(p) || /^docs\/(theories|wiki-seed)\//.test(p)) continue;

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

    // ── KNOWN FALSE ALARM: BUILD OUTPUT PATHS (2026-11-07) ────────────────────────────────────────
    // `dist/src/main.js` is cited in `agent-environment.instructions.md` and `AGENT-ATTENTION.md`
    // *inside shell commands run with `cwd=nest`*, where the short form is CORRECT — the real path is
    // `nest/dist/src/main.js`. The file also legitimately does not exist after a `rimraf dist`.
    //
    // ⇒ The two remaining warnings are a documented false alarm, NOT a defect. Rewriting those
    //   citations to satisfy this checker would make ~20 correct commands wrong — the same mistake as
    //   changing correct CSS to silence a noisy validator. Annotated deliberately.
    //
    // The general rule this checker is MISSING, for whoever picks it up: *a relative path cited next
    // to a stated working directory (or inside a command that cds first) is not dangling.* That is a
    // behaviour change and needs its own canary — it is not attempted here, and the false alarm is
    // recorded rather than silenced. A build output that disappears is the second half of the class.
    //
    // ⚠️ NARROW ON PURPOSE: `^dist/src/` is the BUILT ENTRY POINT (emitted by `build:api`, removed by
    // `rimraf dist`), which is the only shape that legitimately vanishes. A broader `/dist\//` would
    // hide a real dangling `src/dist/foo.js`, and an over-broad exemption is worse than the false
    // alarm it replaces.
    if (/^nest\/dist\/src\//.test(p) || /^dist\/src\//.test(p)) continue;

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

// ── 6. retired handoff directory must not be cited as a TARGET ───────────────
//
// WHY: check 2 fails only when `.github/handoffs/` EXISTS as a directory. It does not stop
// an instruction file, prompt, skill, or agent definition from TELLING an agent to write or
// read there — which is the same defect class as the original `applyTo` bug: a rule that
// points at the wrong location never fires, or fires somewhere harmless. On 2026-09-13 four
// such citations remained (start.prompt.md, update-architecture-framework/SKILL.md ×2,
// agent-qa-testing.instructions.md) even though the directory itself was long gone.
//
// PRECISION: a historical mention — "`.github/handoffs/` was REMOVED", "previously said", a
// HANDOFF LOST marker — is CORRECT documentation and must NOT fail. So a line is flagged only
// when it carries a read/write verb AND has no historical marker. (A guard that fires on
// correct input gets switched off, which is worse than none.)

function collectMarkdown(dir, out, depth = 0) {
  if (depth > 6) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectMarkdown(full, out, depth + 1);
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const HISTORICAL_MENTION =
  /previously|earlier version|REMOVED|historical|no longer|LOST|must not|do not|not be recreated|was |were |retired|corrected|renamed|migrated/i;
const TARGET_VERB =
  /\b(write|written|writes|read|reads|reading|record|records|save|saves|create|creates|batch-process)/i;

for (const full of collectMarkdown(path.join(REPO_ROOT, '.github'), [])) {
  const rel = path.relative(REPO_ROOT, full);
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.includes('.github/handoffs/')) return;
    if (HISTORICAL_MENTION.test(line)) return;
    if (!TARGET_VERB.test(line)) return;
    fail(
      'retired-handoff-dir-citation',
      `${rel}:${i + 1} tells an agent to use the retired \`.github/handoffs/\` directory`,
      'The canonical handoff store is the central docs store (`…\\Trading-Command-Suite-Documentation\\handoff\\`) — `.github/handoffs/` was REMOVED on 2026-09-11 and the build fails if it reappears. Repoint this citation at the central store. (A historical note that merely MENTIONS the removal is fine and is not flagged.)',
    );
  });
}

// ── 7. doc headers present (report-only while the legacy backlog is back-filled) ─
//
// WHY: a scan on 2026-09-13 found 13 of 40 docs under `docs/` carrying no date or status, so
// their age is invisible and no one can tell what is stale. `.github/instructions/
// documentation-standards.instructions.md` now requires a header; this surfaces the backlog.
//
// ⚠️ REPORT-ONLY on purpose. A new gate that fails on day one (13 pre-existing files) gets
// switched off, which is worse than no gate because it looks like coverage. Drive this list to
// zero, then promote it to a failure.

const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const DOC_DATE_RE = /\b(19|20)\d{2}-\d{2}-\d{2}\b/;
const DOC_FIELD_RE = /^\s*(\*\*)?(Status|Category|Created|Last updated|Last reviewed|Date|Updated)\b/im;
const docsMissingHeader = [];

if (fs.existsSync(DOCS_DIR)) {
  for (const full of collectMarkdown(DOCS_DIR, [])) {
    const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
    if (rel.startsWith('docs/handoff/')) continue; // handoffs use their own mandated frontmatter
    const head = fs.readFileSync(full, 'utf8').split(/\r?\n/).slice(0, 8).join('\n');
    if (DOC_DATE_RE.test(head) || DOC_FIELD_RE.test(head)) continue;
    docsMissingHeader.push(rel);
  }
}

if (docsMissingHeader.length) {
  warn(
    'doc-header-missing',
    `${docsMissingHeader.length} doc(s) under docs/ carry no date or status header`,
    `Add the standard header (documentation-standards.instructions.md §3). Files: ${docsMissingHeader.slice(0, 20).join(', ')}${docsMissingHeader.length > 20 ? ` … (+${docsMissingHeader.length - 20} more)` : ''}`,
  );
}

// ── 8. the handoff location must still be DECLARED ───────────────────────────
//
// Handoffs moved OUT of the app package on 2026-09-13 (the repo becomes public). Because the store
// is external it cannot be checked on disk from CI — so assert instead that the rule agents follow
// still NAMES it. An instruction that does not name a location is how handoffs end up back in a
// retired directory, which is the exact bug this file exists to catch.

const HANDOFF_RULE = path.join(INSTRUCTIONS_DIR, 'agent-handoff.instructions.md');
if (fs.existsSync(HANDOFF_RULE)) {
  const ruleBody = fs.readFileSync(HANDOFF_RULE, 'utf8');
  if (!/Trading-Command-Suite-Documentation[\\/]+handoff/i.test(ruleBody)) {
    fail(
      'handoff-location-undeclared',
      'agent-handoff.instructions.md no longer names the central handoff store',
      'The canonical handoff store is `…\\Trading-Command-Suite-Documentation\\handoff\\`. If it moved, update this rule AND scripts/validate-agent-docs.cjs together — otherwise agents will write to the retired location again.',
    );
  }
}

// ── 9. docs describe what IS — no task lists in documents ────────────────────
//
// Open work belongs on a GitHub issue. Checkboxes buried in documents are invisible from the
// tracker and go stale silently — measured 2026-09-13: ~40 open boxes across 10+ non-roadmap files
// in both roots, most already done or moot ("a trailing-stop loop needs to be built" — it existed;
// four Trading212 API questions — Trading212 was discontinued).
//
// A reusable TEMPLATE is the one legitimate exception and must opt in with
// `<!-- doc-tasks-allowed -->`, so the exemption is a visible choice rather than an accident.

const TASK_MARKER = /<!--\s*doc-tasks-allowed\s*-->/;
if (fs.existsSync(DOCS_DIR)) {
  for (const full of collectMarkdown(DOCS_DIR, [])) {
    const body = fs.readFileSync(full, 'utf8');
    if (TASK_MARKER.test(body)) continue;
    if (!/^\s*[-*]\s*\[ \]/m.test(body)) continue;
    const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
    fail(
      'doc-task-list',
      `${rel} contains an open checkbox — a document is not a task tracker`,
      'Open work belongs on a GitHub issue — attach it to the relevant epic. Remove the checkbox and file/attach it instead. For a reusable template, add `<!-- doc-tasks-allowed -->`. See documentation-standards.instructions.md §5.',
    );
  }
}

// ── 10. an AGENT FILE THE CLIENT CANNOT LOAD IS AN AGENT THAT DOES NOT EXIST ──
//
// ⚠️ Measured 2026-11-09: `.github/agents/technical-wiki.agent.md` and `website-builder.agent.md`
// declared `argumentHint:` (camelCase) and neither `tools:` nor `user-invocable:`. They were absent
// from the agent picker entirely — the client silently ignored them — while the other three in the
// same folder (`librarian`, `primary`, `trading-watchdog`) appeared normally. So two agents had been
// unusable for however long, and NOTHING validated this folder: this script only ever read
// `.github/instructions/`. A file that looks like an agent and is never loaded is the same defect as
// a rule that never fires — it reads like a capability and provides none.
//
// ⚠️ The key names are KEBAB-CASE. VS Code's agent frontmatter is `argument-hint`, not `argumentHint`.
// A camelCase key is not an error the file parser reports; it is simply not a key it knows, so the
// field silently means nothing.
const AGENT_REQUIRED = ['description'];
const AGENT_KNOWN_KEYS = new Set([
  'name', 'description', 'tools', 'agents', 'argument-hint', 'user-invocable',
  'hooks', 'model', 'target', 'disable-model-invocation',
]);
const AGENT_CAMEL_TRAPS = {
  argumentHint: 'argument-hint',
  userInvocable: 'user-invocable',
  disableModelInvocation: 'disable-model-invocation',
};

function checkAgentFiles() {
  if (!fs.existsSync(AGENTS_DIR)) {
    warn('agents-dir-missing', '.github/agents does not exist', 'With no agent folder, the picker offers only built-in agents.');
    return 0;
  }
  const files = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.agent.md'));
  for (const name of files) {
    const body = fs.readFileSync(path.join(AGENTS_DIR, name), 'utf8');
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
    if (!m) {
      fail(
        'agent-no-frontmatter',
        `.github/agents/${name} has no YAML frontmatter`,
        'An agent without frontmatter is not loadable. It needs at least a `description:`.',
      );
      continue;
    }
    const keys = [...m[1].matchAll(/^([A-Za-z][\w-]*):/gm)].map((k) => k[1]);
    for (const k of keys) {
      if (AGENT_CAMEL_TRAPS[k]) {
        fail(
          'agent-camelcase-key',
          `.github/agents/${name}: \`${k}:\` is not a recognised key — it is \`${AGENT_CAMEL_TRAPS[k]}:\``,
          `Frontmatter keys here are kebab-case. \`${k}\` is silently ignored, which is how this file went unloadable.`,
        );
      } else if (!AGENT_KNOWN_KEYS.has(k)) {
        warn(
          'agent-unknown-key',
          `.github/agents/${name}: \`${k}:\` is not a known agent key`,
          `Known: ${[...AGENT_KNOWN_KEYS].join(', ')}. An unknown key does nothing — it is not a warning the client shows you.`,
        );
      }
    }
    for (const req of AGENT_REQUIRED) {
      if (!keys.includes(req)) {
        fail(
          'agent-missing-key',
          `.github/agents/${name} declares no \`${req}\``,
          'The client needs it to list the agent at all.',
        );
      }
    }
    if (!keys.includes('tools')) {
      warn(
        'agent-no-tools',
        `.github/agents/${name} declares no \`tools:\` list`,
        'Without it the agent runs with whatever the client defaults to, which is not a decision anyone recorded.',
      );
    }
    if (!keys.includes('user-invocable')) {
      warn(
        'agent-no-user-invocable',
        `.github/agents/${name} does not declare \`user-invocable: true\``,
        'Unless deliberately hidden from the picker, declare it — an agent nobody can select is not an agent.',
      );
    }
  }
  return files.length;
}

const agentFileCount = checkAgentFiles();
notes.push(`scanned ${agentFileCount} agent file(s) in .github/agents`);

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
  '\n[agent-docs] ✅ OK — applyTo present, ONE handoff directory (no retired citations), no dangling citations, no duplicated or misnumbered rules, no doc task lists\n',
);
