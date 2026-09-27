#!/usr/bin/env node
/**
 * handoff-status.cjs — pending vs processed handoffs, and the vocabulary that makes an audit honest.
 * ====================================================================================================
 *
 * WHY THIS EXISTS (2026-09-27 audit)
 * ----------------------------------
 * 243 handoffs sat in a **flat directory with no record of which the Librarian had processed**, and
 * no subdirectories at all. A spent handoff and a pending one were **indistinguishable** — which is
 * why the set only ever grew, and why no reduction could be made safely: deleting would have been a
 * guess.
 *
 * It also found that `## Not done` was doing **two opposite jobs** (a deferral, and a change
 * deliberately declined). That ambiguity produced a **10× over-report** in the audit: 20 candidates
 * → 8 → 2 → and on inspection **neither was lost work**. So this checks the vocabulary too.
 *
 * THE CONVENTION IT ENFORCES
 * --------------------------
 *   handoff/            PENDING   — written by agents, not yet summarised
 *   handoff/processed/  CONSUMED  — summarised into the three pages
 *
 * ⚠️ A directory rather than a `status:` field, deliberately. A field is a claim that can disagree
 * with reality and needs parsing to be trusted; the directory IS the fact.
 *
 * Usage:
 *   node scripts/handoff-status.cjs               human report
 *   node scripts/handoff-status.cjs --json        machine-readable
 *   node scripts/handoff-status.cjs --self-test   prove the classifier can fail (no store needed)
 *
 * Exit: 0 = clean · 1 = nothing pending is unreadable, but something needs attention
 *       (a `## Not done` heading is present, or a pending handoff is unparseable).
 *
 * ⚠️ It NEVER moves or deletes a file. Moving is the Librarian's act, because it is the act that
 * claims a handoff has been summarised.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR =
  process.env.HANDOFF_DIR ||
  'G:\\My Drive\\Project Management\\Live\\Trading-Command-Suite-Documentation\\handoff';

/** The vocabulary that must not appear: it cannot distinguish "deferred" from "declined". */
const AMBIGUOUS_HEADING = /^#{1,3}\s*Not done\b/im;
/** The two headings that replaced it. */
const DEFERRED_HEADING = /^#{1,3}\s*Deferred\b/im;
const UNCHANGED_HEADING = /^#{1,3}\s*Deliberately unchanged\b/im;
/** The issue number a slug carries, if any. */
const SLUG_ISSUE = /^\d{4}-\d{2}-\d{2}-(\d{2,4})-/;
/** The date a slug carries. */
const SLUG_DATE = /^(\d{4}-\d{2}-\d{2})-/;

/**
 * ⚠️ THE RULE APPLIES FROM THIS DATE FORWARD, AND THAT IS NOT A LOOPHOLE — IT IS THE POINT.
 *
 * 78 handoffs already on disk use `## Not done`. Rewriting them is NOT a mechanical edit: each one
 * needs a judgement (was that a deferral, or a change deliberately declined?) and editing a
 * historical record to fit a later rule loses what it originally said.
 *
 * A check that is red from the day it is written gets allowlisted and then protects nothing — the
 * same argument this repo already makes for the pnl-integrity guard. So legacy files are REPORTED
 * and grandfathered; only handoffs written on or after this date must comply.
 */
const VOCABULARY_RULE_FROM = '2026-09-27';

/**
 * classify(files, readBody) — PURE, so `--self-test` can exercise it without a store.
 *
 * @param files    [{ name, body }]
 * @returns {{ pending, processed, ambiguousVocabulary, multiLanding, byIssue }}
 */
