/**
 * validate-debt-expiry.cjs — accepted debt must be LOOKED AT again, or it becomes permanent by default.
 *
 * ── THE DEFECT THIS PREVENTS ─────────────────────────────────────────────────────────────────────
 * Measured 2026-11-27: this repository has **9 ratchet baselines totalling ~1,640 held findings** —
 * `page-chrome` 149, `duplication` 601, `css-literals` 123, `pipeline-contracts` 5, and the rest. Every
 * one of them is guarded against GROWTH by its own gate, and those gates work: the colour-literal ratchet
 * went 263 → 37 in a single session.
 *
 * ⚠️ **BUT NONE OF THEM IS GUARDED AGAINST AGE.** "The baseline may only go down" is a rule about
 * direction, not about pace. A number that never moves is not a ratchet being respected — it is a
 * decision somebody made once and nobody has revisited. The instruction file already says the shape out
 * loud about a different registry: *"a registry with no cadence is a graveyard."*
 *
 * ⚠️ **AND THE PIPELINE-CONTRACTS CASE IS WORSE THAN AGE — IT IS A GATE THAT DOES NOT GATE.** It prints
 * *"held (tracked debt, does not fail the build)"* and exits 0, while five directive classes still emit a
 * non-zero score derived from the calendar. A check that reports is indistinguishable from one that does
 * not exist; this file makes the hold visible on a clock so it cannot be reported-and-forgotten.
 *
 * ── THE RULES ───────────────────────────────────────────────────────────────────────────────────
 *   E1 NO STALE HOLD   `today - reviewedOn > toleranceDays` → FAIL, naming the entry and its owner.
 *   E2 NO PHANTOM GATE an entry whose `gate` file no longer exists, or is no longer called by any npm
 *                      script, → FAIL. A register that outlives its gate is a list of things nobody checks.
 *   E3 A REASON, OR NOTHING  `--review <id>` refuses without `--reason "<20+ chars>"`. There is no bulk
 *                      reset, because a bulk reset is how a clock becomes ceremony.
 *
 * ⚠️ **IT DOES NOT RE-MEASURE THE COUNT.** The owning gate already fails on growth, and re-running nine
 * gates here would duplicate that and slow `prebuild` for no new information. `holds` is the figure at the
 * last review — a record, not a live reading, and it is labelled as such in the report.
 *
 * Usage:
 *   node scripts/validate-debt-expiry.cjs                       # check (E1 + E2)
 *   node scripts/validate-debt-expiry.cjs --report              # every entry, its age and its budget
 *   node scripts/validate-debt-expiry.cjs --review <id> --reason "why this is still held"
 *   node scripts/validate-debt-expiry.cjs --self-test           # prove E1 and E2 can fail
 *
 * Exit: 0 = every hold is inside its window · 1 = at least one is stale or phantom ·
 *       2 = could not judge (never 0 — a check that reads nothing has checked nothing).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REGISTER = path.join(ROOT, 'docs', 'debt-register.json');
const PKG = path.join(ROOT, 'package.json');
const NEST_PKG = path.join(ROOT, 'nest', 'package.json');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days between two ISO dates, floored. Returns null when either is unparseable. */
function ageInDays(reviewedOn, today) {
  const a = new Date(reviewedOn).getTime();
  const b = new Date(today).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / DAY_MS);
}

/**
 * evaluate(entries, today, opts) — PURE, so every branch is canaried without the filesystem.
 *
 * `opts.gateExists(file)` and `opts.gateWired(basename)` are injected so the self-test can drive a
 * missing gate and an orphaned gate without touching disk.
 */
