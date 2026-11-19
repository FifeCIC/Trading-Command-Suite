#!/usr/bin/env node
/**
 * validate-phrasing.cjs — keep documentation from referring to a person as if they were an object.
 *
 * ── WHY THIS EXISTS (owner direction, 2026-11-19) ────────────────────────────────────────────────
 * "I found a comment line that said 'The owner asked for ALL strategies to be listed here' and I do
 * not like reference to 'the owner' from agentic AI because if I was coding myself I would not refer
 * to myself."
 *
 * A sweep replaced "owner" with "Requirement" across 401 files. The intent was right and is kept —
 * documentation should not narrate the person directing the work as a third party. But the sweep was
 * lexical, so it produced sentences whose SUBJECT cannot do the verb:
 *
 *     "the requirement approved the CRITICAL notice by name"     — a requirement approves nothing
 *     "the requirement read `barPct` as candle data"             — reading needs eyes
 *     "the requirement's machine"                                 — a requirement owns nothing
 *     "The requirement reads every commit"                        — the reason a rule was ignored
 *
 * That is worse than the original word: a reader could act on "the owner said X", and cannot act on
 * "the requirement said X" because it no longer names who decided. This guard keeps the phrasing in
 * the form a REQUIREMENT can carry — a stated rule, dated — and keeps the person-verbs for people.
 *
 * ⚠️ IT JUDGES ONLY THE ILLOGICAL FORMS, NOT THE WORD. "Requirement (2026-09-23): ..." and
 * "(requirement, 2026-10-27)" are correct and pass. Banning the word would be a guard that fires for
 * the wrong reason, and an allowlisted guard is worse than none.
 *
 * 🛑 AND THIS GUARD CANNOT CATCH THE MISTAKE ITS OWN REPAIR MADE — READ THIS BEFORE ANY SUBSTITUTION.
 * The 225 replacements that preceded this file were scripted, and FOUR of them silently broke a
 * sentence that spanned a line wrap:
 *
 *     "...no UI score was given for" + "the page a UI score, and inventing one..."   (duplicated phrase)
 *     "Every commit is read closely —" + "commit; one every few minutes..."          (duplicated word)
 *     "...has been rejected REPEATEDLY to be" + "removed from notice surfaces"       (no verb left)
 *
 * None has a mechanical signature: the words are all real, the sentence is simply no longer English.
 * Every one was found by READING the replacement in context, after the fact. **A regex that fixes
 * prose must be reviewed at the same width the prose was written**, so print the surrounding two
 * lines for each replacement rather than the matched fragment — that is the check that worked, and it
 * is a person's job, not this script's.
 *
 * ⚠️ THE RULE CORPUS IS NOT SCANNED. `.github/instructions/` and `~/.copilot/instructions/` define
 * ROLES ("the owner must approve X") rather than narrating a person in a code comment, and they read
 * correctly. This file checks the repository's own prose: source comments, docs, and site text.
 *
 * USAGE
 *   node scripts/validate-phrasing.cjs              # gate
 *   node scripts/validate-phrasing.cjs --report     # what it scanned, plus every hit
 *   node scripts/validate-phrasing.cjs --self-test  # prove each rule can fire AND stay silent
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['src', 'nest/src', 'nest/scripts', 'scripts', 'docs', 'site', 'wiki', 'nest/prisma'];
const SCAN_EXT = /\.(md|js|jsx|ts|cjs|mjs|ps1)$/;

/**
 * P1 — a person-verb with a non-person subject. "read" is included because it is the one that reads
 * most plausibly as intact and is therefore the most likely to survive a review.
 */
const PERSON_VERBS = /\bthe requirement (?:approved|approves|asked|asks|authorises|authorizes|decides|wants|wanted|expects|chose|insists|insisted|complained|reads|read|has asked|had asked|must make|must approve|is the only)\b/i;

/** P2 — a dated label used as a speaker: "Requirement, 2026-09-23:" reads as a name, not a date. */
const LABEL_AS_SPEAKER = /\bRequirement, \d{4}-\d{2}-\d{2}/;

/** P3 — the possessive. A requirement owns no machine, app, rule or decision. */
const POSSESSIVE = /\brequirement\\?'s\b/i;

const RULES = [
  { id: 'P1', name: 'a requirement does not perform a person-verb', test: (t) => PERSON_VERBS.test(t) },
  { id: 'P2', name: 'a dated requirement is a label, not a speaker', test: (t) => LABEL_AS_SPEAKER.test(t) },
  { id: 'P3', name: 'a requirement owns nothing', test: (t) => POSSESSIVE.test(t) },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const p = path.join(e.parentPath ?? e.path, e.name);
    if (!SCAN_EXT.test(p)) continue;
    if (/[\\/](node_modules|dist|\.git)[\\/]/.test(p)) continue;
    // ⚠️ A guard must be able to QUOTE the defect it forbids. This file's own docblock and self-test
    // fixtures contain the exact strings that fail P1–P3, so scanning itself would make it
    // permanently red — and a guard that is always red is one people switch off.
    if (/validate-phrasing\.cjs$/.test(p)) continue;
    out.push(p);
  }
  return out;
}

