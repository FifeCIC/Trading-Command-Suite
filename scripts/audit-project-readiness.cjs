#!/usr/bin/env node
/**
 * audit-project-readiness.cjs — new project bootstrap: what setup, scaffold, environment, guardrails are missing?
 * =================================================================================================
 *
 * ⚠️ `tools-index.cjs` captures only the FIRST line of this docblock as the tool's purpose, and
 * `--find` searches that text. So the words a person would actually type — "new project", "bootstrap",
 * "setup", "scaffold", "environment", "guardrails" — MUST be on line 1. They were on line 2 once, and
 * `--find bootstrap` reported "no tool matches", which is true of the index and false of the tool.
 *
 * THE QUESTION THIS ANSWERS
 * -------------------------
 * Starting a new project, the expensive mistakes are all ABSENCES: no instruction files, no gates, no
 * decision register, no tool index. None of them produce an error — the project just quietly becomes
 * the kind of codebase where every rule has to be retrofitted as debt.
 *
 * This audits an ARBITRARY directory against the practice set established in Trading Command Suite,
 * and prints what is missing, what is present, and what it could not judge.
 *
 * ⚠️ IT IS A READINESS REPORT, NOT A GATE. Exit 1 means "things are missing", which is the normal
 * state of a new project — so this deliberately does NOT belong in `prebuild`. A gate that fires on a
 * healthy new project gets switched off, and an allowlisted guard is worse than none.
 *
 * ── THE FOUR STATES, AND WHY "CANNOT JUDGE" IS ITS OWN ───────────────────────────────────────
 *
 *   present       — the thing exists and was read
 *   partial       — it exists but a required part is absent (the count says how)
 *   missing       — it is not there
 *   cannot-judge  — the path could not be READ. ⚠️ NEVER reported as missing.
 *
 * Collapsing `cannot-judge` into `missing` would tell a new project to build something it may
 * already have; collapsing it into `present` would pass a project nobody inspected. Both are the
 * *plausible output, no error* defect this repo keeps re-finding.
 *
 * ── EXIT CODES ───────────────────────────────────────────────────────────────────────────────
 *   0 = nothing required is missing
 *   1 = at least one REQUIRED item is missing (the normal state of a new project)
 *   2 = CANNOT JUDGE — the target path cannot be read at all
 *
 * Usage:
 *   node scripts/audit-project-readiness.cjs                      # audit this repo
 *   node scripts/audit-project-readiness.cjs --path C:\www\newproj
 *   node scripts/audit-project-readiness.cjs --path . --json      # machine-readable
 *   node scripts/audit-project-readiness.cjs --quiet              # exit code only
 *   node scripts/audit-project-readiness.cjs --self-test          # prove every rule can fail
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// ── small helpers ──────────────────────────────────────────────────────────────

/** Read a file, or return null when it cannot be read. Never throws. */
function readIf(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** All files under `dir` matching an extension set, bounded so a huge tree cannot hang the audit. */
function walk(dir, exts, limit = 4000) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < limit) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'build') continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (stack.length + out.length < limit) stack.push(full);
      } else if (exts.includes(path.extname(e.name))) {
        out.push(full);
      }
    }
  }
  return out;
}

function countMatches(files, pattern) {
  let n = 0;
  for (const f of files) {
    const body = readIf(f);
    if (!body) continue;
    n += (body.match(pattern) || []).length;
  }
  return n;
}

// ── the checks ─────────────────────────────────────────────────────────────────
//
// Each check: { id, label, bucket, required, why, next, run(ctx) -> {state, detail} }
//
// `why` is the measured failure the check prevents — not "good practice". A check whose `why` is a
// slogan cannot be argued with when it fires, so it gets deleted. Every one below names a real defect.

