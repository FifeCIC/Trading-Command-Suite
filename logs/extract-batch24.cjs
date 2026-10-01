/**
 * Read-only extractor for handoff batch #24.
 *
 * WHY A PARSER RATHER THAN READING 130 KB INTO CONTEXT:
 *   the batch is 25 files / ~130 KB. The Librarian only needs the three mandated page entries plus
 *   the routes/schema/shape signals. This pulls exactly those, verbatim, and flags which files are
 *   missing a required section (those get rejected rather than silently inferred).
 *
 * Writes nothing outside logs/. Does not touch the DB or the app.
 */
const fs = require('fs');
const path = require('path');

const DIR = 'G:\\My Drive\\Project Management\\Live\\Trading-Command-Suite-Documentation\\handoff';
const SKIP = new Set(['README.md', 'ORPHAN-ARCHIVE-2026-09-27.md']);

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.md') && !SKIP.has(f))
  .sort();

const cut = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '\u2026' : t;
};

/** Pull a `## Heading` block up to the next `## ` heading. */
function section(text, name) {
  const re = new RegExp('^##\\s*' + name + '\\s*$', 'im');
  const m = text.match(re);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^##\s/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/** Bullet/field lines from a section, as "field: value". */
function fields(block) {
  if (!block) return {};
  const out = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]?\s*\*\*([^*]+)\*\*\s*:?\s*(.*)$/);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
    else {
      const m2 = line.match(/^\s*[-*]?\s*([a-zA-Z][\w ]{1,24}):\s*(.+)$/);
      if (m2) out[m2[1].trim().toLowerCase()] = m2[2].trim();
    }
  }
  return out;
}

function bullets(block) {
  if (!block) return [];
  return block
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s+\S/.test(l))
    .map((l) => cut(l.replace(/^\s*[-*]\s+/, ''), 170));
}

const ROUTE_RE =
  /\b(GET|POST|PUT|PATCH|DELETE)\s+((?:\/[\w:{}.\-*]+){1,8}|https?:\/\/[^\s`)]+)/g;

const rows = [];
const out = [];

for (const f of files) {
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
  const fm = (raw.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [, ''])[1];
  const fmGet = (k) => (fm.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [, ''])[1].trim();

  const capBlock = section(raw, 'Capability Map Entry');
  const qaBlock = section(raw, 'QA Test Entry');
  const afBlock = section(raw, 'Architecture Framework Entry');
  const diaBlock = section(raw, 'Diagram');
  const deferBlock = section(raw, 'Deferred[^\n]*') || section(raw, 'Deferred');
  const unchBlock = section(raw, 'Deliberately unchanged');
  const whatBlock = section(raw, 'What Changed');

  const cap = fields(capBlock);
  const qa = fields(qaBlock);
  const af = fields(afBlock);

  const missing = [];
  if (!capBlock || !Object.keys(cap).length) missing.push('Capability Map Entry');
  if (!qaBlock || !Object.keys(qa).length) missing.push('QA Test Entry');
  if (!afBlock || !Object.keys(af).length) missing.push('Architecture Framework Entry');

  const routes = new Set();
  for (const m of raw.matchAll(ROUTE_RE)) routes.add(`${m[1]} ${m[2]}`);

  const schemaHits = new Set();
  for (const m of raw.matchAll(
    /\b(?:prisma\.[a-zA-Z]+|`?[a-z][a-z0-9]*(?:_[a-z0-9]+)+`?)\s*(?:table|model|column)/gi,
  )) {
    schemaHits.add(m[0].replace(/\s+/g, ' '));
  }

  const shape =
    /\b(data flow|data-flow|ordering|order of|state machine|contract|boundary|lifecycle|pipeline)\b/i.test(
      raw,
    );

  out.push(
    [
      '='.repeat(76),
      `FILE: ${f}`,
      `date=${fmGet('date')} area=${fmGet('area')} type=${fmGet('type')}`,
      `MISSING: ${missing.length ? missing.join(' + ') : 'NONE'}`,
      `WHAT: ${cut(whatBlock, 300)}`,
      `SLICE: ${cut(af.summary || af.slice || '(none)', 340)}`,
      `CAPABILITY: ${cut(cap.name || '(none)', 70)} | persistence=${cap.persistence || '-'} uiSurfaces=${cap.uisurfaces || cap['uisurfaces'] || '-'} pipeline=${cap.pipeline || '-'} completion=${cap.completion || '-'}`,
      `QA: ${cut(qa.area || '-', 26)} | ${cut(qa.name || '(none)', 80)} | proc: ${cut(qa.procedure, 230)} | exp: ${cut(qa.expected, 170)}`,
      `ROUTES: ${routes.size ? [...routes].join('  ;;  ') : 'NONE'}`,
      `SCHEMA: ${schemaHits.size ? [...schemaHits].slice(0, 8).join('  ;;  ') : 'NONE'}`,
      `SHAPE: ${shape ? 'YES?' : 'no'}`,
      `DIAGRAM: ${diaBlock ? 'PRESENT' : 'ABSENT'}`,
      `DEFERRED: ${bullets(deferBlock).slice(0, 4).join(' ~ ') || 'NONE'}`,
      `UNCHANGED: ${bullets(unchBlock).slice(0, 4).join(' ~ ') || 'NONE'}`,
      '',
    ].join('\n'),
  );

  rows.push({ f, missing: missing.length, shape, routes: routes.size });
}

out.push('='.repeat(76));
out.push('TABLE A - files missing a required section:');
for (const r of rows.filter((r) => r.missing)) out.push(`  ${r.f}`);
if (!rows.some((r) => r.missing)) out.push('  (none)');
out.push('');
out.push('TABLE B - SHAPE signals (keyword-detected, must be confirmed by reading):');
for (const r of rows.filter((r) => r.shape)) out.push(`  ${r.f}`);
out.push('');
out.push(`FILES READ: ${files.length}`);

fs.writeFileSync(path.join(__dirname, 'b24-digest.md'), out.join('\n'), 'utf8');
console.log('files=' + files.length + '  chars=' + out.join('\n').length);
console.log('missing required section: ' + rows.filter((r) => r.missing).length);
console.log(files.join('\n'));
