#!/usr/bin/env node
/**
 * validate-roadmap-columns.cjs — the DECLARED column order must match the GENERATED one
 * =====================================================================================
 * Created 2026-09-15, when `next-sprint` was moved to the second column.
 *
 * WHY THIS EXISTS
 * ---------------
 * The roadmap board's column order is a **declared↔generated pair**:
 *
 *   src/core/roadmap/roadmap-config.json  →  defaultColumns   ← THE DECLARATION (hand-written)
 *   src/core/roadmap/roadmap-data.json    →  columns          ← THE GENERATED SNAPSHOT
 *                                                               (`npm run roadmap:sync` copies it)
 *
 * The NestJS board (`RoadmapService.getBoard()`) reads **only the generated file**, so editing the
 * config alone changes nothing until a sync runs — and editing the generated file alone is lost
 * the next time a sync runs. The two drift in opposite directions and **neither fails loudly**.
 * That is the same shape as the seed-vs-DB drift this repo already guards with
 * `scripts/diff-seed-vs-db.cjs`.
 *
 * ⚠️ AND THE ORDER IS NOT COSMETIC. It is *semantic* — it is the left→right sequence, and both
 * sides of the dependency validator use it to decide whether a blocker sits "in a later column":
 *
 *   src/core/roadmap/roadmap-core.js   validateMove()  — client-side, blocks the drop
 *   nest/src/modules/roadmap/roadmap.service.ts moveCard() — server-side, rejects the move
 *
 * Because both read the SAME array, they always agree with each other — but a drift between the
 * declaration and the snapshot means the board enforces dependencies in an order nobody declared.
 * The symptom is a drag that is refused (or allowed) for no visible reason, with no error text.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. Both files parse, and `defaultColumns` / `columns` are non-empty arrays of {id,title,kind}.
 *   2. The two arrays are identical — same order, same length, same id/title/kind per index.
 *   3. No duplicate column ids in the declaration (a duplicate makes the order ambiguous).
 *
 * Usage:  node scripts/validate-roadmap-columns.cjs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'src', 'core', 'roadmap', 'roadmap-config.json');
const DATA_PATH = path.join(REPO_ROOT, 'src', 'core', 'roadmap', 'roadmap-data.json');

function readJson(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`[roadmap-columns] ✖ ${label} not found: ${path.relative(REPO_ROOT, p)}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`[roadmap-columns] ✖ ${label} is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}

const config = readJson(CONFIG_PATH, 'roadmap-config.json');
const data = readJson(DATA_PATH, 'roadmap-data.json');

const declared = config.defaultColumns;
const generated = data.columns;

const problems = [];

if (!Array.isArray(declared) || declared.length === 0) {
  problems.push('roadmap-config.json → defaultColumns is missing, not an array, or empty');
}
if (!Array.isArray(generated) || generated.length === 0) {
  problems.push('roadmap-data.json → columns is missing, not an array, or empty');
}

if (problems.length === 0) {
  const ids = declared.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) {
    problems.push(`duplicate column id(s) in defaultColumns: ${[...new Set(dupes)].join(', ')}`);
  }
  for (const [i, c] of declared.entries()) {
    if (!c?.id || !c?.title || !c?.kind) {
      problems.push(`defaultColumns[${i}] needs id + title + kind (got ${JSON.stringify(c)})`);
      break;
    }
  }

  for (const side of [
    ['declaration', declared],
    ['snapshot', generated],
  ]) {
    const [name, list] = side;
    if (list.length !== declared.length) {
      problems.push(
        `${name} has ${list.length} column(s), the other side has ${declared.length} — ` +
          're-run `npm run roadmap:sync`, or hand-copy the change into roadmap-data.json',
      );
      continue;
    }
    for (let i = 0; i < list.length; i++) {
      const a = declared[i];
      const b = list[i];
      if (a.id !== b.id || a.title !== b.title || a.kind !== b.kind) {
        problems.push(
          `${name} differs at index ${i}: ` +
            `${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
        );
      }
    }
  }
}

const order = (generated || []).map((c) => c.id).join(' , ');

if (problems.length === 0) {
  console.log(`[roadmap-columns] declared ${declared.length} column(s), snapshot matches`);
  console.log(`[roadmap-columns] order: ${order}`);
  console.log('\n[roadmap-columns] ✅ OK — declared column order and generated snapshot agree\n');
  process.exit(0);
}

console.error(`\n[roadmap-columns] ✖ ${problems.length} problem(s):\n`);
for (const p of problems) console.error(`  ✖ ${p}`);
console.error(
  '\n  The board reads ONLY src/core/roadmap/roadmap-data.json, so a change to\n' +
    '  roadmap-config.json → defaultColumns is inert until the snapshot is updated.\n' +
    '  ⚠️ Do not run `npm run roadmap:sync` casually — it rebuilds the snapshot from GitHub\n' +
    '  labels and RESETS sprint placements. Verify the intended column change by hand instead.\n' +
    `\n  declared : ${(declared || []).map((c) => c.id).join(' , ')}\n` +
    `  snapshot : ${order}\n`,
);
process.exit(1);
