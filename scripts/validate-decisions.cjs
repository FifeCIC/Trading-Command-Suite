#!/usr/bin/env node
/**
 * validate-decisions.cjs — a decision you cannot find is a decision nobody can reverse.
 * ====================================================================================
 * Created 2026-09-24 under primary-agent authority (`.github/instructions/decision-authority.instructions.md`).
 *
 * WHY THIS EXISTS
 * ---------------
 * Owner, 2026-09-24: *"make decisions. With those decisions written into issues and doc comments.
 * We can easily find them and change them if they aren't working out so well."*
 *
 * "Easily find them" and "change them" are both **findability** properties, and findability is
 * exactly the kind of property that decays silently. So two things are checked:
 *
 *   RULE A — THE REGISTER. Every row of `docs/SETTLED-DECISIONS.md` carries exactly one guard
 *            status (🟢 / 🟡 / 🔴). ⚠️ Measured before this guard existed: **29 of 30 rows did** —
 *            row 25 held a literal U+FFFD, the emoji destroyed by an encoding round-trip. An
 *            unmarked row is indistinguishable from an unguarded one, which is the single thing the
 *            register exists to prevent.
 *
 *   RULE B — THE MARKER. A `DECISION (YYYY-MM-DD, agent)` comment must carry `WHAT`, `WHY` and
 *            `REVERSE BY`. ⚠️ `REVERSE BY` is the load-bearing field: **if you cannot say how to
 *            undo a decision, you have not finished making it.**
 *
 * ⚠️ The marker pattern requires the DATE and a COMMA. A looser `DECISION (` matched 4 real false
 * positives in this repo — `DECISION (META.Stack)` in DiagramsPage.jsx, `a DECISION (R12/#971)` in
 * a test header, and two more. A guard that fires on prose is a guard that gets allowlisted.
 *
 * ── Watch what this guard does NOT claim ────────────────────────────────────────────────────────
 * It cannot check that a decision was *recorded somewhere*. Nothing can. A passing run means "the
 * decisions that exist are well-formed", never "every decision was written down". Stating that is
 * the difference between a guard and a reassurance.
 *
 * Usage:
 *   node scripts/validate-decisions.cjs              # both rules
 *   node scripts/validate-decisions.cjs --report     # list every register row + its guard status
 *   node scripts/validate-decisions.cjs --self-test  # prove BOTH rules can fail
 */

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const REGISTER = path.join(ROOT, 'docs', 'SETTLED-DECISIONS.md');
const SCAN_DIRS = [path.join(ROOT, 'src'), path.join(ROOT, 'nest', 'src'), path.join(ROOT, 'scripts')];
const MARKS = ['🟢', '🟡', '🔴'];

/** ⚠️ Date + comma required — see the header note about false positives. */
const MARKER_RE = /DECISION\s*\((\d{4}-\d{2}-\d{2})\s*,\s*([^)]+)\)/;
const REQUIRED_FIELDS = ['WHAT:', 'WHY:', 'REVERSE BY:'];

/** RULE A — parse the register. Pure: the self-test calls this with injected text. */
function checkRegister(text) {
  const errors = [];
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  let rows = 0;

  lines.forEach((line, i) => {
    const m = line.match(/^\|\s*(\d+)\s*\|/);
    if (!m) {
      // ⚠️ A ROW CARRYING A GUARD STATUS BUT NO ROW NUMBER IS INVISIBLE TO THIS CHECK.
      // Added 2026-09-24: R20's row was written WITHOUT a number, the validator reported
      // "33 register rows" and skipped it entirely — the SAME defect this rule exists to prevent
      // (an unmarked row is indistinguishable from an unguarded one), reached by another route.
      // Scoped to rows carrying a guard emoji AND shaped like a TABLE ROW (`|`), so this file's
      // other tables and its prose are untouched. ⚠️ The first version omitted the `|` test and
      // immediately produced 3 false positives on PROSE — a "**Legend:** 🟢 … 🟡 … 🔴 …" line, a
      // blockquote, and a numbered list item. A guard that fires on prose gets allowlisted, which
      // is worse than no guard, so the pattern was TIGHTENED rather than the exemption widened.
      const orphaned = line.trimStart().startsWith('|') ? MARKS.filter((mk) => line.includes(mk)) : [];
      if (orphaned.length) {
        errors.push(`SETTLED-DECISIONS.md:${i + 1}: carries ${orphaned.join(' ')} but NO row number — this check cannot see it. Number the row.`);
      }
      return;
    }
    rows++;
    const n = Number(m[1]);
    const where = `SETTLED-DECISIONS.md:${i + 1} (row ${n})`;
    if (seen.has(n)) errors.push(`${where}: duplicate row number`);
    seen.add(n);

    const found = MARKS.filter((mk) => line.includes(mk));
    if (found.length === 0) {
      errors.push(`${where}: no guard status — add exactly one of ${MARKS.join(' / ')} (an unmarked row reads as neither guarded nor unguarded)`);
    } else if (found.length > 1) {
      errors.push(`${where}: ${found.length} guard statuses (${found.join(' ')}) — a row has exactly one`);
    }
  });

  if (rows === 0) errors.push('SETTLED-DECISIONS.md: no register rows found — has the table format changed?');
  return { errors, rows };
}

