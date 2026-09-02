#!/usr/bin/env node
/**
 * Roadmap sync (epic #681, Phase B)
 * =================================
 * Build-time script: pulls GitHub issues via `gh` and writes the roadmap
 * dataset in the agreed contract shape (see docs/roadmap-core-spec.md).
 *
 *   node scripts/roadmap-sync.cjs            # uses repo from roadmap-config.json
 *   node scripts/roadmap-sync.cjs --repo owner/name   # override
 *
 * Output: src/core/roadmap/roadmap-data.json
 * Column derivation: GitHub labels → columns via roadmap-config.json
 * labelToColumn; anything without a phase label lands in "triage".
 * Interactive state (positions, owners, deps) is NOT touched — the API
 * merges it at runtime.
 */
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'src', 'core', 'roadmap', 'roadmap-config.json');
const OUT_PATH = path.join(ROOT, 'src', 'core', 'roadmap', 'roadmap-data.json');

const argv = process.argv.slice(2);
const repoOverride = argv.includes('--repo') ? argv[argv.indexOf('--repo') + 1] : null;
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const repo = repoOverride || config.repo;

const JSON_FIELDS =
  'number,title,state,labels,assignees,createdAt,updatedAt,closedAt,comments';

console.log(`↺ Roadmap sync — ${repo} (limit 1000 issues)`);
const raw = execFileSync('gh', [
  'issue', 'list',
  '--repo', repo,
  '--state', 'all',
  '--limit', '1000',
  '--json', JSON_FIELDS,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const issues = JSON.parse(raw);
if (issues.length >= 1000) {
  console.warn('⚠️  Hit the 1000-issue cap — pagination not implemented yet.');
}

const colById = new Map(config.defaultColumns.map((c) => [c.id, c]));
const columnIdFor = (labels) => {
  for (const label of labels) {
    const mapped = config.labelToColumn[label];
    if (mapped && colById.has(mapped)) return mapped;
  }
  return 'triage';
};

const cards = issues
  .map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state.toLowerCase(),
    labels: i.labels.map((l) => l.name),
    assignee: i.assignees?.[0]?.login || null,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    closedAt: i.closedAt,
    comments: typeof i.comments === 'number' ? i.comments : i.comments?.totalCount || 0,
    columnId: columnIdFor(i.labels.map((l) => l.name)),
  }))
  .sort((a, b) => a.number - b.number);

const dataset = {
  generatedAt: new Date().toISOString(),
  columns: config.defaultColumns,
  cards,
};

writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 2) + '\n', 'utf8');

const byColumn = new Map();
for (const c of cards) byColumn.set(c.columnId, (byColumn.get(c.columnId) || 0) + 1);
const openCount = cards.filter((c) => c.state === 'open').length;
console.log(`📸 Wrote ${cards.length} issues (${openCount} open) → ${path.relative(ROOT, OUT_PATH)}`);
for (const col of config.defaultColumns) {
  const n = byColumn.get(col.id) || 0;
  console.log(`   ${col.id.padEnd(10)} ${n}`);
}
