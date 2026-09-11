#!/usr/bin/env node
/**
 * diff-seed-vs-db.cjs — detect drift between the seed file and the database
 * =======================================================================
 * Created 2026-09-11.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ProtocolDbService.seedProtocolsToDatabase()` is **upsert-only** — it creates and
 * updates but NEVER deletes. Therefore:
 *
 *   - removing a directive from the seed does NOT remove its DB row
 *   - moving a directive between groups does NOT move its DB row
 *   - re-seeding CANNOT converge them
 *
 * The failure is silent and the diagnostic lies: the seed endpoint responds with
 * `entries: N`, which counts rows **UPSERTED**, not rows that **EXIST**. So it
 * reads exactly like a successful removal. Measured 2026-09-11: after removing 15
 * placements and re-seeding, the endpoint said `entries: 419` (down from 434)
 * while the database still held all 14 obsolete rows.
 *
 * The consequence for the project owner's question ("why so many issues despite
 * repeated work?") is direct: **an agent can apply a correct fix to the seed, see
 * a green re-seed, and the live system is unchanged.** The next agent then finds
 * the same defect, because it was never actually removed. That is a loop
 * generator, and this script is the detector for it.
 *
 * WHAT THIS DOES
 * --------------
 * Compares, per protocol and per group:
 *   - the SEED's placement set  (parsed from protocols-seed-data.ts)
 *   - the DB's placement set    (queried over mysql CLI)
 * and reports three classes of difference:
 *
 *   ORPHAN  — in the DB, absent from the seed  → the seeder cannot delete it.
 *             This is the dangerous one: it is invisible config that is still live.
 *   MISSING — in the seed, absent from the DB  → a re-seed would add it.
 *   MOVED   — present in both but in a different group (esp. gate → scoring or
 *             scoring → gate, which changes whether it scores at all).
 *
 * Read-only. Reports; never writes.
 *
 * USAGE (from repo root)
 *   node scripts/diff-seed-vs-db.cjs
 *   node scripts/diff-seed-vs-db.cjs --protocol mt5-technical-core-v1
 * Exit code: 0 if in sync, 1 if drift detected (so it can be used in a check).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SEED = path.join(REPO_ROOT, 'nest', 'src', 'modules', 'scoring', 'protocols-seed-data.ts');
const MYSQL = 'C:\\wamp64\\bin\\mysql\\mysql9.1.0\\bin\\mysql.exe';
const DB_ARGS = ['-u', 'tradingcs', '-ptradingcs_dev_2026', 'tradingcs', '-N', '-B'];

const onlyIdx = process.argv.indexOf('--protocol');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

// ── seed side ────────────────────────────────────────────────────────────────

/**
 * Parse `protocols-seed-data.ts` into
 *   Map<protocolSlug, Map<groupId, {isRiskGate, directiveIds:Set}>>
 *
 * Indentation-tracked, same approach as the other seed analysers. The file is
 * generated and indentation-regular; a shape mismatch is REPORTED, never silently
 * treated as "no drift" — an empty parse would make this script useless while
 * appearing to pass.
 */
function parseSeed() {
  const lines = fs.readFileSync(SEED, 'utf8').split(/\r?\n/);
  const protocols = new Map();

  let slug = null;
  let groupId = null;
  let group = null;
  let inIds = false;

  for (const line of lines) {
    const proto = line.match(/^ {2}"([^"]+)":\s*\{/);
    if (proto) {
      slug = proto[1];
      if (!protocols.has(slug)) protocols.set(slug, new Map());
      groupId = null;
      group = null;
      inIds = false;
      continue;
    }
    if (!slug) continue;

    const gid = line.match(/^ {8}"id":\s*"([^"]+)"/);
    if (gid) {
      groupId = gid[1];
      group = { isRiskGate: false, directiveIds: new Set() };
      protocols.get(slug).set(groupId, group);
      inIds = false;
      continue;
    }

    const gate = line.match(/^ {8}"isRiskGate":\s*(true|false)/);
    if (gate && group) {
      group.isRiskGate = gate[1] === 'true';
      continue;
    }

    if (/^\s*"directiveIds":\s*\[/.test(line)) {
      inIds = true;
      continue;
    }
    if (inIds) {
      if (/^\s*\]/.test(line)) {
        inIds = false;
        continue;
      }
      const id = line.match(/^\s*"([^"]+)"\s*,?\s*$/);
      if (id && group) group.directiveIds.add(id[1]);
    }
  }

  return protocols;
}