/** RULE B — find well-formed DECISION markers. Pure: the self-test calls this with injected text. */
function checkMarkers(files) {
  const errors = [];
  let markers = 0;

  for (const { file, text } of files) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!MARKER_RE.test(line)) return;
      markers++;
      // The fields may be on following lines — a doc block, not a one-liner.
      const block = lines.slice(i, i + 20).join('\n');
      for (const field of REQUIRED_FIELDS) {
        if (!block.includes(field)) {
          errors.push(`${file}:${i + 1}: DECISION marker is missing \`${field}\``);
        }
      }
    });
  }
  return { errors, markers };
}

/**
 * RULE C — a SETTLED SUBJECT may be named only alongside the row that settled it.
 *
 * ⚠️ WHY THIS EXISTS (2026-09-28). An agent re-derived row 23's A/B netting finding as if it were
 * new (row 43), and asked the owner a question row 23 records as explicitly ended. Nothing caught
 * it: `detect-circular-work.cjs` reported "No topic reached the 3-touch threshold", because it
 * tracks ISSUE re-opens, not an agent re-deriving a REGISTER entry.
 *
 * The rule is deliberately MECHANICAL: citing is cheap, and requiring a citation turns "did you
 * read the register?" from a hope into a build failure. The declaration lives in the register
 * itself (`## 🔒 Settled subjects`), so the owner reads the same list the guard enforces.
 *
 * Two things are checked, and BOTH can fail:
 *   1. a numbered row naming a settled subject without citing its settling row;
 *   2. a DECLARED TERM THAT APPEARS NOWHERE in its settling row — a stale/invented declaration,
 *      which would otherwise silently stop guarding anything.
 *
 * ⚠️ Only `| <number> |` rows are treated as register rows, so the declaration table itself is
 * never scanned as one. Pure function: the self-test injects text.
 */
