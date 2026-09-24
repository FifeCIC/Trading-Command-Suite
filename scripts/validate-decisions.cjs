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
    if (!m) return;
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
  const cases = [
    ['a well-formed register row', () => checkRegister(goodRow).errors, false],
    ['a row with NO guard status', () => checkRegister('| 30 | **A thing** | because | #1 | — |').errors, true],
    ['a row with TWO guard statuses', () => checkRegister('| 30 | **A thing** | 🟢 ok 🔴 also | #1 |').errors, true],
    ['a register with no rows at all', () => checkRegister('# empty').errors, true],
    ['duplicate row numbers', () => checkRegister(goodRow + '\n' + goodRow).errors, true],
    ['a well-formed marker', () => checkMarkers([{ file: 'a.ts', text: '// DECISION (2026-09-24, primary)\n// WHAT: x\n// WHY: y\n// REVERSE BY: z' }]).errors, false],
    ['a marker missing REVERSE BY', () => checkMarkers([{ file: 'a.ts', text: '// DECISION (2026-09-24, primary)\n// WHAT: x\n// WHY: y' }]).errors, true],
    ['prose that merely LOOKS like a marker', () => checkMarkers([{ file: 'a.ts', text: 'subgraph DECISION["4. DECISION (META.Stack)"]' }]).errors, false],
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
  const errors = [...reg.errors, ...mk.errors];

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
  console.log(`  [decisions] ⚠️  this checks WELL-FORMEDNESS only — it cannot know whether a decision was recorded at all.`);
  process.exit(0);
}

main();
