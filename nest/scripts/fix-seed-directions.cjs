#!/usr/bin/env node
/**
 * fix-seed-directions.cjs — one-off cleanup (#620): remove directives from
 * protocols where their `directionBias` conflicts with the protocol's
 * `directionMode`. These directives are ALREADY silently excluded at scoring
 * time (classifyDirectiveInclusion), so removal is a no-op on scores — it only
 * deletes dead config and makes the seed data honest.
 *
 * Pairs with validate-protocol-directions.cjs (run that first to see conflicts).
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const NEST_ROOT = path.resolve(__dirname, '..');
const DIRECTIVES_ROOT = path.join(NEST_ROOT, 'src', 'modules', 'directives');
const SEED_FILE = path.join(NEST_ROOT, 'src', 'modules', 'scoring', 'protocols-seed-data.ts');

// ── bias map ──────────────────────────────────────────────────────────────
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); }
function extractClasses(src) {
  const re = /(?:@Injectable\(\)\s*\r?\n\s*)?export\s+class\s+(\w+)(?:\s+implements\s+[\w,\s]+)?\s*\{/g;
  const starts = []; let m;
  while ((m = re.exec(src)) !== null) starts.push({ bodyStart: m.index + m[0].length });
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const next = i + 1 < starts.length ? src.slice(starts[i].bodyStart).indexOf('export') + starts[i].bodyStart : src.length;
    out.push(src.slice(starts[i].bodyStart, next));
  }
  return out;
}
function fieldOf(body, name) { const m = body.match(new RegExp(`readonly\\s+${name}\\s*=\\s*'([^']+)'`)); return m ? m[1] : null; }
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else if (e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const biasByDirective = new Map();
for (const file of walk(DIRECTIVES_ROOT)) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  for (const body of extractClasses(src)) {
    const id = fieldOf(body, 'id'); if (!id) continue;
    if (!biasByDirective.has(id)) biasByDirective.set(id, fieldOf(body, 'directionBias') || 'neutral');
  }
}

// ── parse seed data ───────────────────────────────────────────────────────
const src = fs.readFileSync(SEED_FILE, 'utf8');
const MARKER = 'export const PROTOCOL_SEED_DATA';
const markerIdx = src.indexOf(MARKER);
if (markerIdx === -1) { console.error('marker not found'); process.exit(2); }
const prefix = src.slice(0, markerIdx + 'export const PROTOCOL_SEED_DATA: Record<string, SeedProtocol> = '.length);

const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const sandbox = { exports: {} };
new Function('exports', 'module', 'require', js)(sandbox.exports, sandbox, require);
const data = sandbox.exports.PROTOCOL_SEED_DATA;

// ── remove conflicts ─────────────────────────────────────────────────────
let removed = 0;
for (const [slug, proto] of Object.entries(data)) {
  const mode = proto.directionMode || 'LONG_ONLY';
  for (const group of proto.groups || []) {
    if (!Array.isArray(group.directiveIds)) continue;
    const before = group.directiveIds.length;
    group.directiveIds = group.directiveIds.filter((id) => {
      const bias = biasByDirective.get(id) ?? 'neutral';
      const conflict = (mode === 'LONG_ONLY' && bias === 'bearish') || (mode === 'SHORT_ONLY' && bias === 'bullish');
      if (conflict) { removed++; console.log(`  removed ${id} (${bias}) from ${slug} (${mode})`); }
      return !conflict;
    });
    if (group.directiveIds.length !== before) { /* keep */ }
  }
}

// ── write back ───────────────────────────────────────────────────────────
const body = prefix + JSON.stringify(data, null, 2) + ';\n';
fs.writeFileSync(SEED_FILE, body);
console.log(`[fix-seed-directions] Removed ${removed} conflicting directive reference(s). Wrote ${SEED_FILE}`);