function checkReopen(text) {
  const errors = [];
  const lines = text.split(/\r?\n/);

  // ── Parse the declaration table, bounded by its heading and the next `## ` heading.
  const start = lines.findIndex((l) => /^#{2,}\s/.test(l) && /settled subjects/i.test(l));
  const subjects = [];
  if (start !== -1) {
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#{2,}\s/.test(lines[i])) break;
      const m = lines[i].match(/^\|\s*(?!Subject)([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*rows?\s+([\d,\s]+)\s*\|\s*$/i);
      if (!m) continue;
      const terms = [...m[2].matchAll(/`([^`]+)`/g)].map((t) => t[1]);
      const settles = m[3].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      if (terms.length && settles.length) subjects.push({ subject: m[1].trim(), terms, settles });
    }
  }

  // ── Which rows exist, and what they say.
  const rows = lines
    .map((line, i) => ({ line, i, m: line.match(/^\|\s*(\d+)\s*\|/) }))
    .filter((r) => r.m);

  for (const { subject, terms, settles } of subjects) {
    // (2) Stale declaration: every declared term must ACTUALLY appear in a settling row.
    const settlerText = rows.filter((r) => settles.includes(Number(r.m[1]))).map((r) => r.line).join('\n');
    if (settlerText === '') {
      errors.push(`Settled-subjects declaration "${subject}" names row(s) ${settles.join(', ')} — no such register row exists`);
      continue;
    }
    for (const term of terms) {
      let re;
      try { re = new RegExp(term, 'i'); } catch { errors.push(`Settled-subjects declaration "${subject}": \`${term}\` is not a valid regular expression`); continue; }
      if (!re.test(settlerText)) {
        errors.push(`Settled-subjects declaration "${subject}": term \`${term}\` appears in NO settling row (${settles.map((n) => 'row ' + n).join(', ')}) — stale declaration, it guards nothing. Remove it or fix the term.`);
      }
    }
    // (1) A row naming the subject must cite the row that settled it.
    for (const r of rows) {
      const n = Number(r.m[1]);
      if (settles.includes(n)) continue; // the settling row may name its own subject
      const named = terms.some((t) => { try { return new RegExp(t, 'i').test(r.line); } catch { return false; } });
      if (!named) continue;
      const cited = settles.some((s) => new RegExp(`rows?\\s+${s}\\b`, 'i').test(r.line));
      if (!cited) {
        errors.push(`SETTLED-DECISIONS.md:${r.i + 1} (row ${n}): names the settled subject "${subject}" WITHOUT citing ${settles.map((s) => 'row ' + s).join(' / ')} — this reads as re-opening a settled decision. Cite the row, or say what changed that invalidates it.`);
      }
    }
  }

  return { errors, subjects: subjects.length };
}

function collectFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'dist-free' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx|ts|tsx|cjs|mjs)$/.test(e.name)) continue;
      // ⚠️ Skip THIS file. Its self-test fixtures are DECISION markers BY DESIGN, so scanning it
      // reports the fixtures as violations — a false positive that would train the next reader to
      // ignore the guard. Narrow: one file, named by path, not a pattern.
      if (path.resolve(full) === path.resolve(__filename)) continue;
      out.push({ file: path.relative(ROOT, full).replace(/\\/g, '/'), text: fs.readFileSync(full, 'utf8') });
    }
  };
  for (const d of SCAN_DIRS) walk(d);
  return out;
}