const CHECKS = [
  {
    id: 'instructions-exist',    bucket: 'Governance',
    label: 'Agent/contributor rules exist',
    required: true,
    why: 'Without instructions every session re-derives the project conventions, and each agent invents a slightly different one.',
    next: 'Create .github/instructions/ (private corpus) and/or .github/copilot-instructions.md (published, contributor-facing).',
    run(ctx) {
      // ⚠️ TWO ACCEPTED SHAPES, because TCS measured both: a private rule corpus under
      // `.github/instructions/`, and a PUBLISHED subset at `.github/copilot-instructions.md`. The
      // corpus was moved out of the public repo on 2026-11-16 (`bdfde054`) precisely because the
      // internal process should not be published — so treating "no instructions/ directory" as
      // "no rules" would have told a correctly-configured project to undo that decision.
      //
      // ⚠️ A corpus with NO published subset is still PRESENT, not partial. Keeping the process
      // private is a legitimate choice, not a gap; the published file is its own optional check.
      const dir = path.join(ctx.root, '.github', 'instructions');
      const published = path.join(ctx.root, '.github', 'copilot-instructions.md');
      const corpus = isDir(dir) ? walk(dir, ['.md']) : [];
      const hasPublished = readIf(published) !== null;
      if (corpus.length === 0 && !hasPublished) {
        return { state: 'missing', detail: 'no .github/instructions/ and no .github/copilot-instructions.md' };
      }
      if (corpus.length === 0) return { state: 'present', detail: 'published copilot-instructions.md only' };
      if (!hasPublished) return { state: 'present', detail: `${corpus.length} corpus file(s), private (no published subset)` };
      return { state: 'present', detail: `${corpus.length} corpus file(s) + published subset` };
    },
  },
  {
    id: 'published-rules',
    bucket: 'Governance',
    label: 'A contributor-facing rule file is published',
    required: false,
    why: 'Measured: the 19 instruction files sat in an ordinary tracked folder and were public for weeks before anyone noticed — the choice between private and published has to be made on purpose.',
    next: 'Add .github/copilot-instructions.md carrying only the safety-critical rules, written for contributors.',
    run(ctx) {
      if (!isDir(path.join(ctx.root, '.github'))) return { state: 'cannot-judge', detail: 'no .github/' };
      const published = path.join(ctx.root, '.github', 'copilot-instructions.md');
      const body = readIf(published);
      if (body === null) return { state: 'missing', detail: 'no .github/copilot-instructions.md' };
      return { state: body.length > 200 ? 'present' : 'partial', detail: `${body.length} chars` };
    },
  },
  {
    id: 'instructions-have-applyTo',
    bucket: 'Governance',
    label: 'Every instruction declares applyTo',
    required: true,
    why: 'An instruction with no applyTo may never load, and a rule that does not load is indistinguishable from a rule that does not exist.',
    next: 'Add `applyTo: "**"` (or a narrower glob) to the YAML frontmatter of each file.',
    run(ctx) {
      const dir = path.join(ctx.root, '.github', 'instructions');
      if (!isDir(dir)) {
        // No corpus to judge. That is not a failure of THIS rule — the shape is verified by
        // `instructions-exist`. Saying "missing" here would double-count one absence as two defects.
        return { state: 'cannot-judge', detail: 'no instruction corpus to inspect' };
      }
      const files = walk(dir, ['.md']);
      if (files.length === 0) return { state: 'cannot-judge', detail: 'no files to inspect' };
      const bad = [];
      for (const f of files) {
        const body = readIf(f);
        if (!body) return { state: 'cannot-judge', detail: `could not read ${path.basename(f)}` };
        if (!/^---[\s\S]*?\bapplyTo\s*:/m.test(body)) bad.push(path.basename(f));
      }
      if (bad.length === 0) return { state: 'present', detail: `${files.length}/${files.length} declare applyTo` };
      return {
        state: bad.length === files.length ? 'missing' : 'partial',
        detail: `${bad.length} of ${files.length} missing applyTo: ${bad.slice(0, 3).join(', ')}`,
      };
    },
  },
  {
    id: 'docs-validator',
    bucket: 'Governance',
    label: 'A validator enforces the instruction files',
    required: true,
    why: 'Measured: two agent files declared `argumentHint:` in camelCase and were SILENTLY never loaded — no error, just skipped. Nothing validates a prompt library, so it rots in silence.',
    next: 'Port `validate-agent-docs.cjs`: applyTo presence, kebab-case frontmatter keys, no dangling citations.',
    run(ctx) {
      const hits = ctx.scripts.filter((f) => /validate-agent-docs/.test(path.basename(f)));
      if (hits.length === 0) return { state: 'missing', detail: 'no validate-agent-docs script found' };
      return { state: 'present', detail: path.relative(ctx.root, hits[0]) };
    },
  },
  {
    id: 'gate-chain',
    bucket: 'Gates',
    label: 'A prebuild gate chain exists',
    required: true,
    why: 'Checks that only run when someone remembers to run them do not run. The chain is what makes a gate a gate.',
    next: 'Add a `prebuild` script that chains the validators with `&&`.',
    run(ctx) {
      if (ctx.manifests.length === 0) {
        return { state: 'cannot-judge', detail: 'no readable package.json anywhere' };
      }
      // ⚠️ THE CHAIN IS OFTEN NOT IN THE ROOT MANIFEST. Measured in TCS: the root `package.json`
      // chains 2 gates while `nest/package.json` chains 82 — so reading only the root reported a
      // 82-gate repo as "only 2 gate(s) chained". A single-manifest reader under-reports every
      // monorepo, and under-reporting reads as a finding rather than as a limitation.
      const chains = [];
      for (const m of ctx.manifests) {
        const script = m.scripts.prebuild || m.scripts['validate:all'];
        if (!script) continue;
        const gates = script.split('&&').map((s) => s.trim()).filter(Boolean);
        chains.push({ file: m.file, gates });
      }
      if (chains.length === 0) return { state: 'missing', detail: `no prebuild in ${ctx.manifests.length} manifest(s)` };
      const total = chains.reduce((n, c) => n + c.gates.length, 0);
      const where = chains.map((c) => `${c.file}:${c.gates.length}`).join(' + ');
      if (total < 3) return { state: 'partial', detail: `only ${total} gate(s) chained (${where})` };
      return { state: 'present', detail: `${total} gate(s) chained (${where})` };
    },
  },
  {
    id: 'self-test-convention',
    bucket: 'Gates',
    label: 'Scripts can be made to fail on demand',
    required: false,
    why: 'A guard that has never been observed to fail is not a guard. Measured in TCS: 111 of 201 scripts carry --self-test.',
    next: 'Ship a `--self-test` on every new validator, and write the rule into an instruction file.',
    run(ctx) {
      if (ctx.scripts.length === 0) return { state: 'cannot-judge', detail: 'no scripts directory' };
      const validators = ctx.scripts.filter((f) => /^(validate|audit|check|verify)-/.test(path.basename(f)));
      if (validators.length === 0) return { state: 'missing', detail: 'no validate/audit/check/verify scripts' };
      let withTest = 0;
      for (const f of validators) {
        const body = readIf(f);
        if (body && body.includes('--self-test')) withTest += 1;
      }
      const pct = Math.round((withTest / validators.length) * 100);
      if (withTest === 0) return { state: 'missing', detail: `0 of ${validators.length} validator(s) have --self-test` };
      return {
        state: pct >= 50 ? 'present' : 'partial',
        detail: `${withTest} of ${validators.length} validator(s) (${pct}%)`,
      };
    },
  },
  {
    id: 'repo-hygiene',
    bucket: 'Gates',
    label: 'A repo-hygiene guard exists',
    required: true,
    why: 'Measured: 14 tracked scratch files at a package root in a PUBLIC repo, including a 151 KB canary backup from a canary that never restored.',
    next: 'Port `validate-repo-hygiene.cjs`: package-root contents, no compiled output beside source, no scratch, no literal credential.',
    run(ctx) {
      const hit = ctx.scripts.find((f) => /validate-repo-hygiene/.test(path.basename(f)));
      if (!hit) return { state: 'missing', detail: 'no validate-repo-hygiene script' };
      return { state: 'present', detail: path.relative(ctx.root, hit) };
    },
  },
  {
    id: 'frontend-css-gates',
    bucket: 'Gates',
    label: 'Stylesheets are validated AND proven reachable',
    required: false,
    why: 'Measured: 20 stylesheets silently dropped by every browser for a month because cssMinify was off, and 3 registered pages rendered with no stylesheet at all.',
    next: 'Port `validate-css-parses.cjs` (production minifier) and `validate-css-imports.cjs` (follows @import).',
    run(ctx) {
      const hasSrc = isDir(path.join(ctx.root, 'src'));
      if (!hasSrc) return { state: 'cannot-judge', detail: 'no src/ — not a frontend project' };
      const parses = ctx.scripts.some((f) => /validate-css-parses/.test(path.basename(f)));
      const imports = ctx.scripts.some((f) => /validate-css-imports/.test(path.basename(f)));
      if (parses && imports) return { state: 'present', detail: 'parse + reachability both present' };
      if (parses || imports) return { state: 'partial', detail: `only ${parses ? 'parse' : 'reachability'} present` };
      return { state: 'missing', detail: 'neither CSS gate present' };
    },
  },
  {
    id: 'bundle-budget',
    bucket: 'Gates',
    label: 'A bundle budget guard exists',
    required: false,
    why: 'Measured: TCS had a bundle check that FAILED ON EVERY RUN for seven weeks, so everyone learned to ignore it and size was unguarded throughout.',
    next: 'Port `check-bundle-budget.mjs`, wired as `postbuild`, with three exit codes.',
    run(ctx) {
      const hit = ctx.scripts.find((f) => /check-bundle-budget/.test(path.basename(f)));
      if (!hit) return { state: 'missing', detail: 'no check-bundle-budget script' };
      const body = readIf(hit);
      if (body === null) return { state: 'cannot-judge', detail: 'could not read the bundle guard' };
      const hasThreeCodes = /cannot judge/i.test(body) || /exit\(2\)/.test(body) || /process\.exit\(2\)/.test(body);
      const wired = /check-bundle-budget/.test(ctx.pkgScripts.postbuild || '') || /check-bundle-budget/.test(ctx.pkgScripts.build || '');
      if (!wired) return { state: 'partial', detail: 'present but not wired into postbuild' };
      if (!hasThreeCodes) return { state: 'partial', detail: 'wired, but no CANNOT JUDGE exit code' };
      return { state: 'present', detail: 'wired, three exit codes' };
    },
  },
  {
    id: 'decision-register',
    bucket: 'Decisions',
    label: 'A settled-decisions register exists',
    required: true,
    why: 'Without it, settled decisions get re-opened by accident — measured as the single most expensive thing that happens in a maintained codebase.',
    next: 'Create docs/SETTLED-DECISIONS.md with numbered rows and a guard-status column.',
    run(ctx) {
      const f = path.join(ctx.root, 'docs', 'SETTLED-DECISIONS.md');
      const body = readIf(f);
      if (body === null) return { state: 'missing', detail: 'no readable docs/SETTLED-DECISIONS.md' };
      const rows = (body.match(/^\|\s*\d+\s*\|/gm) || []).length;
      if (rows === 0) return { state: 'missing', detail: 'file exists but has no numbered rows' };
      const hasGuard = /guard status|🟢|🟡|🔴/i.test(body);
      if (!hasGuard) return { state: 'partial', detail: `${rows} rows, no guard-status column` };
      return { state: 'present', detail: `${rows} numbered row(s) with guard status` };
    },
  },
  {
    id: 'decision-markers',
    bucket: 'Decisions',
    label: 'Decisions are recorded at the code site',
    required: false,
    why: 'A register row nobody opens while editing the file is not where the decision is needed. Three homes or it is not recorded.',
    next: 'Use a DECISION marker docblock: WHAT / WHY / INSTEAD OF / REVERSE BY / REGISTER / GUARD.',
    run(ctx) {
      const srcDirs = ['src', 'nest', 'server', 'lib', 'app'].map((d) => path.join(ctx.root, d)).filter(isDir);
      if (srcDirs.length === 0) return { state: 'cannot-judge', detail: 'no source directory' };
      const files = srcDirs.flatMap((d) => walk(d, ['.ts', '.tsx', '.js', '.jsx']));
      if (files.length === 0) return { state: 'cannot-judge', detail: 'no source files' };
      const n = countMatches(files, /DECISION \(20\d\d-\d\d-\d\d/g);
      if (n === 0) return { state: 'missing', detail: '0 DECISION markers in source' };
      return { state: n >= 3 ? 'present' : 'partial', detail: `${n} DECISION marker(s)` };
    },
  },
  {
    id: 'tool-index',
    bucket: 'Tooling',
    label: 'The tool library is searchable by PURPOSE',
    required: false,
    why: 'Measured: 232 tools with 64 orphans, and three separate proposals in one session were to build something already in the list.',
    next: 'Port `tools-index.cjs` with `--find` searching purpose text, `--run`, `--orphans`, `--check`.',
    run(ctx) {
      const hit = ctx.scripts.find((f) => /tools-index/.test(path.basename(f)));
      if (!hit) return { state: ctx.scripts.length < 5 ? 'cannot-judge' : 'missing', detail: hit ? '' : 'no tools-index script' };
      const body = readIf(hit);
      if (body === null) return { state: 'cannot-judge', detail: 'could not read the tool index' };
      if (!body.includes('--find')) return { state: 'partial', detail: 'present but has no --find' };
      return { state: 'present', detail: 'has --find' };
    },
  },
  {
    id: 'review-queue',
    bucket: 'Tooling',
    label: 'One shared list of what needs the human',
    required: false,
    why: 'Otherwise a human must read every handoff and session note to find the few things waiting on them, so they read none of them.',
    next: 'Create .github/REVIEW-QUEUE.md — one row per decision that only the owner can make.',
    run(ctx) {
      const candidates = [
        path.join(ctx.root, '.github', 'REVIEW-QUEUE.md'),
        path.join(ctx.root, 'docs', 'REVIEW-QUEUE.md'),
      ];
      const found = candidates.find((f) => readIf(f) !== null);
      if (!found) return { state: 'missing', detail: 'no REVIEW-QUEUE.md' };
      const rows = (readIf(found).match(/^\|\s*\*\*R\d+\*\*/gm) || []).length;
      return { state: rows > 0 ? 'present' : 'partial', detail: `${rows} open row(s)` };
    },
  },
  {
    id: 'scratch-ignored',
    bucket: 'Layout',
    label: 'Scratch and logs are gitignored',
    required: true,
    why: 'Measured: logs/ held 576 files and 435 were TRACKED in a public repo, one containing a note the owner did not want published.',
    next: 'Add logs/, *.bak, tmp-* and session output to .gitignore.',
    run(ctx) {
      const body = readIf(path.join(ctx.root, '.gitignore'));
      if (body === null) return { state: 'missing', detail: 'no .gitignore' };
      const hasLogs = /^\s*logs?\/?\s*$/m.test(body);
      const hasBak = /\.bak|\*\.bak/i.test(body);
      if (hasLogs && hasBak) return { state: 'present', detail: 'logs and scratch ignored' };
      return { state: 'partial', detail: `logs:${hasLogs ? 'yes' : 'no'} bak:${hasBak ? 'yes' : 'no'}` };
    },
  },
  {
    id: 'release-stage',
    bucket: 'Layout',
    label: 'The release stage is declared, not typed',
    required: false,
    why: 'Measured: four public pages said "alpha" by hand while the code moved on; nothing read the real stage, so the pages drifted silently.',
    next: 'Add `"releaseStage": "alpha"` to package.json and read it wherever the stage is shown.',
    run(ctx) {
      if (Object.keys(ctx.pkgScripts).length === 0) return { state: 'cannot-judge', detail: 'no readable package.json' };
      const stage = ctx.pkgJson && ctx.pkgJson.releaseStage;
      if (!stage) return { state: 'missing', detail: 'no releaseStage in package.json' };
      return { state: 'present', detail: `releaseStage: ${stage}` };
    },
  },
  {
    id: 'licence',
    bucket: 'Layout',
    label: 'A licence is present',
    required: true,
    why: 'A public repo with no licence is "all rights reserved" by default, which contradicts any open-source claim.',
    next: 'Owner decision, and the ONLY gap no scaffold will fill: choose a licence and add the file. AGPL-3.0 keeps a fork open; MIT/BSD permit a closed fork. Do not let an agent pick one.',
    /** No scaffold exists on purpose — this is the one required item that must be a human act. */
    humanDecision: true,
    run(ctx) {
      const names = ['LICENSE', 'LICENCE', 'LICENSE.md', 'LICENCE.md', 'COPYING'];
      const found = names.find((n) => readIf(path.join(ctx.root, n)) !== null);
      if (!found) return { state: 'missing', detail: 'no licence file' };
      return { state: 'present', detail: found };
    },
  },
  {
    id: 'accessibility-policy',
    bucket: 'Layout',
    label: 'An accessibility policy is written down',
    required: false,
    why: 'Contrast, focus states and tap targets are decided once, or re-decided wrongly on every new component.',
    next: 'Add an accessibility instruction: WCAG 2.2 AA, 44px tap targets, reduced-motion respected.',
    run(ctx) {
      if (!isDir(path.join(ctx.root, 'src'))) return { state: 'cannot-judge', detail: 'no src/ — not a frontend project' };
      const dir = path.join(ctx.root, '.github', 'instructions');
      if (!isDir(dir)) return { state: 'missing', detail: 'no instruction directory' };
      const hit = walk(dir, ['.md']).find((f) => /accessib/i.test(path.basename(f)));
      if (hit) return { state: 'present', detail: path.basename(hit) };
      const anyMentions = walk(dir, ['.md']).some((f) => /WCAG/i.test(readIf(f) || ''));
      return { state: anyMentions ? 'partial' : 'missing', detail: anyMentions ? 'mentioned, no dedicated policy' : 'not present' };
    },
  },
];

// ── the scaffolds ──────────────────────────────────────────────────────────────
//
// `--scaffold` turns the audit from a report into a working tree. Four rules govern every template:
//
//   1. **DRY RUN BY DEFAULT.** `--scaffold` prints what it WOULD write; `--scaffold --apply` writes.
//      A tool that edits a tree on first invocation is a tool nobody runs twice.
//   2. **NEVER OVERWRITE.** An existing path is skipped and reported. The one exception is
//      `package.json`, where a SINGLE missing script key may be added — never a modified one.
//   3. **NO HOLLOW FILES.** A scaffolded `.gitignore` carries real patterns, not a comment saying
//      "add your ignores here". Empty boilerplate reads as done and is not.
//   4. **EVERY TEMPLATE CARRIES ITS DOCTRINE.** The header says which measured defect the file
//      prevents, because a rule with no reason gets deleted by the next reader.
//
// ⚠️ Deliberately NOT scaffolded: `LICENSE` (a licence choice is the owner's, not a template's),
// `README` (project-specific), and any trading/business rule. Inventing those would be a guess
// wearing a file's clothes.

// The file bodies live in a separate module — see its header for why (code-health size rule).
const { TEMPLATES } = require('./lib/scaffold-templates.cjs');

/** Substitute the date placeholder in a template. Kept separate so a template stays readable. */
function fillTemplate(body, today) {
  return body.split('\${DATE}').join(today);
}

/**
 * The scaffold actions, in the order they should be applied.
 *
 * `target` is relative to the project root. `covers` names the CHECKS ids the file improves — so the
 * audit AFTER a scaffold can be compared to the one before it, which is the only evidence that the
 * scaffold did anything.
 */
const SCAFFOLDS = [
  {
    id: 'gitignore',
    target: '.gitignore',
    covers: ['scratch-ignored'],
    title: 'Create .gitignore with logs, scratch, secrets and build output',
    why: 'Measured: a logs/ folder held 576 files and 435 were TRACKED in a public repo.',
  },
  {
    id: 'readme',
    target: 'README.md',
    covers: ['scratch-ignored'],
    title: 'Create README.md with a real quick start',
    why: 'The scaffolded gate requires it, and a README still saying "Project name" reads as abandoned.',
  },
  {
    id: 'copilot-instructions',
    target: '.github/copilot-instructions.md',
    covers: ['instructions-exist', 'published-rules'],
    title: 'Create .github/copilot-instructions.md — the published contributor rules',
    why: 'Without it every session re-derives the conventions, and each agent invents a different set.',
  },
  {
    id: 'decision-register',
    target: 'docs/SETTLED-DECISIONS.md',
    covers: ['decision-register'],
    title: 'Create docs/SETTLED-DECISIONS.md — numbered rows with a guard-status column',
    why: 'An unrecorded decision is re-opened by accident, which is the most expensive recurring cost in a maintained codebase.',
  },
  {
    id: 'review-queue',
    target: '.github/REVIEW-QUEUE.md',
    covers: ['review-queue'],
    title: 'Create .github/REVIEW-QUEUE.md — one list of what needs the human',
    why: 'Otherwise a human must read every note to find the few things waiting on them, so they read none of them.',
  },
  {
    id: 'self-test-lib',
    target: 'scripts/lib/self-test.cjs',
    covers: ['self-test-convention'],
    title: 'Create scripts/lib/self-test.cjs — the shared assertion harness',
    why: 'Every guard is expected to prove it fails; one harness stops each script hand-rolling its own loop.',
  },
  {
    id: 'validate-required-files',
    target: 'scripts/validate-required-files.cjs',
    covers: ['gate-chain', 'self-test-convention', 'repo-hygiene'],
    title: 'Create scripts/validate-required-files.cjs — a real first gate, with --self-test',
    why: 'A check nobody runs is not a check, and this one is the smallest gate that is genuinely useful on day one.',
  },
  {
    id: 'validate-repo-hygiene',
    target: 'scripts/validate-repo-hygiene.cjs',
    covers: ['repo-hygiene', 'self-test-convention'],
    title: 'Create scripts/validate-repo-hygiene.cjs — package root, compiled output, scratch, credentials',
    why: 'Measured: 14 tracked scratch files at a package root in a PUBLIC repo, including a 151 KB backup from a canary that never restored.',
  },
  {
    id: 'validate-agent-docs',
    target: 'scripts/validate-agent-docs.cjs',
    covers: ['docs-validator', 'self-test-convention'],
    title: 'Create scripts/validate-agent-docs.cjs — prove the instruction files can actually load',
    why: 'Measured: two agent files declared a camelCase frontmatter key and were SILENTLY never loaded — no error, just skipped.',
  },
];

/**
 * The prebuild chain a scaffold installs. Only ever composed of gates that exist.
 *
 * ⚠️ Every gate runs `--self-test` FIRST, then itself. A gate whose self-test has never been run is a
 * decoration, and putting the self-test IN the chain is what keeps that true without anyone having to
 * remember. The order also means a broken self-test reports before the real check runs.
 */
function scaffoldPrebuild(available) {
  const gates = [];
  for (const id of ['validate-required-files', 'validate-repo-hygiene', 'validate-agent-docs']) {
    if (!available.has(id)) continue;
    const file = `scripts/${id}.cjs`;
    gates.push(`node ${file} --self-test`);
    gates.push(`node ${file}`);
  }
  return gates.join(' && ');
}

/**
 * Compute what a scaffold WOULD do. Pure — writes nothing. Returns a list of planned actions so the
 * dry run and the apply render from the same source, and so a test can assert on the plan.
 */
function planScaffold(rootArg) {
  const root = path.resolve(rootArg || process.cwd());
  if (!isDir(root)) return { root, fatal: `not a readable directory: ${root}`, actions: [] };

  const today = new Date().toISOString().slice(0, 10);
  const actions = [];

  for (const s of SCAFFOLDS) {
    const full = path.join(root, s.target);
    const body = TEMPLATES[templateKeyFor(s.id)];
    if (body === undefined) {
      actions.push({ ...s, kind: 'error', detail: `no template for "${s.id}" — internal defect` });
      continue;
    }
    if (readIf(full) !== null) {
      actions.push({ ...s, kind: 'skip', detail: 'already exists — never overwritten' });
      continue;
    }
    actions.push({ ...s, kind: 'create', full, content: fillTemplate(body, today) });
  }

  // package.json: add a `prebuild` script only when the chain would contain real gates.
  const pkgPath = path.join(root, 'package.json');
  const pkgRaw = readIf(pkgPath);
  if (pkgRaw === null) {
    actions.push({
      id: 'prebuild',
      target: 'package.json',
      covers: ['gate-chain'],
      title: 'Wire a `prebuild` gate chain',
      why: 'A check nobody runs is not a check.',
      kind: 'skip',
      detail: 'no package.json — create one first, then re-run --scaffold',
    });
  } else {
    let pkg = null;
    try {
      pkg = JSON.parse(pkgRaw);
    } catch {
      pkg = null;
    }
    if (!pkg) {
      actions.push({
        id: 'prebuild',
        target: 'package.json',
        covers: ['gate-chain'],
        title: 'Wire a `prebuild` gate chain',
        why: 'A check nobody runs is not a check.',
        kind: 'skip',
        detail: 'package.json does not parse — fixing it is a human decision, not a scaffold',
      });
    } else {
      const scripts = pkg.scripts || {};
      // ⚠️ The plan must describe the tree AFTER scaffolding, not the tree as it is now. An earlier
      // version required `scripts/` to already exist on disk, so the FIRST run skipped `prebuild`
      // and the SECOND added it — the plan was not idempotent, and my own self-test caught it.
      // A gate counts as available when it is on disk OR the scaffold is about to write it.
      const available = new Set(
        SCAFFOLDS.filter(
          (s) =>
            s.target.startsWith('scripts/') &&
            (readIf(path.join(root, s.target)) !== null || s.id.startsWith('validate-')),
        ).map((s) => s.id),
      );
      const chain = scaffoldPrebuild(available);

      if (scripts.prebuild) {
        actions.push({
          id: 'prebuild',
          target: 'package.json',
          covers: ['gate-chain'],
          title: 'Wire a `prebuild` gate chain',
          why: 'A check nobody runs is not a check.',
          kind: 'skip',
          detail: 'a prebuild script already exists — never overwritten',
        });
      } else if (!chain) {
        actions.push({
          id: 'prebuild',
          target: 'package.json',
          covers: ['gate-chain'],
          title: 'Wire a `prebuild` gate chain',
          why: 'A check nobody runs is not a check.',
          kind: 'skip',
          detail: 'no validators exist to chain yet',
        });
      } else {
        actions.push({
          id: 'prebuild',
          target: 'package.json',
          covers: ['gate-chain'],
          title: 'Add a `prebuild` script chaining the new gates',
          why: 'A check nobody runs is not a check.',
          kind: 'json-key',
          full: pkgPath,
          pkg,
          key: 'prebuild',
          value: chain,
        });
      }
    }
  }

  return { root, fatal: null, actions };
}

/** Map a scaffold id to its TEMPLATES key. Explicit, so a rename cannot silently lose a template. */
function templateKeyFor(id) {
  const map = {
    gitignore: 'gitignore',
    readme: 'readme',
    'copilot-instructions': 'copilotInstructions',
    'decision-register': 'decisions',
    'review-queue': 'reviewQueue',
    'self-test-lib': 'selfTestLib',
    'validate-required-files': 'validateRequiredFiles',
    'validate-repo-hygiene': 'validateRepoHygiene',
    'validate-agent-docs': 'validateAgentDocs',
  };
  return map[id];
}

/**
 * Apply a plan. Every write is reported with its size, and a write that fails is an ERROR for that
 * action — never a silent skip, because "nothing appeared" and "it was already there" must not look
 * the same.
 */
function applyScaffold(plan) {
  const results = [];
  for (const a of plan.actions) {
    if (a.kind === 'skip') {
      results.push({ ...a, outcome: 'skipped' });
      continue;
    }
    if (a.kind === 'error') {
      results.push({ ...a, outcome: 'error' });
      continue;
    }
    try {
      if (a.kind === 'create') {
        fs.mkdirSync(path.dirname(a.full), { recursive: true });
        // Re-check immediately before writing. A file that appeared since the plan was computed
        // must not be clobbered — the window is small, but the cost of being wrong is a lost file.
        if (fs.existsSync(a.full)) {
          results.push({ ...a, outcome: 'skipped-race', detail: 'appeared between plan and write' });
          continue;
        }
        fs.writeFileSync(a.full, a.content);
        results.push({ ...a, outcome: 'created', bytes: Buffer.byteLength(a.content) });
      } else if (a.kind === 'json-key') {
        const next = { ...a.pkg, scripts: { ...a.pkg.scripts, [a.key]: a.value } };
        fs.writeFileSync(a.full, JSON.stringify(next, null, 2) + '\n');
        results.push({ ...a, outcome: 'created', bytes: a.value.length });
      } else {
        results.push({ ...a, outcome: 'error', detail: `unknown kind "${a.kind}"` });
      }
    } catch (err) {
      results.push({ ...a, outcome: 'error', detail: err.message });
    }
  }
  return results;
}

/** Render a plan or an applied set of results. One shape, so dry run and real run read the same. */
function renderScaffold(root, results, applied) {
  // ⚠️ Normalise the two vocabularies first. A PLAN carries `kind` (create / json-key / skip / error)
  // while an APPLIED set carries `outcome` (created / skipped / error). Rendering a plan through the
  // applied branch printed "❌ failed" for every file in a perfect plan — the plan was right and the
  // report lied, which is worse than either. Caught by running the demo, not by the self-test.
  const norm = results.map((r) => {
    if (r.outcome && r.outcome !== r.kind) return r;
    const map = { create: 'would-create', 'json-key': 'would-create', skip: 'skipped', error: 'error' };
    return { ...r, outcome: map[r.kind] || r.outcome || 'error' };
  });

  const toCreate = norm.filter((r) => r.outcome === 'created' || r.outcome === 'would-create');
  const skipped = norm.filter((r) => r.outcome === 'skipped' || r.outcome === 'skipped-race');
  const errors = norm.filter((r) => r.outcome === 'error');

  console.log(`\n[scaffold] ${root}`);
  console.log(
    `[scaffold] ${applied ? 'APPLIED' : 'DRY RUN — nothing has been written'} · ` +
      `${toCreate.length} ${applied ? 'created' : 'to create'} · ${skipped.length} skipped · ${errors.length} error(s)\n`,
  );

  for (const r of norm) {
    if (r.outcome === 'created') {
      console.log(`  ➕ ${r.target}${r.bytes ? ` (${r.bytes} bytes)` : ''}`);
      console.log(`     ${r.title}`);
    } else if (r.outcome === 'would-create') {
      console.log(`  ➕ ${r.target} — would create`);
      console.log(`     ${r.title}`);
    } else if (r.outcome === 'skipped' || r.outcome === 'skipped-race') {
      console.log(`  ⏭  ${r.target} — ${r.detail}`);
    } else {
      console.log(`  ❌ ${r.target} — ${r.detail || 'failed'}`);
    }
  }

  if (errors.length) {
    console.log('\n[scaffold] ❌ at least one action failed. Nothing was rolled back — read the error above.');
  } else if (!applied && toCreate.length) {
    console.log('\n[scaffold] Re-run with --apply to write these files.');
  } else if (applied && toCreate.length) {
    console.log('\n[scaffold] Now re-run the audit: node scripts/audit-project-readiness.cjs --path .');
    console.log('[scaffold] The before/after counts are the evidence that this did anything.');
  } else if (applied) {
    console.log('\n[scaffold] Nothing to do — every scaffolded file is already present.');
  }

  void skipped;
}

// ── the audit ──────────────────────────────────────────────────────────────────

function audit(rootArg) {
  const root = path.resolve(rootArg || process.cwd());
  if (!isDir(root)) {
    return { root, results: [], fatal: `not a readable directory: ${root}` };
  }

  /**
   * ⚠️ EVERY manifest, not just the root one. A monorepo keeps its gate chain in the backend or a
   * workspace package; reading only the root silently under-reports the project (measured: TCS root
   * chains 2 gates, `nest/package.json` chains 82).
   */
  const manifestPaths = [path.join(root, 'package.json')];
  for (const sub of ['nest', 'server', 'api', 'backend', 'app', 'frontend']) {
    manifestPaths.push(path.join(root, sub, 'package.json'));
  }
  const packagesDir = path.join(root, 'packages');
  if (isDir(packagesDir)) {
    let entries = [];
    try {
      entries = fs.readdirSync(packagesDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (e.isDirectory()) manifestPaths.push(path.join(packagesDir, e.name, 'package.json'));
    }
  }

  const manifests = [];
  let pkgJson = null;
  let pkgSource = null;
  for (const file of manifestPaths) {
    const raw = readIf(file);
    if (raw === null) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const rel = path.relative(root, file).split(path.sep).join('/');
    manifests.push({ file: rel, scripts: parsed.scripts || {}, json: parsed });
    // The ROOT manifest is the project manifest; keep it separate for `releaseStage` and friends.
    if (rel === 'package.json') {
      pkgJson = parsed;
      pkgSource = rel;
    }
  }
  // With no root manifest, fall back to the first manifest found so `releaseStage` can still be read.
  if (!pkgJson && manifests.length) {
    pkgJson = manifests[0].json;
    pkgSource = manifests[0].file;
  }

  const scriptsDir = [path.join(root, 'scripts'), path.join(root, 'nest', 'scripts')];
  const scripts = scriptsDir.filter(isDir).flatMap((d) => walk(d, ['.cjs', '.mjs', '.js']));

  const ctx = {
    root,
    scripts,
    manifests,
    pkgJson,
    pkgSource,
    pkgScripts: (pkgJson && pkgJson.scripts) || {},
  };

  const results = CHECKS.map((c) => {
    let r;
    try {
      r = c.run(ctx);
    } catch (err) {
      // A check that throws has not judged anything. Saying "missing" would be a fabricated answer.
      r = { state: 'cannot-judge', detail: `check threw: ${err.message}` };
    }
    return { id: c.id, bucket: c.bucket, label: c.label, required: c.required, why: c.why, next: c.next, humanDecision: c.humanDecision === true, ...r };
  });

  return { root, results, fatal: null, manifests: manifests.map((m) => m.file) };
}

function summarise(results) {
  const count = (s) => results.filter((r) => r.state === s).length;
  return {
    total: results.length,
    present: count('present'),
    partial: count('partial'),
    missing: count('missing'),
    cannotJudge: count('cannot-judge'),
    requiredMissing: results.filter((r) => r.required && (r.state === 'missing' || r.state === 'partial')).length,
  };
}

function render(auditResult) {
  const { root, results, fatal } = auditResult;
  if (fatal) {
    console.error(`[readiness] CANNOT JUDGE — ${fatal}`);
    console.error('[readiness] Reporting exit 2. A path that cannot be read is not a project with nothing in it.');
    return;
  }
  const s = summarise(results);
  console.log(`\n[readiness] ${root}`);
  console.log(
    `[readiness] ${s.present} present · ${s.partial} partial · ${s.missing} missing · ${s.cannotJudge} cannot judge · ` +
      `of ${s.total} checks\n`,
  );

  const ICON = { present: '✅', partial: '🟨', missing: '❌', 'cannot-judge': '⚠️ ' };
  let bucket = null;
  for (const r of results) {
    if (r.bucket !== bucket) {
      bucket = r.bucket;
      console.log(`  ── ${bucket} ──`);
    }
    const req = r.required ? '' : ' (optional)';
    console.log(`  ${ICON[r.state]} ${r.label}${req} — ${r.detail}`);
  }

  const actionable = results.filter((r) => r.state === 'missing' || r.state === 'partial');
  if (actionable.length) {
    console.log('\n  ── NEXT ACTIONS, required first ──');
    const ordered = [...actionable].sort((a, b) => Number(b.required) - Number(a.required));
    for (const r of ordered) {
      // A human-decision item is marked, because an agent that treats it like the others will either
      // pick a licence on the owner's behalf or silently skip it. Both are wrong.
      const mark = r.humanDecision ? '🧑' : r.required ? '🛑' : '👉';
      console.log(`  ${mark} ${r.label}${r.humanDecision ? ' — YOUR DECISION, not an agent\'s' : ''}`);
      console.log(`     why it matters: ${r.why}`);
      console.log(`     do this:        ${r.next}`);
    }
  }

  const unjudged = results.filter((r) => r.state === 'cannot-judge');
  if (unjudged.length) {
    console.log(`\n  ⚠️  ${unjudged.length} check(s) COULD NOT BE JUDGED — these are not "fine":`);
    for (const r of unjudged) console.log(`     ${r.label}: ${r.detail}`);
  }

  console.log(
    s.requiredMissing === 0
      ? '\n[readiness] ✅ nothing required is missing.'
      : `\n[readiness] ❌ ${s.requiredMissing} required item(s) missing or partial. That is expected for a new project — work the list above.`,
  );
}

// ── self-test ──────────────────────────────────────────────────────────────────

function selfTest() {
  const { runCases } = (() => {
    try {
      return require('./lib/self-test.cjs');
    } catch {
      return { runCases: null };
    }
  })();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-'));
  const cases = [];

  /** Build a fixture project and return its root. */
  function fixture(name, build) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    build(dir);
    return dir;
  }
  const write = (dir, rel, body) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };

  // 1. An EMPTY project must report required items missing, not silent success.
  {
    const dir = fixture('empty', () => {});
    const a = audit(dir);
    const s = summarise(a.results);
    cases.push({
      name: 'an empty directory reports required items MISSING',
      pass: s.requiredMissing > 0 && s.present === 0,
      detail: `requiredMissing=${s.requiredMissing} present=${s.present}`,
    });
  }

  // 2. A COMPLETE project must report nothing required missing.
  {
    const dir = fixture('complete', (d) => {
      write(d, 'LICENSE', 'AGPL');
      write(d, '.gitignore', 'logs/\n*.bak\n');
      write(d, 'package.json', JSON.stringify({
        releaseStage: 'alpha',
        scripts: { prebuild: 'node scripts/validate-a.cjs --self-test && node scripts/validate-repo-hygiene.cjs && node scripts/validate-agent-docs.cjs' },
      }));
      write(d, '.github/instructions/philosophy.instructions.md', '---\napplyTo: "**"\n---\n# P\n');
      write(d, '.github/instructions/accessibility.instructions.md', '---\napplyTo: "src/**"\n---\n# A\nWCAG 2.2 AA\n');
      write(d, '.github/REVIEW-QUEUE.md', '| **R1** | x |\n');
      write(d, 'docs/SETTLED-DECISIONS.md', '| # | Decision | Guard status |\n|---|---|---|\n| 1 | a | 🟢 |\n| 2 | b | 🔴 |\n');
      /**
       * ⚠️ THE MARKER IS ASSEMBLED, NOT WRITTEN LITERALLY. `validate-decisions.cjs` scans
       * `src/`, `nest/src/` AND `scripts/` for `DECISION (YYYY-MM-DD, agent)` markers and requires
       * WHAT/WHY/REVERSE BY under each. This fixture deliberately writes three bare markers to a TEMP
       * directory, so as a literal string it made the decisions validator fail on THIS FILE — a
       * validator tripping over another validator's test data. Measured 2026-11-17: three violations,
       * all pointing at this line.
       *
       * The bytes written at runtime are unchanged, so the self-test still exercises what it was
       * built to exercise; only the SOURCE no longer contains a scannable marker.
       */
      write(d, 'src/a.js', `${'// DECI'}SION (2026-01-01, x)\n${'// DECI'}SION (2026-01-02, y)\n${'// DECI'}SION (2026-01-03, z)\n`);
      write(d, 'scripts/validate-repo-hygiene.cjs', '// --self-test\n');
      write(d, 'scripts/validate-agent-docs.cjs', '// --self-test\n');
      write(d, 'scripts/validate-a.cjs', '// --self-test\n');
      write(d, 'scripts/tools-index.cjs', '// --find\n');
      write(d, 'scripts/validate-css-parses.cjs', '// --self-test\n');
      write(d, 'scripts/validate-css-imports.cjs', '// --self-test\n');
      write(d, 'scripts/check-bundle-budget.mjs', "// CANNOT JUDGE\nprocess.exit(2)\n");
      write(d, 'package.json', JSON.stringify({
        releaseStage: 'alpha',
        scripts: {
          prebuild: 'node scripts/validate-a.cjs --self-test && node scripts/validate-repo-hygiene.cjs && node scripts/validate-agent-docs.cjs',
          postbuild: 'node scripts/check-bundle-budget.mjs',
        },
      }));
    });
    const a = audit(dir);
    const s = summarise(a.results);
    cases.push({
      name: 'a complete project reports NOTHING required missing',
      pass: s.requiredMissing === 0,
      detail: `requiredMissing=${s.requiredMissing} missing=${s.missing} partial=${s.partial}`,
    });
  }

  // 3. An instruction file with no applyTo must be caught — this is the camelCase-key cousin.
  {
    const dir = fixture('no-applyto', (d) => {
      write(d, '.github/instructions/x.instructions.md', '# no frontmatter at all\n');
    });
    const a = audit(dir);
    const r = a.results.find((x) => x.id === 'instructions-have-applyTo');
    cases.push({
      name: 'an instruction with no applyTo is reported missing',
      pass: r.state === 'missing',
      detail: `state=${r.state}`,
    });
  }

  // 4. A number that cannot be read must be cannot-judge, never missing.
  {
    const dir = fixture('no-pkg', (d) => {
      write(d, 'src/a.js', 'x\n');
    });
    const a = audit(dir);
    const r = a.results.find((x) => x.id === 'gate-chain');
    cases.push({
      name: 'with no readable package.json the gate chain is CANNOT JUDGE, not missing',
      pass: r.state === 'cannot-judge',
      detail: `state=${r.state}`,
    });
  }

  // 5. An unreadable ROOT must be a fatal cannot-judge (exit 2), not an empty pass.
  {
    const a = audit(path.join(tmp, 'does-not-exist'));
    cases.push({
      name: 'an unreadable root is FATAL, exit 2',
      pass: Boolean(a.fatal) && a.results.length === 0,
      detail: a.fatal ? 'fatal set' : 'no fatal reported',
    });
  }

  // 6. A bundle guard that is not wired must be PARTIAL, not present.
  {
    const dir = fixture('bundle-unwired', (d) => {
      write(d, 'src/a.jsx', 'x\n');
      write(d, 'scripts/check-bundle-budget.mjs', '// CANNOT JUDGE\n');
      write(d, 'package.json', JSON.stringify({ scripts: {} }));
    });
    const a = audit(dir);
    const r = a.results.find((x) => x.id === 'bundle-budget');
    cases.push({
      name: 'a bundle guard that is not wired is PARTIAL',
      pass: r.state === 'partial' && /not wired/.test(r.detail),
      detail: `state=${r.state} detail=${r.detail}`,
    });
  }

  // 7. A decision register with no guard column must be PARTIAL.
  {
    const dir = fixture('register-noguard', (d) => {
      write(d, 'docs/SETTLED-DECISIONS.md', '| # | Decision |\n|---|---|\n| 1 | a |\n');
    });
    const a = audit(dir);
    const r = a.results.find((x) => x.id === 'decision-register');
    cases.push({
      name: 'a register with no guard-status column is PARTIAL',
      pass: r.state === 'partial',
      detail: `state=${r.state} detail=${r.detail}`,
    });
  }

  // 8. A check that throws must become cannot-judge, never missing.
  {
    const dir = fixture('throw', () => {});
    const original = CHECKS[0].run;
    CHECKS[0].run = () => {
      throw new Error('boom');
    };
    const a = audit(dir);
    CHECKS[0].run = original;
    const r = a.results.find((x) => x.id === 'instructions-exist');
    cases.push({
      name: 'a check that throws becomes CANNOT JUDGE, never missing',
      pass: r.state === 'cannot-judge' && /boom/.test(r.detail),
      detail: `state=${r.state}`,
    });
  }

  // 9. The count of CHECKS is non-zero — a suite that inspects nothing must not pass.
  cases.push({
    name: 'the check list is not empty (an audit that inspects nothing cannot pass)',
    pass: CHECKS.length >= 10,
    detail: `${CHECKS.length} checks`,
  });

  // 10. Every check declares a `why` and a `next` — an unattributable check gets deleted.
  cases.push({
    name: 'every check carries a measured why and a next action',
    pass: CHECKS.every((c) => typeof c.why === 'string' && c.why.length > 20 && typeof c.next === 'string' && c.next.length > 10),
    detail: CHECKS.filter((c) => !c.why || c.why.length <= 20).map((c) => c.id).join(',') || 'all attributed',
  });

  // ── the scaffolder, canaried in both directions ─────────────────────────────
  //
  // ⚠️ The most valuable case is #6: scaffold, then RE-AUDIT and require the score to improve. A
  // scaffolder that writes plausible files and moves no check is the exact "declaration not
  // validated by being well-formed" defect — the files exist, the practice does not.

  const scaffoldFixture = () => {
    const dir = path.join(tmp, 'scaffold-me-' + Math.random().toString(36).slice(2, 8));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', version: '0.1.0' }, null, 2) + '\n',
    );
    return dir;
  };

  // 1. a DRY RUN writes nothing
  {
    const dir = scaffoldFixture();
    const plan = planScaffold(dir);
    const createCount = plan.actions.filter((a) => a.kind === 'create').length;
    const gitignoreExists = fs.existsSync(path.join(dir, '.gitignore'));
    cases.push({
      name: 'a dry-run plan lists files to create and writes NOTHING',
      pass: createCount >= 5 && !gitignoreExists,
      detail: `createCount=${createCount} gitignoreWritten=${gitignoreExists}`,
    });
  }

  // 2. --apply actually creates them
  {
    const dir = scaffoldFixture();
    const results = applyScaffold(planScaffold(dir));
    const created = results.filter((r) => r.outcome === 'created');
    const allExist = created.every((r) => fs.existsSync(path.join(dir, r.target)));
    cases.push({
      name: 'apply creates every planned file on disk',
      pass: created.length >= 5 && allExist,
      detail: `created=${created.length} allExist=${allExist}`,
    });
  }

  // 3. the scaffold is IDEMPOTENT — a second apply creates nothing
  {
    const dir = scaffoldFixture();
    applyScaffold(planScaffold(dir));
    const second = applyScaffold(planScaffold(dir));
    const createdAgain = second.filter((r) => r.outcome === 'created');
    cases.push({
      name: 'a second apply creates NOTHING (idempotent)',
      pass: createdAgain.length === 0,
      detail: `created again: ${createdAgain.map((r) => r.target).join(', ')}`,
    });
  }

  // 4. an existing file is NEVER overwritten
  {
    const dir = scaffoldFixture();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'MY OWN RULES\n');
    applyScaffold(planScaffold(dir));
    const body = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    cases.push({
      name: 'an existing .gitignore is left byte-identical',
      pass: body === 'MY OWN RULES\n',
      detail: `content became: ${JSON.stringify(body.slice(0, 40))}`,
    });
  }

  // 5. a scaffolded file has REAL content, not a placeholder
  {
    const dir = scaffoldFixture();
    applyScaffold(planScaffold(dir));
    const body = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    cases.push({
      name: 'the scaffolded .gitignore carries real patterns and a stated reason',
      pass: /^logs\/$/m.test(body) && /\.env/.test(body) && /MEASURED/i.test(body),
      detail: 'logs/ or .env or the MEASURED note is missing',
    });
  }

  // 6. ROUND-TRIP: the audit must measurably improve
  {
    const dir = scaffoldFixture();
    const before = summarise(audit(dir).results);
    applyScaffold(planScaffold(dir));
    const after = summarise(audit(dir).results);
    cases.push({
      name: 'scaffolding measurably improves the audit (round-trip, not just files)',
      pass: after.requiredMissing < before.requiredMissing,
      detail: `requiredMissing ${before.requiredMissing} -> ${after.requiredMissing}`,
    });
  }

  // 7. the scaffolded date placeholder is FILLED, not left as a literal
  {
    const dir = scaffoldFixture();
    applyScaffold(planScaffold(dir));
    const body = fs.readFileSync(path.join(dir, 'docs', 'SETTLED-DECISIONS.md'), 'utf8');
    cases.push({
      name: 'the date placeholder is substituted with a real ISO date',
      pass: /\d{4}-\d{2}-\d{2}/.test(body) && !body.includes('$' + '{DATE}'),
      detail: 'placeholder survived into the written file',
    });
  }

  // 8. an unreadable root is FATAL for the scaffolder too
  {
    const plan = planScaffold(path.join(tmp, 'no-such-project'));
    cases.push({
      name: 'planning against an unreadable root is FATAL (exit 2), not an empty plan',
      pass: Boolean(plan.fatal) && plan.actions.length === 0,
      detail: plan.fatal ? 'fatal set' : 'no fatal reported',
    });
  }

  // 9. every scaffold is attributable and covers a REAL check id
  {
    const ids = new Set(CHECKS.map((c) => c.id));
    const bad = SCAFFOLDS.filter(
      (s) => !s.why || s.why.length < 20 || !Array.isArray(s.covers) || s.covers.some((c) => !ids.has(c)),
    );
    cases.push({
      name: 'every scaffold states a reason and covers a check that exists',
      pass: bad.length === 0,
      detail: bad.map((s) => s.id).join(', ') || 'all attributable',
    });
  }

  // 10. the prebuild chain is only composed of gates that exist — never a fake chain
  {
    const dir = scaffoldFixture();
    applyScaffold(planScaffold(dir));
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const chain = (pkg.scripts && pkg.scripts.prebuild) || '';
    const scripts = chain.split('&&').map((s) => s.trim()).filter(Boolean);
    const allResolve = scripts.length > 0 && scripts.every((cmd) => {
      const m = cmd.match(/node\s+(\S+)/);
      return m ? fs.existsSync(path.join(dir, m[1])) : false;
    });
    cases.push({
      name: 'the scaffolded prebuild chain references only files that exist',
      pass: scripts.length >= 2 && allResolve,
      detail: `chain="${chain}" resolves=${allResolve}`,
    });
  }

  // 11. the DRY-RUN REPORT must not claim failure for a perfectly good plan.
  //     ⚠️ Every canary above passes while the printed report lies, because they inspect the PLAN, not
  //     the rendering. This case captures the output and requires it to read as an offer, not an error.
  {
    const dir = scaffoldFixture();
    const plan = planScaffold(dir);
    const captured = [];
    const realLog = console.log;
    console.log = (...a) => captured.push(a.join(' '));
    try {
      renderScaffold(dir, plan.actions.map((a) => ({ ...a, outcome: a.kind })), false);
    } finally {
      console.log = realLog;
    }
    const text = captured.join('\n');
    cases.push({
      name: 'the dry-run report says "would create" and never "failed" for a good plan',
      pass: /would create/.test(text) && !/❌/.test(text) && !/failed/.test(text),
      detail: /❌/.test(text) ? 'the report printed a failure marker' : 'no "would create" line',
    });
  }

  // 12. THE SCORECARD CASE: a freshly scaffolded project's OWN gate must pass.
  //     ⚠️ Every other case inspects what was written. This one runs what was written. A scaffold that
  //     produces a red build on day one is the "gate that fails on day one gets switched off" trap —
  //     and it is invisible unless you execute the thing.
  {
    const dir = scaffoldFixture();
    applyScaffold(planScaffold(dir));
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const chain = (pkg.scripts && pkg.scripts.prebuild) || '';
    const gates = chain.split('&&').map((s) => s.trim()).filter(Boolean);
    const outcomes = gates.map((cmd) => {
      const m = cmd.match(/node\s+(\S+)(.*)$/);
      if (!m) return { cmd, code: 127 };
      try {
        execFileSync(process.execPath, [path.join(dir, m[1]), ...(m[2] || '').trim().split(/\s+/).filter(Boolean)], {
          stdio: 'pipe',
          cwd: dir,
        });
        return { cmd, code: 0 };
      } catch (e) {
        return { cmd, code: e.status === undefined ? 1 : e.status };
      }
    });
    const failed = outcomes.filter((o) => o.code !== 0);
    cases.push({
      name: 'the scaffolded prebuild chain PASSES on a freshly scaffolded project',
      pass: gates.length >= 2 && failed.length === 0,
      detail: failed.length ? failed.map((f) => `${f.cmd} -> exit ${f.code}`).join('; ') : `only ${gates.length} gate(s)`,
    });
  }

  let failures = 0;
  console.log('\n[readiness] --self-test');
  for (const c of cases) {
    console.log(`   ${c.pass ? '✅' : '❌'} ${c.name}${c.pass ? '' : ` — ${c.detail}`}`);
    if (!c.pass) failures += 1;
  }
  console.log(`\n[readiness] ${cases.length - failures}/${cases.length} passed`);

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* the temp dir is the OS's problem, not a test failure */
  }

  void runCases;
  return failures === 0;
}

