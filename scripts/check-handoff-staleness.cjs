#!/usr/bin/env node
/**
 * check-handoff-staleness.cjs — a handoff that is written and never processed is invisible.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * The rule says a handoff is a WORK ORDER: written → processed (docs + changelog) → deleted. What
 * actually happened between 2026-09 and 2026-11 was written → *archived*, and 267 files accumulated
 * in a `processed/` folder that was not processed at all. Nothing failed. Nothing warned. The folder
 * simply grew, and the growth was invisible because a handoff has no due date on its face.
 *
 * This makes the age visible. It is deliberately the cheapest possible implementation of that idea:
 * the date is already in the filename, so the check needs no database, no front matter and no
 * cooperation from whoever wrote the file.
 *
 *   node scripts/check-handoff-staleness.cjs            # report; exit 1 when any handoff is stale
 *   node scripts/check-handoff-staleness.cjs --days 7   # change the threshold
 *   node scripts/check-handoff-staleness.cjs --report   # advisory: always exit 0
 *   node scripts/check-handoff-staleness.cjs --prebuild # BLOCKING on stale, tolerant when unmounted
 *   node scripts/check-handoff-staleness.cjs --dir <p>  # point at another folder (used to canary this)
 *   node scripts/check-handoff-staleness.cjs --self-test
 *
 * ⚠️ Exit 2 means "could not judge" — the docs store is not mounted. That is NOT a pass: the project's
 * G: drive drops out, and a check that reports clean while reading nothing is worse than no check.
 *
 * ⚠️ `--prebuild` IS THE ONE TOLERANCE, AND IT IS NARROW: a stale handoff fails the build (the
 * the brief asked for that), but an unmounted store returns 0 because a build must not go red for a
 * network drive. The failure and the tolerance are stated separately on purpose — collapsing them
 * would make "stale" indistinguishable from "could not look".
 */

const fs = require('node:fs');
const path = require('node:path');
const { agentHome } = require('./lib/agent-paths.cjs');

const DEFAULT_DAYS = 3;
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})-/;

/**
 * classify(files, now, days) — pure. Which handoffs are older than the threshold?
 * `files` is `[{ name, mtimeMs }]`; the DATE IN THE NAME wins, because a file copied from another
 * machine has a fresh mtime and a two-month-old date.
 */
function classify(files, now, days) {
  const stale = [];
  const undated = [];
  const fresh = [];
  const threshold = now - days * 24 * 60 * 60 * 1000;

  for (const f of files) {
    if (!f.name.endsWith('.md')) continue;
    const m = DATE_PREFIX.exec(f.name);
    if (!m) {
      // ⚠️ An undated handoff cannot be aged, so it cannot be triaged. It is reported separately
      // rather than silently ignored — "I cannot read it" must never look like "it is fine".
      if (!/^README\.md$|^ORPHAN-ARCHIVE-/.test(f.name)) undated.push(f.name);
      continue;
    }
    const stamp = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (stamp < threshold) stale.push({ name: f.name, ageDays: Math.floor((now - stamp) / 86_400_000) });
    else fresh.push(f.name);
  }
  return { stale: stale.sort((a, b) => b.ageDays - a.ageDays), undated, fresh };
}

function runSelfTest() {
  const now = Date.UTC(2026, 10, 17); // 2026-11-17
  const day = 86_400_000;
  let failures = 0;
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (!ok) {
      console.log(`   expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      failures += 1;
    }
  };

  // Direction 1 — a handoff old enough IS reported, with its age.
  check(
    'a 10-day-old handoff is stale (3-day threshold)',
    classify([{ name: '2026-11-07-a.md' }], now, 3).stale.map((s) => s.name),
    ['2026-11-07-a.md'],
  );
  // Direction 2 — a fresh one is NOT (proves the checker is not "always fire").
  check('a today handoff is fresh', classify([{ name: '2026-11-17-b.md' }], now, 3).stale, []);
  // Direction 3 — the boundary: exactly N days old is NOT stale (inclusive comparison stated).
  check('exactly 3 days old is still fresh', classify([{ name: '2026-11-14-c.md' }], now, 3).stale, []);
  check('3 days + 1 day is stale', classify([{ name: '2026-11-13-d.md' }], now, 3).stale.map((s) => s.name), ['2026-11-13-d.md']);
  // Direction 4 — the DATE beats the mtime: a copied old file has a new mtime and must still be stale.
  check(
    'mtime cannot rescue an old dated file',
    classify([{ name: '2026-09-01-e.md', mtimeMs: now }], now, 3).stale.map((s) => s.name),
    ['2026-09-01-e.md'],
  );
  // Direction 5 — an undated file is surfaced, never silently passed.
  check('an undated file is reported as un-ageable', classify([{ name: 'notes.md' }], now, 3).undated, ['notes.md']);
  // Direction 6 — the archive and the README are not handoffs.
  check('ORPHAN-ARCHIVE and README are ignored', classify([{ name: 'ORPHAN-ARCHIVE-2026-09-27.md' }, { name: 'README.md' }], now, 3).undated, []);
  // Direction 7 — ordering: oldest first, because that is what should be processed next.
  check(
    'stale list is oldest-first',
    classify([{ name: '2026-11-07-a.md' }, { name: '2026-09-01-e.md' }], now, 3).stale.map((s) => s.name),
    ['2026-09-01-e.md', '2026-11-07-a.md'],
  );

  console.log(failures === 0 ? '\nALL SELF-TESTS OK' : `\n${failures} SELF-TEST FAILURE(S)`);
  return failures === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return runSelfTest();

  const reportOnly = argv.includes('--report');
  const prebuild = argv.includes('--prebuild');
  const dIdx = argv.indexOf('--days');
  const days = dIdx >= 0 ? Number(argv[dIdx + 1]) : DEFAULT_DAYS;
  const dirIdx = argv.indexOf('--dir');
  const dir = dirIdx >= 0 ? argv[dirIdx + 1] : path.join(agentHome(), '..', 'handoff');

  if (!fs.existsSync(dir)) {
    console.log(`[handoffs] ⚠ SKIPPED — the handoff folder is not mounted (${dir}). This is NOT a pass.`);
    // In prebuild a missing store is tolerated (network drive); everywhere else it is exit 2.
    return prebuild ? 0 : 2;
  }

  const files = fs.readdirSync(dir).map((name) => ({ name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }));
  const { stale, undated } = classify(files, Date.now(), days);

  console.log(`[handoffs] ${files.length} file(s), threshold ${days} day(s)`);
  if (undated.length) {
    console.log(`[handoffs] ⚠ ${undated.length} file(s) carry no date and cannot be aged: ${undated.join(', ')}`);
  }
  if (stale.length === 0) {
    console.log('[handoffs] ✅ no stale handoff');
    return 0;
  }

  console.log(`[handoffs] 🛑 ${stale.length} handoff(s) older than ${days} day(s) — process or delete:`);
  for (const s of stale) console.log(`   ${s.ageDays}d  ${s.name}`);
  console.log(
    '\n   Processing means: documentation updated (all nine surfaces) AND a changelog line for the\n' +
      '   version it ships in, THEN the file is deleted. See agent-handoff.instructions.md.',
  );
  return reportOnly ? 0 : 1;
}

if (require.main === module) {
  const code = main();
  process.exit(code);
}

module.exports = { classify, DEFAULT_DAYS };