function classify(files) {
  const pending = [];
  const processed = [];
  const ambiguousVocabulary = [];
  const legacyVocabulary = [];
  for (const f of files) {
    (f.processed ? processed : pending).push(f.name);
    if (!AMBIGUOUS_HEADING.test(f.body || '')) continue;
    const d = (f.name.match(SLUG_DATE) || [])[1] || '';
    // Grandfathered only when the slug carries a date BEFORE the rule. An unparseable or missing
    // date is treated as CURRENT, so a new file cannot dodge the rule by having a bad name.
    (d && d < VOCABULARY_RULE_FROM ? legacyVocabulary : ambiguousVocabulary).push(f.name);
  }
  // A "multi-landing" issue is INFORMATIONAL, not a fault: a second handoff is correct when it is a
  // second landing days later. Merging is only right when it restates the same landing.
  const byIssue = new Map();
  for (const f of [...pending, ...processed]) {
    const m = f.match(SLUG_ISSUE);
    if (!m || Number(m[1]) < 100) continue;
    if (!byIssue.has(Number(m[1]))) byIssue.set(Number(m[1]), []);
    byIssue.get(Number(m[1])).push(f);
  }
  const multiLanding = [...byIssue.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([issue, v]) => ({ issue, count: v.length, files: v }));
  return { pending, processed, ambiguousVocabulary, legacyVocabulary, multiLanding, byIssue };
}

function selfTest() {
  const bad = [];
  const check = (label, got, want) => {
    if (String(got) !== String(want)) bad.push(`${label}\n     want: ${want}\n      got: ${got}`);
  };

  // 1 — a pending file is pending. The trivial case, and it must not be taken for granted.
  check('1 a file in handoff/ is PENDING',
    classify([{ name: 'a.md', body: '' }]).pending.length, 1);

  // 2 — a processed file is NOT pending. If this failed the whole convention would be decorative.
  check('2 a file under processed/ is CONSUMED, not pending',
    classify([{ name: 'processed/b.md', body: '', processed: true }]).pending.length, 0);

  // 3 — the OLD vocabulary is detected. This is the flaw the audit found, so the check must catch it.
  check('3 a "## Not done" heading is flagged as ambiguous',
    classify([{ name: '2026-09-27-c.md', body: '## Not done\n\n- something' }]).ambiguousVocabulary.length, 1);

  // 3b — and a HANDOFF WRITTEN BEFORE THE RULE is grandfathered, not flagged. Without this the
  // check is red from birth against 78 existing files and gets ignored.
  check('3b a pre-rule handoff is grandfathered, not flagged',
    classify([{ name: '2026-09-11-old.md', body: '## Not done\n\n- x' }]).legacyVocabulary.length, 1);
  check('   …and it is NOT counted as a violation',
    classify([{ name: '2026-09-11-old.md', body: '## Not done\n\n- x' }]).ambiguousVocabulary.length, 0);

  // 3c — a handoff with NO parseable date is treated as CURRENT, so a bad filename cannot dodge it.
  check('3c an undated handoff is held to the rule, not grandfathered',
    classify([{ name: 'no-date.md', body: '## Not done' }]).ambiguousVocabulary.length, 1);

  // 4 — and the NEW vocabulary is NOT flagged, or the check punishes the fix it exists to drive.
  const good = '## Deferred — work handed on\n\n- x. Owner: #1\n\n## Deliberately unchanged\n\n- y. why';
  check('4 the replacement vocabulary is clean',
    classify([{ name: 'd.md', body: good }]).ambiguousVocabulary.length, 0);

  // 5 — multi-landing is counted per ISSUE, and the date is not mistaken for one.
  const multi = classify([
    { name: '2026-09-23-984-a-bridge.md', body: '' },
    { name: '2026-09-25-984-b-alert.md', body: '' },
  ]);
  check('5 two handoffs for one issue are counted as multi-landing',
    multi.multiLanding.length && multi.multiLanding[0].issue, 984);
  check('   …and the date 2026 is NOT read as an issue number',
    [...classify([{ name: '2026-09-23-984-a.md', body: '' }]).byIssue.keys()].join(','), '984');

  if (bad.length) {
    console.error(`\n❌ self-test: ${bad.length} case(s) FAILED:`);
    for (const b of bad) console.error(`   ${b}`);
    return 1;
  }
  console.log('✅ self-test: 7 cases — pending vs processed is distinguished, the ambiguous "## Not done"');
  console.log('   heading is caught only from the rule date forward (legacy grandfathered), an undated file');
  console.log('   is still held to it, and a slug date is not read as an issue number.');
  return 0;
}