function evaluate(entries, today, opts) {
  const out = [];
  for (const e of entries) {
    const problems = [];
    const age = ageInDays(e.reviewedOn, today);
    if (age === null) {
      problems.push(`reviewedOn '${e.reviewedOn}' is not a date — the clock cannot run`);
    } else if (age > e.toleranceDays) {
      problems.push(
        `last reviewed ${age} day(s) ago, budget is ${e.toleranceDays} — ${e.holds} held item(s) have not been looked at since`,
      );
    }
    // E2 — a register that outlives its gate is a list of things nobody checks.
    if (!opts.gateExists(e.gate)) {
      problems.push(`gate ${e.gate} does not exist — the entry is a claim about a check that is gone`);
    } else if (!opts.gateWired(path.basename(e.gate))) {
      problems.push(`gate ${e.gate} is not called by any npm script — an orphaned gate guards nothing`);
    }
    if (!e.owner || !/^#\d+$/.test(String(e.owner))) {
      problems.push(`owner '${e.owner ?? ''}' is not an issue number — a deferral without an owner is a silent drop`);
    }
    if (!e.why || String(e.why).length < 20) {
      problems.push('no `why` sentence — an entry that cannot say why it is held is not a decision');
    }
    out.push({ ...e, age, problems, ok: problems.length === 0 });
  }
  return out;
}

function wiredScripts() {
  const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { scripts: {} });
  // ⚠️ BASENAME MATCH, not full path. `nest/package.json` scripts run from `nest/`, so the chain names
  // `scripts/x.cjs` while the file is `nest/scripts/x.cjs`. Comparing full paths reported two live gates
  // as unwired in `validate-standards.cjs` on its first run — the check was wrong, not the claims.
  return Object.values({ ...read(PKG).scripts, ...read(NEST_PKG).scripts }).join('\n');
}

function check(today = new Date().toISOString().slice(0, 10)) {
  if (!fs.existsSync(REGISTER)) throw new Error(`${path.relative(ROOT, REGISTER)} not found`);
  const parsed = JSON.parse(fs.readFileSync(REGISTER, 'utf8'));
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  if (!entries.length) {
    // ⚠️ An empty register is an ERROR, not a clean pass. This file exists because debt exists; a zero
    // row count means the register or its parser changed shape, not that the debt was paid.
    throw new Error('the debt register holds zero entries — an empty register is not a clean one');
  }
  const scripts = wiredScripts();
  return evaluate(entries, today, {
    gateExists: (rel) => fs.existsSync(path.join(ROOT, rel)),
    gateWired: (basename) => scripts.includes(basename),
  });
}

function selfTest() {
  let failures = 0;
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  const opts = { gateExists: () => true, gateWired: () => true };
  const base = {
    id: 'x',
    gate: 'scripts/x.cjs',
    holds: 3,
    owner: '#1',
    reviewedOn: '2026-11-01',
    toleranceDays: 30,
    why: 'a reason long enough to count as a reason',
  };
  const run = (e, today = '2026-11-20', o = opts) => evaluate([e], today, o)[0];

  expect('age is measured in whole days', ageInDays('2026-11-01', '2026-11-20'), 19);
  expect('an unparseable date yields null, not zero', ageInDays('not-a-date', '2026-11-20'), null);

  // E1 — both directions.
  expect('a hold inside its window is clean', run(base).ok, true);
  expect('a hold PAST its window fails', run(base, '2026-12-05').ok, false);
  expect(
    'and the message says how late it is',
    run(base, '2026-12-05').problems[0].includes('34 day(s) ago'),
    true,
  );
  expect('an unparseable reviewedOn fails rather than passing', run({ ...base, reviewedOn: 'soon' }).ok, false);
  // The boundary: exactly at the budget is still inside it.
  expect('exactly at tolerance is NOT stale', run(base, '2026-12-01').ok, true);
  expect('one day past tolerance IS stale', run(base, '2026-12-02').ok, false);

  // E2 — both directions.
  expect(
    'a missing gate fails',
    run(base, '2026-11-20', { gateExists: () => false, gateWired: () => true }).problems.join(' ').includes('does not exist'),
    true,
  );
  expect(
    'an orphaned gate fails',
    run(base, '2026-11-20', { gateExists: () => true, gateWired: () => false }).problems.join(' ').includes('not called by any npm script'),
    true,
  );

  // The other two conditions, so an entry cannot be hollow.
  expect('a non-issue owner fails', run({ ...base, owner: 'later' }).ok, false);
  expect('a one-word reason fails', run({ ...base, why: 'legacy' }).ok, false);

  // ⚠️ The collector must SEE a problem, or every pass above is unearned.
  expect('the evaluator returns one row per entry', evaluate([base, { ...base, id: 'y' }], '2026-11-20', opts).length, 2);

  console.log(failures === 0 ? '\n✅ self-test: E1 and E2 each report both directions' : `\n❌ self-test: ${failures} case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

function report(rows, today) {
  console.log(`\nAccepted debt — as at ${today}\n`);
  console.log('| id | holds | last reviewed | budget | state | owner |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) {
    const state = r.ok ? '✅ inside window' : `✖ ${r.problems[0]}`;
    console.log(`| \`${r.id}\` | ${r.holds} | ${r.age === null ? '??' : `${r.age}d ago`} | ${r.toleranceDays}d | ${state} | ${r.owner} |`);
  }
  console.log('\n⚠️ `holds` is the figure at the LAST REVIEW, not a live reading — the owning gate already');
  console.log('   refuses to let it grow. This check is about AGE, which nothing else measured.');
}