// ── db side ──────────────────────────────────────────────────────────────────

function query(sql) {
  try {
    const out = execFileSync(MYSQL, [...DB_ARGS, '-e', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split('\t'));
  } catch (err) {
    console.error(`\n[diff-seed-vs-db] ✖ mysql query failed: ${err.message}`);
    console.error(`  Is MySQL running and is the CLI at ${MYSQL}?`);
    process.exit(2);
  }
}

/** protocol slug -> group NAME -> {isRiskGate, directiveIds:Set} */

/**
 * ⚠️ THE BLIND SPOT THIS FIXES (found 2026-09-11)
 * -------------------------------------------------
 * The previous version built the DB map ONLY from a query joining
 * `protocol_directive_entry -> protocol_directive_group -> protocol`. That is an
 * INNER join, so a protocol with **zero entries** never appeared on the DB side —
 * even though its `protocol` row exists.
 *
 * The result was a report that said the opposite of the truth: `060ed261-…` and
 * `signals-workbench` were printed as `PROTOCOL-ONLY-IN-SEED` ("a re-seed would
 * create it") when BOTH already existed as `protocol` rows. That false report was
 * handed to the owner as a decision needing their input, and it did not exist.
 *
 * A diagnostic that INVENTS a discrepancy is worse than no diagnostic: it spends a
 * human's attention on a non-problem and teaches them to distrust the tool. This is
 * the third precision bug in the tooling built on 2026-09-11, and the reason the
 * rule is now explicit — **always load the spine table independently of its children.**
 */
function loadDbProtocols() {
  const rows = query(`SELECT slug FROM protocol`);
  return new Set(rows.map((r) => r[0]));
}

function loadDb() {
  // ⚠️ JOIN ON `g.groupId`, NOT `g.id`.
  // ------------------------------------------------------------------
  // `protocol_directive_group` has TWO identifiers and picking the wrong one
  // makes this whole script report 419 phantom "MOVED" rows:
  //
  //   id       varchar(36)  — the row's UUID (what protocol_directive_entry.groupId points at)
  //   groupId  varchar(50)  — the NAME, e.g. "technical" / "risk" (what the SEED uses)
  //
  // The seed keys groups by NAME. So to compare seed↔DB we must read `g.groupId`.
  // Joining `protocol_directive_entry.groupId = g.id` is required to RESOLVE the
  // group, but then we must report `g.groupId` as the key. Getting this wrong
  // produced 419 false "same directive, different group" findings on first run —
  // a detector that cries wolf on healthy data is worse than none.
  const rows = query(`
    SELECT p.slug, g.groupId, g.isRiskGate, e.directiveId
      FROM protocol_directive_entry e
      JOIN protocol_directive_group g
             ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
      JOIN protocol p
             ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
  `);

  const db = new Map();
  for (const [slug, groupName, isGate, directiveId] of rows) {
    if (!db.has(slug)) db.set(slug, new Map());
    const groups = db.get(slug);
    if (!groups.has(groupName)) {
      groups.set(groupName, { isRiskGate: isGate === '1' || isGate === 'true', directiveIds: new Set() });
    }
    groups.get(groupName).directiveIds.add(directiveId);
  }
  return db;
}

/**
 * Protocols that are empty on BOTH sides BY DESIGN, so they are acknowledged as
 * known-and-accepted rather than reported as drift on every run.
 *
 * ⚠️ WHY AN ALLOWLIST EXISTS HERE AT ALL
 * --------------------------------------
 * This is the ONE case in this script where "in both, but empty" is benign. Both
 * entries were INVESTIGATED before being accepted (2026-09-11), because an
 * allowlist that swallows a real problem is worse than no check. Each carries the
 * evidence that makes it benign:
 *
 *   1. `signals-workbench` — a WORKBENCH protocol. Its scores are written by
 *      `SignalEnvelopeService.persistScores()` (`score-history.service.ts` L54), not
 *      computed through the gated scoring pipeline, so it legitimately has no groups.
 *      This is also why `ProtocolHealthService` warns "no risk-gate group" for it —
 *      that warning is expected, not a fault. `active: 1` is correct.
 *
 *   2. `060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d` — an ABANDONED PLACEHOLDER. A real
 *      protocol row ("Conviction Dip Accumulation", created 2026-07-26) that was never
 *      configured: `active: 0`, **0 groups in BOTH the seed and the DB**, and nothing
 *      references it (verified across `protocol_directive_group`,
 *      `symbol_protocol_assignment`, `watchlist`). Its slug is a UUID because the row
 *      was created with the id copied into the slug field.
 *
 * ⚠️ Deleting a `protocol` row is a DATA decision, not a config fix, so it is left in
 * place deliberately. If it is ever removed, DELETE THE ENTRY BELOW — a stale
 * allowance would then hide a future protocol that genuinely has no configuration.
 */
const KNOWN_EMPTY_BY_DESIGN = new Map([
  [
    'signals-workbench',
    'workbench protocol — populated by SignalEnvelopeService.persistScores(), not the gated pipeline (score-history.service.ts L54)',
  ],
  [
    '060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d',
    'abandoned placeholder created 2026-07-26 — active:0, nothing references it; slug is a UUID because the id was copied into it',
  ],
]);

// ── comparison ───────────────────────────────────────────────────────────────

function flat(map) {
  // Set of "groupId::directiveId" plus a lookup of directive -> group(s).
  const byDirective = new Map();
  for (const [gid, g] of map) {
    for (const d of g.directiveIds) {
      if (!byDirective.has(d)) byDirective.set(d, []);
      byDirective.get(d).push(gid);
    }
  }
  return byDirective;
}

const seed = parseSeed();
const dbProtocols = loadDbProtocols();
const db = loadDb();

// A protocol can exist as a row with NO entries. Include it in the DB map so it is
// never misreported as "seed-only" (see the loadDbProtocols() note above).
for (const slug of dbProtocols) {
  if (!db.has(slug)) db.set(slug, new Map());
}

let seedCount = 0;
let dbCount = 0;
for (const groups of seed.values()) for (const g of groups.values()) seedCount += g.directiveIds.size;
for (const groups of db.values()) for (const g of groups.values()) dbCount += g.directiveIds.size;

console.log('\n' + '─'.repeat(74));
console.log('  SEED vs DATABASE drift');
console.log('─'.repeat(74));
console.log(`  seed file : ${path.relative(REPO_ROOT, SEED)}`);
console.log(`  seed      : ${seed.size} protocols, ${seedCount} placements`);
console.log(`  database  : ${db.size} protocols, ${dbCount} placements`);

if (seed.size === 0) {
  console.error('\n  ✖ parsed ZERO protocols from the seed — this script cannot report drift.');
  console.error('    Fix parseSeed() before trusting any output below.\n');
  process.exit(2);
}

const slugs = [...new Set([...seed.keys(), ...db.keys()])].sort();
const problems = [];
/** Known-benign findings, listed separately so they do not mask real drift. */
const acknowledged = [];

for (const slug of slugs) {
  if (ONLY && slug !== ONLY) continue;

  const seedGroups = seed.get(slug);
  const dbGroups = db.get(slug);

  if (!seedGroups) {
    problems.push({ kind: 'PROTOCOL-ONLY-IN-DB', slug, detail: `${dbGroups.size} groups — the seeder cannot delete a protocol` });
    continue;
  }
  if (!dbGroups) {
    problems.push({ kind: 'PROTOCOL-ONLY-IN-SEED', slug, detail: `${seedGroups.size} groups — a re-seed would create it` });
    continue;
  }

  // ⚠️ A protocol present in BOTH but with ZERO groups in the seed is NOT "seed-only".
  // Its DB rows are not orphans either — the seed simply declares no placements, so a
  // re-seed would not touch them. Reporting this as PROTOCOL-ONLY-IN-SEED was WRONG and
  // was handed to the owner as a decision that did not exist (`060ed261-…`, 2026-09-11).
  // It is still worth surfacing — an empty shell protocol with live DB rows means the DB
  // holds config the seed does not describe — but it needs the correct label so the
  // reader can judge it. This is the ONLY case where "in both" can still be drift.
  if (seedGroups.size === 0 && dbGroups.size > 0) {
    const dirs = [...flat(dbGroups).keys()].sort();
    problems.push({
      kind: 'SEED-DECLARES-NO-GROUPS',
      slug,
      detail:
        `present in BOTH, but the seed declares 0 groups while the DB holds ${dbGroups.size} group(s) ` +
        `with ${dirs.length} directive(s) [${dirs.slice(0, 6).join(', ')}${dirs.length > 6 ? ', …' : ''}] — ` +
        `the seed does not describe this protocol's configuration at all`,
    });
    continue;
  }
  if (seedGroups.size === 0 && dbGroups.size === 0) {
    // Empty shell in both places. Benign ONLY if it is on the investigated allowlist;
    // otherwise report it, because a protocol with no configuration cannot score and
    // the reader should know we found one.
    if (KNOWN_EMPTY_BY_DESIGN.has(slug)) {
      acknowledged.push(`${slug} — ${KNOWN_EMPTY_BY_DESIGN.get(slug)}`);
      continue;
    }
    problems.push({
      kind: 'EMPTY-BOTH-SIDES',
      slug,
      detail:
        `0 groups in the seed AND 0 groups in the DB — this protocol cannot score anything. ` +
        `If that is deliberate, add it to KNOWN_EMPTY_BY_DESIGN in this script WITH the evidence, ` +
        `and note it in docs/SETTLED-DECISIONS.md.`,
    });
    continue;
  }

  const seedByDir = flat(seedGroups);
  const dbByDir = flat(dbGroups);

  const allDirs = [...new Set([...seedByDir.keys(), ...dbByDir.keys()])].sort();

  for (const d of allDirs) {
    const seedIn = seedByDir.get(d) || [];
    const dbIn = dbByDir.get(d) || [];

    if (seedIn.length === 0) {
      const gateInfo = dbIn.map((g) => `${g}${dbGroups.get(g).isRiskGate ? ' (GATE)' : ''}`).join(', ');
      problems.push({ kind: 'ORPHAN', slug, directive: d, detail: `in DB group(s) ${gateInfo}, absent from the seed` });
      continue;
    }
    if (dbIn.length === 0) {
      problems.push({ kind: 'MISSING', slug, directive: d, detail: `in seed group(s) ${seedIn.join(', ')}, absent from the DB` });
      continue;
    }
    // Both present — detect a group change, and whether the kind changed.
    const seedSet = new Set(seedIn);
    const dbSet = new Set(dbIn);
    const onlySeed = seedIn.filter((g) => !dbSet.has(g));
    const onlyDb = dbIn.filter((g) => !seedSet.has(g));
    if (onlySeed.length || onlyDb.length) {
      const flip = (gs, map) => gs.map((g) => (map.get(g)?.isRiskGate ? 'GATE' : 'scoring')).join('/');
      const seedKind = flip(seedIn, seedGroups);
      const dbKind = flip(dbIn, dbGroups);
      problems.push({
        kind: seedKind === dbKind ? 'MOVED' : 'KIND-CHANGED',
        slug,
        directive: d,
        detail: `seed ${seedKind} [${seedIn.join(', ')}]  vs  db ${dbKind} [${dbIn.join(', ')}]`,
      });
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────

const byKind = problems.reduce((acc, p) => {
  acc[p.kind] = (acc[p.kind] || 0) + 1;
  return acc;
}, {});

// A drift report is only meaningful if BOTH sides were actually read. If the DB map
// came back empty (bad credentials, DB down, wrong schema) every seed protocol would
// read as MISSING — a report of hundreds of problems that are really one connection
// failure. Refuse to render a conclusion from a half-built comparison.
// ⚠️ This guard runs BEFORE the report and prints nothing on success, so `drift:` is
// emitted exactly once. (An earlier revision printed it twice.)
if (db.size === 0 && seed.size > 0) {
  console.error('\n  ✖ the database side is EMPTY — cannot compare.');
  console.error('    Every seed protocol would falsely report as MISSING.');
  console.error('    Check MySQL is running and the credentials in this script are current.\n');
  process.exit(2);
}

console.log(`\n  drift: ${problems.length} difference(s)` + (problems.length ? ` — ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')}` : ''));

if (!problems.length) {
  if (acknowledged.length) {
    console.log(`\n  ✅ seed and database agree exactly. ${acknowledged.length} known-benign item(s) acknowledged:`);
    for (const a of acknowledged) console.log(`      · ${a}`);
    console.log('');
  } else {
    console.log('\n  ✅ seed and database agree exactly.\n');
  }
  process.exit(0);
}

const ORDER = [
  'ORPHAN',
  'KIND-CHANGED',
  'MOVED',
  'MISSING',
  'SEED-DECLARES-NO-GROUPS',
  'EMPTY-BOTH-SIDES',
  'PROTOCOL-ONLY-IN-DB',
  'PROTOCOL-ONLY-IN-SEED',
];
const EXPLAIN = {
  ORPHAN: 'live in the DB but gone from the seed — the seeder cannot delete these. Still ACTIVE config.',
  'KIND-CHANGED': '⚠️ the gate/scoring kind differs, so whether it SCORES AT ALL differs. Highest-risk drift.',
  MOVED: 'same directive, different group — affects scoring if the group weight or gate status differs.',
  MISSING: 'in the seed only — a re-seed would add it.',
  'SEED-DECLARES-NO-GROUPS':
    'the protocol exists in both, but the SEED has no configuration for it (0 groups) while the DB does. ' +
    'A re-seed will NOT change these DB rows. Decide the intent: seed the groups, or clear the DB rows.',
  'EMPTY-BOTH-SIDES': 'exists in both with no configuration — it cannot score. Probably an abandoned placeholder.',
  'PROTOCOL-ONLY-IN-DB': 'the seeder cannot remove a protocol.',
  'PROTOCOL-ONLY-IN-SEED': 'a re-seed would create this protocol.',
};

for (const kind of ORDER) {
  const rows = problems.filter((p) => p.kind === kind);
  if (!rows.length) continue;
  console.log(`\n  ${kind}  (${rows.length})`);
  console.log(`     ${EXPLAIN[kind]}`);
  for (const r of rows.slice(0, 40)) {
    console.log(`     · ${r.slug}${r.directive ? ' :: ' + r.directive : ''}`);
    console.log(`         ${r.detail}`);
  }
  if (rows.length > 40) console.log(`     … and ${rows.length - 40} more`);
}

console.log(`
  👉 TO FIX: the seeder is ADDITIVE-ONLY, so drift needs explicit SQL.
     Re-seed FIRST (adds/re-points what the seed now says), THEN delete orphans:

       SELECT ... to review
       DELETE e FROM protocol_directive_entry e
         JOIN protocol_directive_group g
                ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
        WHERE <the orphan condition>;

     ⚠️ NEVER use \`prisma db push\` to "fix" this — it drops 10 raw-managed
        tables including the trade execution queue. See INV-* / #769.
`);

process.exit(1);