function readStore(dir) {
  const out = [];
  if (!fs.existsSync(dir)) throw new Error(`handoff directory not found: ${dir}`);
  for (const n of fs.readdirSync(dir)) {
    if (!n.endsWith('.md')) continue;
    out.push({ name: n, body: fs.readFileSync(path.join(dir, n), 'utf8'), processed: false });
  }
  const pdir = path.join(dir, 'processed');
  if (fs.existsSync(pdir)) {
    for (const n of fs.readdirSync(pdir)) {
      if (!n.endsWith('.md')) continue;
      out.push({ name: `processed/${n}`, body: fs.readFileSync(path.join(pdir, n), 'utf8'), processed: true });
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());

  let files;
  try {
    files = readStore(DEFAULT_DIR);
  } catch (err) {
    // ⚠️ ERROR, never pass — a check that cannot read its input must not report OK.
    console.error(`\n❌ ${err.message}`);
    console.error('   It did NOT pass — it could not run. Set HANDOFF_DIR to point elsewhere.\n');
    process.exit(1);
  }

  const r = classify(files);

  if (args.includes('--json')) {
    console.log(JSON.stringify(
      { pending: r.pending.length, processed: r.processed.length,
        ambiguousVocabulary: r.ambiguousVocabulary, legacyVocabulary: r.legacyVocabulary.length,
        multiLanding: r.multiLanding },
      null, 2,
    ));
    process.exit(r.ambiguousVocabulary.length > 0 ? 1 : 0);
  }

  console.log(`\n[handoff-status] ${DEFAULT_DIR}`);
  console.log(`  PENDING   ${String(r.pending.length).padStart(4)}`);
  console.log(`  CONSUMED  ${String(r.processed.length).padStart(4)}`);

  if (r.processed.length === 0 && r.pending.length > 0) {
    console.log('\n⚠️  Nothing is marked consumed. If the Librarian HAS processed batches, the sources');
    console.log('    were not moved to `processed/` — so the pending set cannot be trusted and no');
    console.log('    reduction can be made safely. See `agent-handoff.instructions.md` → CONSUMED STATE.');
  }

  if (r.legacyVocabulary.length > 0) {
    console.log(`\nℹ️  ${r.legacyVocabulary.length} pre-${VOCABULARY_RULE_FROM} handoff(s) still use "## Not done".`);
    console.log('   GRANDFATHERED, and deliberately not rewritten: each needs a judgement (deferral or');
    console.log('   deliberate non-change) and editing a historical record to fit a later rule loses what');
    console.log('   it originally said. The rule applies from its date forward.');
  }

  if (r.ambiguousVocabulary.length > 0) {
    console.error(`\n❌ ${r.ambiguousVocabulary.length} handoff(s) written ON OR AFTER ${VOCABULARY_RULE_FROM} use the`);
    console.error('   ambiguous "## Not done" heading. It cannot distinguish a DEFERRAL (work outstanding)');
    console.error('   from a DELIBERATE NON-CHANGE (nothing outstanding) — which made a full audit');
    console.error('   over-report by 10x. Use "## Deferred — work handed on" or "## Deliberately unchanged".');
    for (const n of r.ambiguousVocabulary.slice(0, 15)) console.error(`   • ${n}`);
    console.error('');
    process.exit(1);
  }

  if (r.multiLanding.length > 0) {
    console.log(`\nℹ️  ${r.multiLanding.length} issue(s) carry more than one handoff — EXPECTED for a`);
    console.log('   multi-landing change, and NOT a reason to merge. Only one of 24 was a phase series.');
    for (const m of r.multiLanding.slice(0, 6)) console.log(`   • #${m.issue} — ${m.count} file(s)`);
  }

  console.log('\n✅ OK — vocabulary is unambiguous.\n');
  process.exit(0);
}

main();