function review(id, reason) {
  if (!id) {
    console.error('[debt-expiry] ✖ --review needs an id: --review <id> --reason "<why it is still held>"');
    process.exit(2);
  }
  if (!reason || reason.trim().length < 20) {
    // ⚠️ NO SILENT EXTENSION. A one-word reason is how a clock becomes a formality.
    console.error('[debt-expiry] ✖ --reason is required and must be at least 20 characters.');
    console.error('  Say what was checked and why the debt still stands. If nothing was checked, do not extend it.');
    process.exit(2);
  }
  const parsed = JSON.parse(fs.readFileSync(REGISTER, 'utf8'));
  const entry = parsed.entries.find((e) => e.id === id);
  if (!entry) {
    console.error(`[debt-expiry] ✖ no entry with id '${id}'. Known: ${parsed.entries.map((e) => e.id).join(', ')}`);
    process.exit(2);
  }
  const today = new Date().toISOString().slice(0, 10);
  const was = entry.reviewedOn;
  entry.reviewedOn = today;
  entry.reason = reason.trim();
  fs.writeFileSync(REGISTER, `${JSON.stringify(parsed, null, 2)}\n`);
  console.log(`[debt-expiry] ${id}: reviewedOn ${was} → ${today}`);
  console.log(`  reason recorded: ${reason.trim()}`);
}

function main() {
  const argv = process.argv.slice(2);
  const KNOWN = new Set(['--report', '--review', '--reason', '--self-test', '--help']);
  const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN.has(a));
  if (unknown.length) {
    console.error(`[debt-expiry] ✖ unknown flag(s): ${unknown.join(', ')}`);
    process.exit(2);
  }
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--help')) {
    console.log('usage: node scripts/validate-debt-expiry.cjs [--report] [--review <id> --reason "<why>"] [--self-test]');
    return;
  }
  const reviewAt = argv.indexOf('--review');
  if (reviewAt !== -1) {
    const reasonAt = argv.indexOf('--reason');
    return review(argv[reviewAt + 1], reasonAt !== -1 ? argv[reasonAt + 1] : null);
  }

  let rows;
  const today = new Date().toISOString().slice(0, 10);
  try {
    rows = check(today);
  } catch (err) {
    console.error(`[debt-expiry] ✖ could not judge: ${err.message}`);
    process.exit(2);
  }
  if (argv.includes('--report')) return report(rows, today);

  const stale = rows.filter((r) => !r.ok);
  const total = rows.reduce((a, r) => a + (Number(r.holds) || 0), 0);
  console.log(`[debt-expiry] ${rows.length} accepted debt entr(ies), ${total} held item(s): ${stale.length} need looking at`);
  for (const r of stale) {
    console.log(`  ✖ ${r.id} (${r.owner}) — ${r.problems.join(' · ')}`);
    console.log(`      ${r.why}`);
  }
  if (stale.length) {
    console.log('[debt-expiry] Either pay some of it down, or record why it still stands:');
    console.log('    node scripts/validate-debt-expiry.cjs --review <id> --reason "<what you checked>"');
    process.exit(1);
  }
  console.log('[debt-expiry] ✅ every held debt is inside its review window');
}

if (require.main === module) main();

module.exports = { evaluate, ageInDays, check };