function selfTest() {
  const goodRow = '| 30 | **A thing** | because | #1 | 🟢 gated |';
  // ── RULE C fixtures. The declaration is a table ABOVE the register rows, mirroring the real file.
  const DECL = '## 🔒 Settled subjects\n| Subject | Terms | Settled by |\n| the netting question | `netting`, `hedging` | row 23 |';
  const SETTLER = '| 23 | **Settled** | MT5 netting applies, hedging retracted | #1 | 🟢 gated |';
  const cases = [
    ['a well-formed register row', () => checkRegister(goodRow).errors, false],
    ['a row with NO guard status', () => checkRegister('| 30 | **A thing** | because | #1 | — |').errors, true],
    ['a row carrying a status but NO row number (invisible to the check)', () => checkRegister('| **A thing** | because | 🟢 gated |').errors, true],
    ['a row with TWO guard statuses', () => checkRegister('| 30 | **A thing** | 🟢 ok 🔴 also | #1 |').errors, true],
    ['a register with no rows at all', () => checkRegister('# empty').errors, true],
    ['duplicate row numbers', () => checkRegister(goodRow + '\n' + goodRow).errors, true],
    ['a well-formed marker', () => checkMarkers([{ file: 'a.ts', text: '// DECISION (2026-09-24, primary)\n// WHAT: x\n// WHY: y\n// REVERSE BY: z' }]).errors, false],
    ['a marker missing REVERSE BY', () => checkMarkers([{ file: 'a.ts', text: '// DECISION (2026-09-24, primary)\n// WHAT: x\n// WHY: y' }]).errors, true],
    ['prose that merely LOOKS like a marker', () => checkMarkers([{ file: 'a.ts', text: 'subgraph DECISION["4. DECISION (META.Stack)"]' }]).errors, false],

    // ── RULE C — the re-open guard. Canaried in BOTH directions, plus its own failure mode.
    ['RULE C: a row naming a settled subject WITHOUT citing its row', () => checkReopen(DECL + '\n' + SETTLER + '\n| 43 | **Copy** | the netting question again | #2 | 🟡 partial |').errors, true],
    ['RULE C: the same row WITH the citation (the fix)', () => checkReopen(DECL + '\n' + SETTLER + '\n| 43 | **Copy** | the netting question (see row 23) | #2 | 🟡 partial |').errors, false],
    ['RULE C: the SETTLING row may name its own subject', () => checkReopen(DECL + '\n' + SETTLER).errors, false],
    ['RULE C: an unrelated row is untouched', () => checkReopen(DECL + '\n' + SETTLER + '\n| 44 | **Other** | a totally different matter | #3 | 🟢 gated |').errors, false],
    ['RULE C: a declaration whose term appears in NO settling row (STALE, guards nothing)', () => checkReopen('## 🔒 Settled subjects\n| Subject | Terms | Settled by |\n| the question | `netting` | row 23 |\n| 23 | **Settled** | nothing relevant here | #1 | 🟢 gated |').errors, true],
    ['RULE C: a declaration naming a row that does not exist', () => checkReopen('## 🔒 Settled subjects\n| Subject | Terms | Settled by |\n| the question | `netting` | row 99 |\n| 23 | **Settled** | netting applies | #1 | 🟢 gated |').errors, true],
    ['RULE C: a register with NO declaration table is not an error', () => checkReopen('| 23 | **Settled** | netting applies | #1 | 🟢 gated |').errors, false],
  ];

  let bad = 0;
  for (const [label, run, shouldFail] of cases) {
    const errs = run();
    if ((errs.length > 0) !== shouldFail) {
      console.log(`  ✗ SELF-TEST INVALID: "${label}" — expected ${shouldFail ? 'a violation' : 'none'}, got ${errs[0] || 'none'}`);
      bad++;
    }
  }
  if (bad) {
    console.log(`\n  ✗ ${bad} self-test case(s) misbehaved — the rules are not doing what this file claims.`);
    return 1;
  }
  console.log(`  ✅ self-test: ${cases.length} cases — both rules were observed to fail, valid input was observed to pass, and prose was observed NOT to fire.`);
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());

  let registerText;
  try {
    registerText = fs.readFileSync(REGISTER, 'utf8');
  } catch (e) {
    console.error(`FATAL: cannot read ${REGISTER} — ${e.message}`);
    process.exit(1);
  }

  const reg = checkRegister(registerText);
  const mk = checkMarkers(collectFiles());
  const ro = checkReopen(registerText);
  const errors = [...reg.errors, ...mk.errors, ...ro.errors];

  if (args.includes('--report')) {
    console.log('\n  REGISTER — guard status per row\n');
    registerText.split(/\r?\n/).forEach((line, i) => {
      const m = line.match(/^\|\s*(\d+)\s*\|\s*\*\*(.{0,58})/);
      if (!m) return;
      const mark = MARKS.find((k) => line.includes(k)) || '??';
      console.log(`  ${mark}  row ${String(m[1]).padStart(2)}  ${m[2].replace(/\*\*/g, '')}…`);
    });
    console.log('');
  }

  if (errors.length) {
    console.error(`\n  ✗ decisions: ${errors.length} violation(s)\n`);
    for (const e of errors) console.error(`      ${e}`);
    console.error('');
    process.exit(1);
  }

  const guarded = MARKS[0], partial = MARKS[1], unguarded = MARKS[2];
  const tally = [
    `${guarded} ${registerText.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l) && l.includes(guarded)).length}`,
    `${partial} ${registerText.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l) && l.includes(partial)).length}`,
    `${unguarded} ${registerText.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l) && l.includes(unguarded)).length}`,
  ].join(' · ');
  console.log(`  [decisions] ✅ ${reg.rows} register rows all carry a guard status (${tally}) · ${mk.markers} well-formed DECISION marker(s)`);
  console.log(`  [decisions] ✅ ${ro.subjects} settled subject(s) declared; no row names one without citing the row that settled it`);
  console.log(`  [decisions] ⚠️  this checks WELL-FORMEDNESS and RE-OPEN only — it cannot know whether a decision was recorded at all.`);
  process.exit(0);
}

main();
