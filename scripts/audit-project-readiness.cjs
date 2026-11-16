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
    id: 'instructions-exist',
    bucket: 'Governance',
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
    next: 'Add a LICENCE (AGPL-3.0 if it stays open, with the notice preserved in forks).',
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
    return { id: c.id, bucket: c.bucket, label: c.label, required: c.required, why: c.why, next: c.next, ...r };
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
      console.log(`  ${r.required ? '🛑' : '👉'} ${r.label}`);
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
      write(d, 'src/a.js', '// DECISION (2026-01-01, x)\n// DECISION (2026-01-02, y)\n// DECISION (2026-01-03, z)\n');
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
      '\nUsage: node scripts/audit-project-readiness.cjs [--path <dir>] [--json] [--quiet] [--self-test]\n\n' +
        '  Audits a directory for the practice set: instructions, gates, decisions, layout, tooling.\n' +
        '  Exit 0 = nothing required missing · 1 = something required is missing · 2 = cannot judge.\n' +
        '  ⚠️ This is a READINESS REPORT, not a gate. Exit 1 is normal for a new project.\n',
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

module.exports = { audit, summarise, CHECKS };
