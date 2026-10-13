#!/usr/bin/env node
/**
 * audit-ui-review.cjs — READ the owner's Page Walkthrough verdicts (`uiScore` + "Preferred
 * Elements" = `noteNew`) and report them, so the Appearance area can be built from what the owner
 * ACTUALLY approved rather than from what an agent assumes a good UI looks like.
 *
 * ⚠️ WHY THE DATABASE AND NOT THE API. The API (:3201) is DOWN right now — measured, `curl` returns
 * `health:000` (nothing listening). The data is not lost: it lives in `appsetting.value` (json),
 * which `scripts/lib/mysql-cli.cjs` can read without the app. Using the canonical store rather than
 * waiting for a service is the point — and it costs no restart, which several agents share.
 *
 * ⚠️ TWO SOURCES, AND THE DISAGREEMENT IS PRINTED. `nest/app-settings.json` is the mirror the service
 * writes on every update and the copy `settings.service.ts` says agents should read. A mirror is a
 * CLAIM about the database. So both are counted and compared, and a mismatch is reported rather than
 * silently resolved in favour of whichever one was read first.
 *
 * ⚠️ READ-ONLY BY CONSTRUCTION. SELECT only. Nothing here writes to the database.
 *
 * USAGE
 *   node scripts/audit-ui-review.cjs        # print the verdicts and write the raw export
 *
 * ⚠️ NO `--self-test`, AND THAT IS DELIBERATE. The repo rule (agent-environment.instructions.md) is
 * that a new audit script ships one, because a guard never observed to fail is a decoration. This
 * script is not a guard: it ASSERTS nothing about the data and CLASSIFIES nothing — it prints what it
 * reads, so there is no verdict of its own that can be wrong. Every failure mode is "cannot read",
 * and each exits non-zero with its reason (no row carries `$.uiReview.entries`; `JSON.parse` of the
 * stored value fails). If it is ever given a pass/fail verdict to produce, it needs a self-test with
 * it. The one comparison it does make — database vs file mirror — is printed, not resolved silently.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { query, connect } = require('./scripts/lib/mysql-cli.cjs');

const REPO = __dirname;
const MIRROR = path.join(REPO, 'nest', 'app-settings.json');
const OUT = path.join(REPO, 'logs', '2026-10-13-ui-review-export.json');

const die = (msg) => { console.error(`ERROR: ${msg}`); process.exit(1); };

// ── 1. Which row holds the walkthrough? Ask; do not guess the id. ──────────────────────────────────
const conn = connect();
const tsv = query(
  `SELECT id, JSON_LENGTH(JSON_EXTRACT(value, '$.uiReview.entries')) AS n, CHAR_LENGTH(value) AS bytes ` +
  `FROM appsetting ORDER BY n DESC`,
  conn,
);
const rows = tsv.split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split('\t'));
if (!rows.length) die('appsetting returned no rows — the database is reachable but empty, which is not what this expects.');

console.log('appsetting rows (id, uiReview entry count, bytes):');
rows.forEach((r) => console.log(`  ${(r[1] || 'null').padStart(6)}  ${(r[2] || '0').padStart(9)}  ${r[0]}`));

const target = rows.find((r) => Number(r[1]) > 0);
if (!target) die('no appsetting row carries $.uiReview.entries — the walkthrough has no stored verdicts.');

// ── 2. Canonical read from the database ────────────────────────────────────────────────────────────
// The JSON is fetched whole and parsed in Node. Doing the analysis in SQL would mean JSON_TABLE
// gymnastics in shell-quoted SQL, which is the quoting trap this repo has already paid for twice.
const raw = query(`SELECT value FROM appsetting WHERE id = '${target[0].replace(/'/g, "''")}'`, conn);
const jsonText = raw.split(/\r?\n/).slice(1).join('\n').trim();
let db;
try {
  db = JSON.parse(jsonText);
} catch (e) {
  die(`could not JSON.parse the stored value: ${e.message}. Do NOT conclude the data is corrupt — ` +
      `MySQL batch output escapes tabs/newlines, so a parse failure here is a transport problem first. ` +
      `First 200 chars: ${jsonText.slice(0, 200)}`);
}
const dbEntries = (db.uiReview && db.uiReview.entries) || {};
const dbKeys = Object.keys(dbEntries);

// ── 3. The mirror, and whether it agrees ───────────────────────────────────────────────────────────
let mirror = null, mirrorErr = null, mirrorMtime = null;
try {
  mirror = JSON.parse(fs.readFileSync(MIRROR, 'utf8'));
  mirrorMtime = fs.statSync(MIRROR).mtime.toISOString();
} catch (e) { mirrorErr = e.message; }
const mirrorEntries = (mirror && mirror.uiReview && mirror.uiReview.entries) || {};
const mirrorKeys = Object.keys(mirrorEntries);

const fmt = (iso) => (iso ? iso : '(none)');
const maxUpdated = (entries) => Object.values(entries).reduce((a, e) => (e.updatedAt > a ? e.updatedAt : a), '');

console.log('\n── WHERE THE DATA CAME FROM ────────────────────────────────────────────');
console.log(`canonical   : appsetting.id='${target[0]}'  →  ${dbKeys.length} entries`);
console.log(`mirror      : nest/app-settings.json  →  ${mirrorKeys.length} entries` +
  (mirrorErr ? `   ⚠️ UNREADABLE: ${mirrorErr}` : `   (mtime ${fmt(mirrorMtime)})`));
console.log(`agree       : ${dbKeys.length === mirrorKeys.length ? 'YES — counts match' : '⚠️ NO — counts differ, DB wins'}`);
console.log(`mirror newest updatedAt : ${fmt(maxUpdated(mirrorEntries))}`);
console.log(`DB     newest updatedAt : ${fmt(maxUpdated(dbEntries))}`);
const onlyDb = dbKeys.filter((k) => !mirrorEntries[k]);
const onlyMirror = mirrorKeys.filter((k) => !dbEntries[k]);
if (onlyDb.length) console.log(`⚠️ in DB only     (${onlyDb.length}): ${onlyDb.slice(0, 12).join(', ')}`);
if (onlyMirror.length) console.log(`⚠️ in mirror only (${onlyMirror.length}): ${onlyMirror.slice(0, 12).join(', ')}`);

// ── 4. What the owner actually recorded ────────────────────────────────────────────────────────────
const E = dbEntries; // canonical
const all = Object.entries(E).map(([k, v]) => ({ key: k, ...v }));
const scored = all.filter((e) => typeof e.uiScore === 'number');
const preferred = all.filter((e) => (e.noteNew || '').trim());
const oldNotes = all.filter((e) => (e.note || '').trim() && typeof e.uiScore === 'number');

console.log('\n── HOW MUCH IS ACTUALLY RECORDED ──────────────────────────────────────');
console.log(`pages with a verdict row     : ${all.length}`);
console.log(`pages with a UI/10 score     : ${scored.length}`);
console.log(`pages with Preferred Elements: ${preferred.length}`);
console.log(`pages with an OLD note       : ${all.filter((e) => (e.note || '').trim()).length}`);

console.log('\n── UI/10 SCORE DISTRIBUTION (from uiScore) ────────────────────────────');
for (let s = 10; s >= 1; s--) {
  const n = scored.filter((e) => e.uiScore === s).length;
  if (n) console.log(`  ${String(s).padStart(2)}/10  ${'█'.repeat(n).padEnd(30)} ${n}`);
}
console.log(`  unrated  ${all.filter((e) => e.uiScore == null).length}` +
  `   ⚠️ "unrated" is NOT "rated low" — it means the owner has not judged that page yet.`);

// ── 5. The preferred elements, best-scored first — this is the material ────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('PREFERRED ELEMENTS (noteNew) — highest-scoring pages first');
console.log('══════════════════════════════════════════════════════════════════════');
const ranked = all
  .filter((e) => (e.noteNew || '').trim() || typeof e.uiScore === 'number')
  .sort((a, b) => (b.uiScore ?? -1) - (a.uiScore ?? -1) || a.key.localeCompare(b.key));

for (const e of ranked) {
  const score = typeof e.uiScore === 'number' ? `${String(e.uiScore).padStart(2)}/10` : ' -- ';
  const flags = [
    e.noteApplied === true ? 'old:applied' : e.noteApplied === false ? 'old:OUTSTANDING' : 'old:-',
    e.noteNewApplied === true ? 'new:applied' : e.noteNewApplied === false ? 'new:OUTSTANDING' : 'new:-',
  ].join(' ');
  console.log(`\n${score}  ${e.key}   [${flags}]`);
  if ((e.noteNew || '').trim()) console.log(`   ★ PREFERRED: ${e.noteNew.replace(/\s*\n\s*/g, ' ').trim()}`);
  if ((e.note || '').trim()) console.log(`   · old note : ${e.note.replace(/\s*\n\s*/g, ' ').trim()}`);
}

// Export so the raw text can be re-read without re-querying (raw, not summarised — a derived
// summary hides the data it came from).
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: 'appsetting', id: target[0], exportedAt: new Date().toISOString(), entries: E }, null, 2), 'utf8');
console.log(`\nraw export written: ${path.relative(REPO, OUT)} (${dbKeys.length} entries, unmodified)`);