/** Judge a list of {file, text} — the seam the self-test uses, so no fixture needs a real tree. */
function evaluate(files) {
  const failures = [];
  for (const f of files) {
    for (const rule of RULES) {
      if (!rule.test(f.text)) continue;
      for (const line of f.text.split('\n')) {
        if (!rule.test(line)) continue;
        failures.push({
          rule: rule.id,
          why: rule.name,
          file: f.file,
          line: line.trim().slice(0, 120),
        });
      }
    }
  }
  return failures;
}

function selfTest() {
  const cases = [];
  const judge = (text) => evaluate([{ file: 'fixture.md', text }]);

  // P1 — must fire on the shapes the sweep produced, and stay silent on the corrected form.
  cases.push(['P1 fires: "the requirement approved the notice"', judge('* the requirement approved the notice').some((f) => f.rule === 'P1')]);
  cases.push(['P1 fires: "the requirement read the 11% as"', judge('* the requirement read the 11% as an opportunity').some((f) => f.rule === 'P1')]);
  cases.push(['P1 silent: "the requirement states ..." (a requirement CAN state)', judge('* the requirement states the bars must be current').every((f) => f.rule !== 'P1')]);
  cases.push(['P1 silent: a sentence about a person-verb with a PERSON subject', judge('* the requirement writer read the table').every((f) => f.rule !== 'P1')]);

  // P2 — the label-as-speaker form.
  cases.push(['P2 fires: "Requirement, 2026-09-23: ..."', judge('> Requirement, 2026-09-23: protocols will lock').some((f) => f.rule === 'P2')]);
  cases.push(['P2 silent: "Requirement (2026-09-23): ..."', judge('> Requirement (2026-09-23): protocols will lock').every((f) => f.rule !== 'P2')]);
  cases.push(['P2 silent: the lowercase parenthetical label', judge('* ── TWO HOSTS (requirement, 2026-11-01) ──').every((f) => f.rule !== 'P2')]);

  // P3 — possessive, in both the plain and the escaped-source form.
  cases.push(["P3 fires: the plain possessive", judge("on the requirement's machine").some((f) => f.rule === 'P3')]);
  cases.push(['P3 fires: the ESCAPED possessive inside a JS string', judge("'at the requirement\\'s instruction'").some((f) => f.rule === 'P3')]);
  cases.push(["P3 silent: the project's machine", judge("on the project's machine").every((f) => f.rule !== 'P3')]);

  let failed = 0;
  for (const [name, pass] of cases) {
    if (!pass) failed += 1;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}`);
  }
  console.log();
  if (failed) {
    console.error(`${failed} of ${cases.length} self-test case(s) failed.`);
    return 1;
  }
  console.log(`self-test: all ${cases.length} cases behaved (each rule fires on its defect AND stays silent on the corrected form).`);
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  const known = ['--report', '--self-test', '--help'];
  const unknown = argv.filter((a) => !known.includes(a));
  if (unknown.length) {
    console.error(`unknown flag(s): ${unknown.join(', ')}`);
    return 2;
  }
  if (argv.includes('--help')) {
    console.log('usage: validate-phrasing.cjs [--report] [--self-test]');
    return 0;
  }
  if (argv.includes('--self-test')) return selfTest();

  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
    .map((p) => ({ file: path.relative(ROOT, p), text: fs.readFileSync(p, 'utf8') }));

  if (!files.length) {
    // A walk that finds nothing has checked nothing.
    console.error('CANNOT JUDGE — no scannable files were found.');
    return 2;
  }

  const failures = evaluate(files);
  if (argv.includes('--report')) {
    console.log(`  scanned ${files.length} file(s) across ${SCAN_DIRS.length} folder(s)`);
  }
  if (failures.length) {
    console.error(`\n[phrasing] ✖ ${failures.length} illogical reference(s):\n`);
    for (const f of failures.slice(0, 30)) console.error(`  ${f.rule} ${f.file}: ${f.line}\n      ${f.why}`);
    if (failures.length > 30) console.error(`  … and ${failures.length - 30} more`);
    console.error('\nA requirement can be STATED and DATED. It cannot approve, ask, read or own anything.');
    console.error('Write "Requirement (2026-09-23): <the rule>" — or say what was read rather than who read it.');
    return 1;
  }
  console.log(`[phrasing] ✅ OK — ${files.length} file(s) scanned; no requirement is described as a person.`);
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { evaluate, RULES };
