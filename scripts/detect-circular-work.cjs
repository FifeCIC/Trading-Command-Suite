#!/usr/bin/env node
/**
 * detect-circular-work.cjs — alert when an area is being re-opened
 * ================================================================
 * Created 2026-09-11 by request of the project owner.
 *
 * WHY THIS EXISTS
 * ---------------
 * The owner asked: *"I'm struggling to understand why there's so many issues
 * despite AI looking over and working on these areas many times over. I'm hoping
 * clear history in docs will help agents to alert me to any situation where we're
 * re-inventing many times over."*
 *
 * This script is the answer to that question, and the answer turned out to be
 * uncomfortable: **the work is not being re-invented, it is being re-opened
 * without anyone being told it was already settled.**
 *
 * THE MECHANISM OF THE LOOP (measured 2026-09-11)
 * -----------------------------------------------
 * Three compounding causes, each of which makes the next more likely:
 *
 *   1. AN ISSUE IS CLOSED ON INTENT, NOT ON ENFORCEMENT.
 *      #638 "Scoring architecture: separate gates from scores" was closed
 *      2026-08-16 after ~4h with a checklist asserting "flat constants removed".
 *      `ENTRY_THRESHOLD = 40` is STILL in `protocol-gating.service.ts` today, and
 *      the code comment beside it documents that this constant has already been
 *      the cause of one incident. The box was ticked; nothing enforced it.
 *
 *   2. A FIX IN A SEED OR CONFIG FILE IS NOT A FIX IN THE DATABASE.
 *      `ProtocolDbService.seedProtocolsToDatabase()` is upsert-only — it never
 *      deletes. So a removal or a move in the seed is silently a no-op in the DB,
 *      and the two drift. #789 measured this: after removing 15 placements and
 *      re-seeding, the API reported `entries: 419` (down from 434) while the
 *      database still held all 14 obsolete rows. The count reflects rows
 *      UPSERTED, not rows that EXIST, so it reads exactly like success.
 *
 *   3. NOTHING RECORDS WHICH AREAS ARE SETTLED, SO EACH AGENT RE-DERIVES THEM.
 *      The contracts doc (`meta-stack-contracts.instructions.md`) lists
 *      invariants that ARE guarded. There is no companion list of decisions that
 *      are settled but NOT yet enforceable — which is exactly the set of things
 *      that get re-opened. #761's own comment records a fix that was "tried and
 *      reverted" for a reason that had to be re-discovered from 7 days of data.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * Read-only. It gathers every trace of past work on a topic and reports when the
 * same subject has been touched repeatedly, so a human can decide whether the new
 * work is:
 *
 *   (a) a genuine NEW instance of a known class  → fix it, and ADD A GUARD
 *   (b) a RE-OPENING of something already settled → cite the prior decision
 *   (c) work on a topic that is CONTRADICTORILY documented → stop and reconcile
 *
 * Sources scanned:
 *   - `docs/handoff/*.md`            (agent handoffs, dated)
 *   - `docs/issues/*.md`             (issue write-ups)
 *   - git log                        (commit subjects mentioning the topic)
 *   - GitHub issues via `gh`         (if available; degrades gracefully)
 *
 * USAGE
 *   node scripts/detect-circular-work.cjs                 # all topics
 *   node scripts/detect-circular-work.cjs risk-gate       # one topic
 *   node scripts/detect-circular-work.cjs --min-touches 3 # raise the threshold
 *
 * Exit code: 0 always (this is an advisory report, never a build gate — a gate
 * that fires on history would be switched off, which is the lesson of #789).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const HANDOFF_DIR = path.join(REPO_ROOT, 'docs', 'handoff');
const ISSUES_DIR = path.join(REPO_ROOT, 'docs', 'issues');

const argv = process.argv.slice(2);
const minTouchesFlag = argv.indexOf('--min-touches');
const MIN_TOUCHES = minTouchesFlag >= 0 ? Number(argv[minTouchesFlag + 1]) || 3 : 3;
const TARGET_TOPIC = argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));

/**
 * Topics worth watching.
 *
 * ⚠️ This list is the POINT of the tool, not boilerplate. Each entry is an area
 * where work has demonstrably been done more than once. Adding a topic here is
 * how the project says "we keep coming back to this — watch it".
 *
 * `settledBy` records the issue/ADR that claims to have decided it. When a new
 * issue touches a topic that has a `settledBy`, the report says so loudly: that
 * is the "alert me to re-invention" behaviour the owner asked for.
 */