// ── main ───────────────────────────────────────────────────────────────────────

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      '\nUsage: node scripts/audit-project-readiness.cjs [--path <dir>] [options]\n\n' +
        '  Audits a directory for the practice set: instructions, gates, decisions, layout, tooling.\n\n' +
        '  --path <dir>     the project to audit (default: current directory)\n' +
        '  --json           machine-readable output\n' +
        '  --quiet          exit code only\n' +
        '  --scaffold       show what a new project is MISSING and what would be created (writes nothing)\n' +
        '  --apply          with --scaffold: actually write the files\n' +
        '  --self-test      prove the checks and the scaffolder can fail, in both directions\n\n' +
        '  Exit 0 = nothing required missing · 1 = something required is missing · 2 = cannot judge.\n' +
        '  ⚠️ The AUDIT is a readiness report, not a gate: exit 1 is the normal state of a new project.\n' +
        '  ⚠️ --scaffold is a DRY RUN by default. Pass --apply to write. Existing files are never overwritten.\n',
    );
    return 0;
  }
  if (args.includes('--self-test')) {
    return selfTest() ? 0 : 1;
  }

  const pathIdx = args.indexOf('--path');
  const root = pathIdx >= 0 ? args[pathIdx + 1] : '.';
  if (pathIdx >= 0 && !root) {
    console.error('[readiness] --path needs a directory');
    return 2;
  }

  const apply = args.includes('--apply');

  // ── scaffold mode ────────────────────────────────────────────────────────────
  if (args.includes('--scaffold')) {
    const plan = planScaffold(root);
    if (plan.fatal) {
      console.error(`[scaffold] CANNOT JUDGE — ${plan.fatal}`);
      console.error('[scaffold] Reporting exit 2. A path that cannot be read is not a project with nothing in it.');
      return 2;
    }
    const results = apply ? applyScaffold(plan) : plan.actions.map((a) => ({ ...a, outcome: a.kind }));
    if (!args.includes('--quiet')) renderScaffold(plan.root, results, apply);

    const errors = results.filter((r) => r.outcome === 'error');
    if (errors.length) return 1;

    // ⚠️ A DRY RUN ALWAYS EXITS 0 when it could produce a plan. It has not failed at anything; it has
    // reported. Exit 1 here would make `--scaffold` unusable in a script that just wants the list.
    if (!apply) return 0;

    // After applying, report whether anything is still required-missing. That is the real verdict.
    const after = audit(root);
    const s = summarise(after.results);
    if (!args.includes('--quiet')) {
      console.log(
        `[scaffold] After scaffolding: ${s.present} present · ${s.partial} partial · ${s.missing} missing · ` +
          `${s.cannotJudge} cannot judge · ${s.requiredMissing} required still missing.`,
      );
    }
    return s.requiredMissing === 0 ? 0 : 1;
  }

  if (apply) {
    console.error('[readiness] --apply only means something with --scaffold. Nothing was written.');
    return 2;
  }

  const a = audit(root);

  if (args.includes('--json')) {
    const payload = a.fatal
      ? { root: a.root, fatal: a.fatal, results: [] }
      : { root: a.root, summary: summarise(a.results), results: a.results };
    console.log(JSON.stringify(payload, null, 2));
  } else if (!args.includes('--quiet')) {
    render(a);
  }

  if (a.fatal) return 2;
  return summarise(a.results).requiredMissing === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { audit, summarise, CHECKS, planScaffold, applyScaffold, SCAFFOLDS, TEMPLATES };
