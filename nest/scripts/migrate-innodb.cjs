/**
 * #613 — convert MyISAM tables to InnoDB, one at a time, verifying every step.
 *
 * Usage:
 *   node logs/migrate-innodb.cjs --dry              list + counts, change nothing
 *   node logs/migrate-innodb.cjs --under 1          convert every table under 1 MB
 *   node logs/migrate-innodb.cjs --over 1           convert every table of 1 MB or more
 *   node logs/migrate-innodb.cjs --table marketbar  convert one table
 *
 * WHY A SCRIPT AND NOT A GENERATED ALTER LIST: every conversion is verified in the same breath —
 * exact row count before, exact row count after, and `CHECK TABLE` — because an engine conversion
 * that silently drops rows looks exactly like a successful one. Measured precedent on this database:
 * `REPAIR TABLE` reported "Number of rows changed from 12667 to 12665", i.e. a repair that lost two
 * rows and said it worked.
 *
 * ⚠️ NOT IDEMPOTENT BY DESIGN IN ONE RESPECT: a table already InnoDB is SKIPPED, never re-converted.
 * Re-running is therefore safe.
 *
 * ⚠️ A CRASHED TABLE IS REFUSED, never repaired. `ALTER TABLE` on a crashed MyISAM table either
 * fails or, worse, copies the corruption. The caller must decide; this script only reports.
 *
 * ⚠️ `prisma db push` remains banned (#769). This is `ALTER TABLE`, which changes the ENGINE and
 * nothing else — no column, no index, no data.
 */
const { query, connect } = require('../scripts/lib/mysql-cli.cjs');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };
const DRY = has('--dry');
const c = connect();

const q = (sql) => {
  try { return query(sql, c).replace(/\r/g, '').trim(); }
  catch (e) { return `ERR ${e.message.split('\n')[0]}`; }
};
const rowsOf = (text) => text.split('\n').slice(1).map((l) => l.split('\t'));

const all = rowsOf(q(`
  SELECT TABLE_NAME, ENGINE, TABLE_ROWS,
         ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576, 2) mb
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = 'tradingcs' AND TABLE_TYPE = 'BASE TABLE'
  ORDER BY (DATA_LENGTH + INDEX_LENGTH) ASC
`));

let targets = all.filter((r) => r[1] === 'MyISAM');

const under = val('--under');
const over = val('--over');
const one = val('--table');
if (one) targets = targets.filter((r) => r[0] === one);
else if (under) targets = targets.filter((r) => Number(r[3]) < Number(under));
else if (over) targets = targets.filter((r) => Number(r[3]) >= Number(over));

console.log(`MyISAM tables in scope: ${targets.length}`);
if (DRY) {
  for (const r of targets) console.log(`  ${r[0].padEnd(42)} ${String(Math.round(Number(r[2]))).padStart(9)} rows  ${r[3]} MB`);
  console.log(`\nTOTAL ${targets.reduce((a, r) => a + Number(r[3]), 0).toFixed(1)} MB — dry run, nothing changed.`);
  process.exit(0);
}

const failures = [];
let converted = 0;
let skipped = 0;

for (const [name, , approxRows, mb] of targets) {
  const countOf = () => {
    const t = q(`SELECT COUNT(*) n FROM \`${name}\``);
    if (t.startsWith('ERR')) return null;
    return Number(t.split('\n')[1]);
  };

  const check = q(`CHECK TABLE \`${name}\``);
  if (!/\bOK\b/.test(check.split('\n').pop() || '')) {
    failures.push({ name, why: `CRASHED/UNHEALTHY — refused, not repaired: ${check.split('\n').slice(1).join(' | ')}` });
    skipped += 1;
    continue;
  }

  const before = countOf();
  if (before === null) {
    failures.push({ name, why: 'could not read a row count before conversion — refusing to convert blind' });
    skipped += 1;
    continue;
  }

  const t0 = Date.now();
  const alter = q(`ALTER TABLE \`${name}\` ENGINE=InnoDB`);
  const ms = Date.now() - t0;
  if (alter.startsWith('ERR')) {
    failures.push({ name, why: `ALTER failed: ${alter}` });
    skipped += 1;
    continue;
  }

  const after = countOf();
  const engine = q(`SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='tradingcs' AND TABLE_NAME='${name}'`)
    .split('\n')[1];
  const checkAfter = q(`CHECK TABLE \`${name}\``);
  const clean = /\bOK\b/.test(checkAfter.split('\n').pop() || '');

  if (after !== before) {
    failures.push({ name, why: `ROW COUNT CHANGED ${before} → ${after}` });
  } else if (engine !== 'InnoDB') {
    failures.push({ name, why: `engine reports ${engine}` });
  } else if (!clean) {
    failures.push({ name, why: `CHECK TABLE after conversion: ${checkAfter.split('\n').slice(1).join(' | ')}` });
  } else {
    converted += 1;
    console.log(`  ✅ ${name.padEnd(42)} ${String(before).padStart(9)} rows  ${mb} MB  ${ms}ms`);
  }
}

console.log(`\nconverted ${converted} · skipped ${skipped} · failures ${failures.length}`);
for (const f of failures) console.log(`  ❌ ${f.name}: ${f.why}`);
const remaining = rowsOf(q("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA='tradingcs' AND ENGINE='MyISAM'"))[0][0];
console.log(`MyISAM tables remaining in the schema: ${remaining}`);
process.exit(failures.length ? 1 : 0);