const TOPICS = [
  {
    key: 'gate-vs-score',
    label: 'Gate vs score separation (risk gates must not score)',
    // A group with isRiskGate:true may only hold category:'structural' directives.
    patterns: [/\brisk[\s-]?gate/i, /\bisRiskGate\b/, /gate vs score/i, /separate gates from scores/i, /inert.*(risk|gate)/i],
    settledBy: '#638 (2026-08-16) + INV-GATE-MEMBERSHIP (2026-09-11)',
    caution:
      '#638 was closed claiming "flat constants removed" but ENTRY_THRESHOLD is still live. ' +
      'INV-GATE-MEMBERSHIP is now enforced by a build guard, so a new instance should FAIL THE BUILD, not raise a new issue.',
  },
  {
    key: 'denominator',
    label: 'Signal denominator / capacity (the percentage base)',
    patterns: [/denominator/i, /capacityMax/i, /rawMax/i, /unreachable/i, /configuredSignalMax/i, /signalPct/i],
    settledBy: 'ADR-011 + #758 (2026-09-10)',
    caution:
      '#758 was fixed TWICE (the first fix still read a runtime value). The capacity formula is settled: ' +
      'earned / CONFIGURED capacity. Do not re-litigate; measure with scripts/analyse-unreachable-capacity.cjs.',
  },
  {
    key: 'seed-db-drift',
    label: 'Seed data vs database drift (upsert-only seeder)',
    patterns: [/seed/i, /upsert/i, /protocols-seed-data/i, /reconcile/i, /orphan/i],
    settledBy: '#789 (2026-09-11)',
    caution:
      'Re-seeding is ADDITIVE-ONLY. Any removal/move needs explicit SQL. Never trust `entries: N` as proof of a removal.',
  },
  {
    key: 'direction-mismatch',
    label: 'Directive direction vs protocol direction mode',
    patterns: [/LONG_ONLY/i, /SHORT_ONLY/i, /directionBias/i, /direction[\s-]mismatch/i, /bearish.*LONG/i],
    settledBy: '#620 (2026-08-17) + validate-protocol-directions.cjs',
    caution:
      'A guard already exists (validate-protocol-directions.cjs). #792 is a NEW instance in a different dimension ' +
      '(reachability, not contradiction) — check whether the existing guard can be extended before writing a new tool.',
  },
  {
    key: 'capacity-threshold',
    label: 'Classification thresholds (BUY/HOLD/SELL bands)',
    patterns: [/ENTRY_THRESHOLD/i, /HOLD_FLOOR/i, /\b80\/40\b/, /threshold/i, /\bbands?\b.*recalibrat/i],
    settledBy: 'NOT SETTLED — #761 open',
    caution:
      '⚠️ This has churned repeatedly (#638, #761) BECAUSE THE DENOMINATOR UNDER IT KEPT CHANGING. ' +
      'Do not recalibrate bands until the denominator is frozen and measured. See #761.',
  },
  {
    key: 'stale-data',
    label: 'Stale / future bars and market-status freshness',
    patterns: [/stale/i, /future.?dated/i, /INV-NO-FUTURE-ROWS/i, /freshness/i, /market-status/i, /misaligned/i],
    settledBy: '#750/#751/#780/#783 (2026-09-10)',
    caution:
      'Four issues in one week, all "plausible numbers, no error". Guards exist (INV-GATE-FAILS-CLOSED, INV-BAR-ALIGNED). ' +
      'A new symptom here is likely a FIFTH path the guards cannot see — check what the guards actually assert before fixing.',
  },
  {
    key: 'duplicate-directive',
    label: 'Duplicate directive placement / double-counting',
    patterns: [/duplicate/i, /double[\s-]count/i, /appears in multiple groups/i, /seenDirectiveIds/i],
    settledBy: 'seenDirectiveIds dedupe (protocol-gating.service.ts L668)',
    caution:
      'The dedupe makes duplicates HARMLESS but still noisy. ⚠️ A duplicate warning can mean two opposite things: ' +
      '(a) real double-counting, or (b) a valid copy shadowing a DEAD one. Only the group KIND distinguishes them (#789).',
  },
];

// ── gathering ────────────────────────────────────────────────────────────────

function readDirSafe(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
}

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return '';
  }
}

/** Handoff + issue docs, with any 2026-* date parsed from the filename. */
function gatherDocs() {
  const out = [];
  for (const [kind, dir] of [['handoff', HANDOFF_DIR], ['issue-doc', ISSUES_DIR]]) {
    for (const f of readDirSafe(dir)) {
      const full = path.join(dir, f);
      let body = '';
      try {
        body = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const dateMatch = f.match(/(20\d{2}-\d{2}-\d{2})/);
      out.push({ kind, name: f, date: dateMatch ? dateMatch[1] : null, body });
    }
  }
  return out;
}

/** `git log --oneline` subjects, with dates. */
function gatherCommits() {
  const raw = sh('git', ['log', '--pretty=format:%h|%ad|%s', '--date=short', '-n', '1200']);
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...rest] = line.split('|');
      return { hash, date, subject: rest.join('|') };
    });
}

/** Open + closed issues via gh. Degrades to empty if gh is unavailable. */
function gatherIssues() {
  const raw = sh('gh', [
    'issue', 'list', '--repo', 'FifeCIC/Trading-Command-Suite',
    '--state', 'all', '--limit', '400',
    '--json', 'number,title,state,closedAt',
  ]);
  if (!raw) return [];
  try {
    return JSON.parse(raw).map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      closedAt: (i.closedAt || '').slice(0, 10) || null,
    }));
  } catch {
    return [];
  }
}

