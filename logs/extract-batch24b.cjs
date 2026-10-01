/**
 * Read-only extractor v2 for handoff batch #24.
 *
 * v1 BUG, recorded so it is not repeated: the field keys are written `- **name:** value`, so the
 * colon sits INSIDE the bold. v1's regex captured `name:` as the key and every lookup for `name`
 * returned undefined - which read as "no fields" and could have been mistaken for "section missing".
 * A parser that cannot read its input must look wrong, not empty. Fixed by stripping the colon.
 *
 * Also joins continuation lines, because `procedure:` and `expected:` wrap.
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

function section(text, name) {
  const m = text.match(new RegExp('^##\\s*' + name + '\\s*$', 'im'));
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^##\s/m);
  const block = (next === -1 ? rest : rest.slice(0, next)).trim();
  return block.length ? block : null;
}

/** Parse `- **key:** value` (colon inside or outside the bold), joining wrapped continuation lines. */
function fields(block) {
  if (!block) return {};
  const out = {};
  let key = null;
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]?\s*\*\*\s*([^*]+?)\s*\*\*\s*:?\s*(.*)$/);
    if (m) {
      key = m[1].replace(/:\s*$/, '').trim().toLowerCase();
      out[key] = m[2].trim();
    } else if (key && /^\s{2,}\S/.test(line)) {
      out[key] = (out[key] + ' ' + line.trim()).trim();
    } else if (line.trim() === '') {
      // keep current key across blank lines inside a block
    } else if (key) {
      key = null;
    }
  }
  return out;
}

function bullets(block) {
  if (!block) return [];
  return block
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s+\S/.test(l))
    .map((l) => cut(l.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, ''), 165));
}

const ROUTE_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+((?:\/[\w:{}.\-*]+){1,9})/g;

const ROWS = [];
const out = [];

for (const f of files) {
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
  const fm = (raw.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [, ''])[1];
  const fmGet = (k) => ((fm.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [, ''])[1] || '').trim();

  const capBlock = section(raw, 'Capability Map Entry');
  const qaBlock = section(raw, 'QA Test Entry');
  const afBlock = section(raw, 'Architecture Framework Entry');
  const diaBlock = section(raw, 'Diagram');
  const deferBlock = section(raw, 'Deferred[^\\n]*');
  const unchBlock = section(raw, 'Deliberately unchanged');
  const whatBlock = section(raw, 'What Changed');

  const cap = fields(capBlock);
  const qa = fields(qaBlock);
  const af = fields(afBlock);

  const missing = [];
  if (!capBlock) missing.push('CapabilityMap');
  if (!qaBlock) missing.push('QA');
  if (!afBlock) missing.push('ArchFramework');

  const routes = new Set();
  for (const m of raw.matchAll(ROUTE_RE)) routes.add(`${m[1]} ${m[2]}`);

  ROWS.push({ f, missing, shape: /##\s*Diagram/.test(raw), routes: routes.size });

  out.push(
    [
      '='.repeat(74),
      `FILE ${f}   [${fmGet('date')} ${fmGet('area')}/${fmGet('type')}]`,
      `MISSING: ${missing.length ? missing.join(' + ') : 'none'}`,
      `WHAT: ${cut(whatBlock, 260)}`,
      `AF.section=${af.section || '-'} | AF.summary: ${cut(af.summary, 330)}`,
      `CAP: ${cut(cap.name, 74)} | persist=${cap.persistence || '-'} ui=${cap.uisurfaces || '-'} pipe=${cap.pipeline || '-'} done=${cap.completion || '-'}`,
      `QA: [${cut(qa.area, 24)}] ${cut(qa.name, 84)}`,
      `QA.proc: ${cut(qa.procedure, 250)}`,
      `QA.exp: ${cut(qa.expected, 190)}`,
      `ROUTES: ${routes.size ? [...routes].join(' ;; ') : 'NONE'}`,
      `DIAGRAM: ${diaBlock ? 'present' : 'ABSENT'}`,
      `DEFERRED: ${bullets(deferBlock).slice(0, 3).join(' ~ ') || 'none'}`,
      `UNCHANGED: ${bullets(unchBlock).slice(0, 3).join(' ~ ') || 'none'}`,
      '',
    ].join('\n'),
  );
}

out.push('='.repeat(74));
out.push('REJECT - missing one of the three mandated entries:');
const rej = ROWS.filter((r) => r.missing.length);
for (const r of rej) out.push(`  ${r.f}  ->  ${r.missing.join(' + ')}`);
if (!rej.length) out.push('  (none)');
out.push(`\nSHAPE (has a ## Diagram): ${ROWS.filter((r) => r.shape).length}/25`);
out.push(`FILES READ: ${files.length}`);

fs.writeFileSync(path.join(__dirname, 'b24-digest2.md'), out.join('\n'), 'utf8');
console.log('files=' + files.length + ' chars=' + out.join('\n').length);
console.log('REJECT count=' + rej.length);
console.log(rej.map((r) => '  ' + r.f + ' -> ' + r.missing.join('+')).join('\n') || '  none');
