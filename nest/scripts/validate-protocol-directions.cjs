#!/usr/bin/env node
/**
 * validate-protocol-directions.cjs — seed-data direction-contract validation (#620).
 *
 * The direction contract:
 *   - `bullish` directive  → LONG_ONLY protocols only (excluded from SHORT_ONLY)
 *   - `bearish` directive  → SHORT_ONLY protocols only (excluded from LONG_ONLY)
 *   - `neutral` directive  → either
 *
 * A protocol whose seed data lists a directive whose `directionBias` is excluded by
 * the protocol's `directionMode` is a composition bug — the directive is "added" but
 * silently dropped at scoring time by `classifyDirectiveInclusion()`. This script
 * catches that at build/lint time so a mismatch cannot be committed.
 *
 * Mirrors the rules in nest/src/modules/directives/directive-inclusion.ts
 * (the single source of truth for runtime filtering).
 *
 * Usage (from nest/):
 *   node scripts/validate-protocol-directions.cjs
 *
 * Exit code: 1 if any conflict, 0 otherwise.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const NEST_ROOT = path.resolve(__dirname, '..');
const DIRECTIVES_ROOT = path.join(NEST_ROOT, 'src', 'modules', 'directives');
const SEED_FILE = path.join(NEST_ROOT, 'src', 'modules', 'scoring', 'protocols-seed-data.ts');

// ── 1. Build directiveId → directionBias from every directive class ──────

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** Extract all classes (name + body source) from a source string. */
function extractClasses(src) {
  const re = /(?:@Injectable\(\)\s*\r?\n\s*)?export\s+class\s+(\w+)(?:\s+implements\s+[\w,\s]+)?\s*\{/g;
  const starts = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    starts.push({ name: m[1], bodyStart: m.index + m[0].length });
  }
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const nextStart = i + 1 < starts.length
      ? src.slice(starts[i].bodyStart).indexOf('export') + starts[i].bodyStart
      : src.length;
    out.push({ name: starts[i].name, body: src.slice(starts[i].bodyStart, nextStart) });
  }
  return out;
}

function fieldOf(body, name) {
  const m = body.match(new RegExp(`readonly\\s+${name}\\s*=\\s*'([^']+)'`));
  return m ? m[1] : null;
}

/** Recursively collect .ts files. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const biasByDirective = new Map();
for (const file of walk(DIRECTIVES_ROOT)) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  for (const cls of extractClasses(src)) {
    const id = fieldOf(cls.body, 'id');
    if (!id) continue;
    const bias = fieldOf(cls.body, 'directionBias') || 'neutral';
    // First definition wins (matching directive-guard MODE 6: duplicates are a separate concern).
    if (!biasByDirective.has(id)) biasByDirective.set(id, bias);
  }
}

// ── 2. Parse the seed data (transpile TypeScript → CommonJS, then eval) ──

const seedSrc = fs.readFileSync(SEED_FILE, 'utf8');
const js = ts.transpileModule(seedSrc, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

const sandbox = { exports: {} };
new Function('exports', 'module', 'require', js)(sandbox.exports, sandbox, require);
const PROTOCOL_SEED_DATA = sandbox.exports.PROTOCOL_SEED_DATA;

if (!PROTOCOL_SEED_DATA || typeof PROTOCOL_SEED_DATA !== 'object') {
  console.error('[validate-protocol-directions] Could not parse PROTOCOL_SEED_DATA from', SEED_FILE);
  process.exit(2);
}

// ── 3. Validate direction contract ───────────────────────────────────────

const conflicts = [];
let protocolCount = 0;
let totalDirectives = 0;

for (const [slug, proto] of Object.entries(PROTOCOL_SEED_DATA)) {
  protocolCount++;
  const mode = proto.directionMode || 'LONG_ONLY';
  const ids = new Set();
  for (const group of proto.groups || []) {
    for (const id of group.directiveIds || []) ids.add(id);
  }
  totalDirectives += ids.size;

  for (const id of ids) {
    const bias = biasByDirective.get(id);
    if (bias === undefined) {
      // Directive id in seed data but no source class found — likely renamed/deleted.
      conflicts.push({ protocol: slug, mode, directive: id, bias: 'UNKNOWN (no source class)' });
      continue;
    }
    const conflict =
      (mode === 'LONG_ONLY' && bias === 'bearish') ||
      (mode === 'SHORT_ONLY' && bias === 'bullish');
    if (conflict) conflicts.push({ protocol: slug, mode, directive: id, bias });
  }
}

console.log(
  `[validate-protocol-directions] Scanned ${protocolCount} protocols, ${totalDirectives} directive refs, ` +
  `${biasByDirective.size} directives with a known bias.`,
);

if (conflicts.length > 0) {
  console.error(`[validate-protocol-directions] ❌ ${conflicts.length} direction-contract conflict(s):`);
  for (const c of conflicts) {
    console.error(`  ${c.protocol} (${c.mode}) contains ${c.directive} (${c.bias})`);
  }
  process.exit(1);
}

console.log('[validate-protocol-directions] ✅ OK — no direction-contract conflicts.');