// ── analysis ─────────────────────────────────────────────────────────────────

function matchesTopic(text, topic) {
  return topic.patterns.some((re) => re.test(text));
}

function analyse(topics, docs, commits, issues) {
  const results = [];

  for (const topic of topics) {
    if (TARGET_TOPIC && topic.key !== TARGET_TOPIC) continue;

    const handoffs = docs.filter((d) => d.kind === 'handoff' && matchesTopic(d.name + '\n' + d.body, topic));
    const issueDocs = docs.filter((d) => d.kind === 'issue-doc' && matchesTopic(d.name + '\n' + d.body, topic));
    const commitHits = commits.filter((c) => matchesTopic(c.subject, topic));
    const issueHits = issues.filter((i) => matchesTopic(i.title, topic));

    const touches = handoffs.length + issueDocs.length + issueHits.length + commitHits.length;
    if (touches < MIN_TOUCHES) continue;

    results.push({
      topic,
      touches,
      handoffs: handoffs.sort((a, b) => (a.name < b.name ? -1 : 1)),
      issueDocs,
      commitHits,
      issueHits: issueHits.sort((a, b) => a.number - b.number),
    });
  }

  return results.sort((a, b) => b.touches - a.touches);
}

// ── reporting ────────────────────────────────────────────────────────────────

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// ── run ──────────────────────────────────────────────────────────────────────

const docs = gatherDocs();
const commits = gatherCommits();
const issues = gatherIssues();
const results = analyse(TOPICS, docs, commits, issues);

console.log('\n' + '━'.repeat(78));
console.log('  CIRCULAR-WORK DETECTOR  —  is this area being re-opened?');
console.log('  (generated ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z, read-only report)');
console.log('━'.repeat(78));

if (!results.length) {
  console.log(`\nNo topic reached the ${MIN_TOUCHES}-touch threshold.\n`);
  process.exit(0);
}

for (const r of results) {
  const openIssues = r.issueHits.filter((i) => i.state === 'OPEN');
  const closedIssues = r.issueHits.filter((i) => i.state === 'CLOSED');

  console.log('\n' + '─'.repeat(78));
  console.log(`  ${r.topic.label}`);
  console.log(`  key: ${r.topic.key}   |   total evidence hits: ${r.touches}`);
  console.log('─'.repeat(78));
  console.log(`  SETTLED BY : ${r.topic.settledBy}`);

  if (openIssues.length) {
    console.log(`\n  ⚠️  OPEN issues in this area (${openIssues.length}):`);
    for (const i of openIssues) console.log(`      #${pad(i.number, 5)} ${i.title}`);
  }
  if (closedIssues.length) {
    console.log(`\n  ✅ CLOSED issues in this area (${closedIssues.length}) — where the work was already done once:`);
    for (const i of closedIssues) console.log(`      #${pad(i.number, 5)} ${pad(i.closedAt || '?', 12)} ${i.title}`);
  }
  if (r.handoffs.length) {
    console.log(`\n  📄 Handoffs (${r.handoffs.length}) — read these BEFORE starting:`);
    for (const h of r.handoffs) console.log(`      ${h.name}`);
  }
  if (r.issueDocs.length) {
    console.log(`\n  📄 Issue docs (${r.issueDocs.length}):`);
    for (const d of r.issueDocs) console.log(`      ${d.name}`);
  }
  if (r.commitHits.length) {
    console.log(`\n  🔧 Commits touching this (${r.commitHits.length}) — most recent 6:`);
    for (const c of r.commitHits.slice(0, 6)) console.log(`      ${c.hash} ${c.date}  ${c.subject.slice(0, 66)}`);
    if (r.commitHits.length > 6) console.log(`      … and ${r.commitHits.length - 6} more`);
  }

  console.log(`\n  👉 CAUTION: ${r.topic.caution}`);
}

console.log('\n' + '━'.repeat(78));
console.log('  HOW TO USE THIS REPORT');
console.log('━'.repeat(78));
console.log(`
  If you are about to change one of the areas above, decide WHICH case you are in:

   (a) NEW INSTANCE of a known class
       → fix it, then ADD A GUARD so instance N+1 fails the build instead of
         becoming another issue. (This is what turned #789 into
         INV-GATE-MEMBERSHIP, and why #790 is 6 placements and not 6 issues.)

   (b) RE-OPENING a settled decision
       → STOP. Cite the settledBy reference and explain what changed that
         invalidates it. Re-deciding by accident is the single most expensive
         thing that happens in this repo.

   (c) the docs CONTRADICT each other
       → STOP and reconcile FIRST. Do not implement against a contradiction.
         Record the reconciliation in the docs with a timestamp.

  ⚠️ A closed issue is NOT proof the fix is enforced. Check for a guard:
     ls nest/scripts/ | grep -i validate
     grep -n "<the invariant>" .github/instructions/meta-stack-contracts.instructions.md
     A checklist box that says "removed" is a claim; a build-time guard is a fact.
`);
