#!/usr/bin/env node
/**
 * generate-pipeline-map.cjs — PHASE 1 of #1071 (option C, proved on ONE pipeline).
 * =============================================================================
 *
 * THE QUESTION THIS ANSWERS, and it is not "show me everything":
 *
 *   **"Which nodes can reach a given resource — and which nodes have NO consumer?"**
 *
 * Those are ABSENCE questions, and every expensive defect in this repo has been an absence:
 * a writer nobody knew about (#1068), symbols nothing scored (R37), a value produced four times
 * (#1069). A graph of everything is a graph nobody reads. This one exists to answer those three.
 *
 * ── WHY IT READS *BOTH* ACCESS PATHS, WHICH IS THE WHOLE POINT ───────────────────────────────
 * A Prisma-only scan finds 26 files touching `marketbar`. It does NOT find the writer that
 * fabricated 1,172 bars (#1068) — that one is a raw `INSERT INTO marketbar` in
 * `bar-refresh.service.ts`. **The defect was invisible to the obvious analysis**, which is precisely
 * why a mechanical extraction is worth having and a hand-written map is not.
 *
 * ── WHAT IT IS, AND WHAT IT DELIBERATELY IS NOT ──────────────────────────────────────────────
 * It reads the SOURCE, so it cannot drift. It is not a fifth architecture surface: it emits ONE
 * generated artefact with a `--check` mode, the same shape as `docs-facts.cjs` and `tools-index.cjs`.
 *
 * ⚠️ COMMENTS ARE STRIPPED FIRST, using the canonical `comment-stripper.cjs`. Without it, prose that
 * *describes* SQL ("reads from marketbar WHERE …") becomes a node — the exact false-positive class
 * that made `validate-css-tokens` fail every agent's build (#1061, fixed the same day).
 *
 * USAGE
 *   node scripts/generate-pipeline-map.cjs              # report to stdout
 *   node scripts/generate-pipeline-map.cjs --write      # emit docs/PIPELINE-MAP.json + .md
 *   node scripts/generate-pipeline-map.cjs --check      # exit 1 if the emitted files are stale
 *   node scripts/generate-pipeline-map.cjs --self-test  # prove it can find the KNOWN writer
 */
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('../nest/scripts/lib/comment-stripper.cjs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'nest', 'src');
const SCHEMA = path.join(ROOT, 'nest', 'prisma', 'schema.prisma');
const OUT_JSON = path.join(ROOT, 'docs', 'PIPELINE-MAP.json');
const OUT_MD = path.join(ROOT, 'docs', 'PIPELINE-MAP.md');

/**
 * THE PIPELINE, declared once.
 *
 * Phase 1 covers ONE path: `quote → bar write → marketbar → directive → composite → gate → order`.
 * ⚠️ DELIBERATELY NOT "every table". A map that covers everything answers nothing, and the three
 * test questions on #1071 are all about THIS path. Widen it only when a question needs it.
 */
const PIPELINE = {
  name: 'bars',
  stages: [
    { id: 'ingest', label: 'Ingest', resources: ['symbol', 'symbol_route'] },
    { id: 'store', label: 'Bar store', resources: ['marketbar'] },
    { id: 'score', label: 'Score', resources: ['score', 'directiveoutcome', 'protocol', 'trading_strategy'] },
    { id: 'gate', label: 'Gate / queue', resources: ['strategy_signal_queue'] },
    { id: 'execute', label: 'Execute', resources: ['position', 'trade', 'order'] },
  ],
};

/** Operations that only READ. Everything else on a model is treated as a WRITE. */
const READ_OPS = new Set(['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow',
  'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']);

/** Operations that only WRITE. */
const WRITE_OPS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert',
  'delete', 'deleteMany']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(path.join(dir, e.name), out);
    } else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/**
 * model name → table name, read from `@@map`.
 *
 * ⚠️ KEYED ON THE **camelCase Prisma CLIENT NAME**, not the schema's PascalCase model name.
 * The schema declares `model MarketBar { @@map("marketbar") }`, but code calls
 * `prisma.marketBar.findMany()`. The first version of this file keyed on the SCHEMA name, so every
 * Prisma lookup missed, fell through a `continue`, and returned **nothing — with no error**.
 *
 * MEASURED: it reported **2** readers of `marketbar` against a hand-counted ground truth of **26**,
 * and both survivors had come from the raw-SQL path. A silent zero is this repo's most expensive
 * failure signature, and it appeared here inside the tool written to find it.
 * The `--self-test` now asserts the Prisma path finds hits, which is what that failure was missing.
 * ⚠️ AND IT NORMALISES CASE, BECAUSE THE SCHEMA CANNOT BE TRUSTED TO NAME THE TABLE.
 * MEASURED 2026-10-05: **61 of 117 models declare `@@map`** — the rest do not, including
 * `model MarketBar`, whose table is `marketbar`. Prisma's documented default is the MODEL name, so
 * the schema alone would have this file look for a table called `MarketBar`. It works because
 * **MySQL on Windows is case-insensitive** (`lower_case_table_names=1`), which is a property of this
 * machine's MySQL, NOT of the schema. ⚠️ The same code on a case-sensitive MySQL would fail —
 * so the mapping is normalised to lowercase here and compared lowercase at every use.
 * A generator that trusted `@@map` alone silently reported **2** readers against a ground truth of 26.
 */
function readModelMap() {
  const text = fs.readFileSync(SCHEMA, 'utf8');
  const map = new Map();
  const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const blocks = text.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g);
  for (const b of blocks) {
    const [, model, body] = b;
    const mapped = body.match(/@@map\("([^"]+)"\)/);
    const table = (mapped ? mapped[1] : model).toLowerCase();
    map.set(camel(model), table);   // ← the client name, which is what call sites use
    map.set(model, table);          // ← kept so a PascalCase call site also resolves
  }
  return map;
}

/** Strip comments once per file, then find both access paths. */
function scanFile(file, modelMap) {
  const raw = fs.readFileSync(file, 'utf8');
  const text = stripComments(raw);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const hits = [];

  // ── PATH 1: Prisma model calls ─────────────────────────────────────────────────────────────
  // ⚠️ Handles BOTH receiver shapes, because real code uses both: `this.prisma.marketBar.x()`
  // AND `(this.prisma as any).marketBar.x()`. The second is used where the generated client type
  // does not expose a model, and a scan that misses it silently under-reports.
  for (const m of text.matchAll(/prisma(?:\s+as\s+any\))?\.(\w+)\.(\w+)\s*\(/g)) {
    const [, model, op] = m;
    const table = modelMap.get(model);
    if (!table) continue;                                  // not a model (e.g. `$queryRawUnsafe`)
    const kind = READ_OPS.has(op) ? 'read' : WRITE_OPS.has(op) ? 'write' : null;
    if (!kind) continue;
    hits.push({ file: rel, line: lineOf(text, m.index), table, via: 'prisma', op, kind });
  }

  // ── PATH 2: raw SQL — the path a Prisma scan cannot see (#1068) ────────────────────────────
  const sql = [
    [/\bINSERT\s+INTO\s+[`"]?(\w+)/gi, 'write'],
    [/\bDELETE\s+(?:\w+\s+)?FROM\s+[`"]?(\w+)/gi, 'write'],
    [/\bUPDATE\s+[`"]?(\w+)/gi, 'write'],
    [/\bFROM\s+[`"]?(\w+)/gi, 'read'],
  ];
  for (const [re, kind] of sql) {
    for (const m of text.matchAll(re)) {
      hits.push({ file: rel, line: lineOf(text, m.index), table: m[1], via: 'raw', op: `raw ${kind}`, kind });
    }
  }
  return hits;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function build() {
  const modelMap = readModelMap();
  const files = walk(SRC);
  const all = files.flatMap((f) => scanFile(f, modelMap));

  const known = new Set(PIPELINE.stages.flatMap((s) => s.resources));
  // ⚠️ Compare LOWERCASE on both sides — see `readModelMap`. A raw-SQL table and a Prisma model
  // can disagree on case and still be the same table here.
  const edges = all.filter((h) => known.has(String(h.table).toLowerCase()));

  const byResource = {};
  for (const stage of PIPELINE.stages) {
    for (const r of stage.resources) {
      const hits = edges.filter((h) => String(h.table).toLowerCase() === r);
      const uniq = (k) => [...new Set(hits.filter((h) => h.kind === k)
        .map((h) => `${h.file}:${h.line} (${h.via})`))].sort();
      byResource[r] = {
        stage: stage.id,
        writers: uniq('write'),
        readers: uniq('read'),
        writerFiles: [...new Set(hits.filter((h) => h.kind === 'write').map((h) => h.file))].sort(),
        readerFiles: [...new Set(hits.filter((h) => h.kind === 'read').map((h) => h.file))].sort(),
        // ── Q2: a resource NOBODY writes is as interesting as one nobody reads ──
        hasWriter: hits.some((h) => h.kind === 'write'),
        hasReader: hits.some((h) => h.kind === 'read'),
      };
    }
  }
  return { pipeline: PIPELINE, byResource, scanned: files.length };
}

function render(m) {
  const lines = [
    '# PIPELINE-MAP — the bars pipeline, generated from source',
    '',
    '> ⚠️ **GENERATED — do not edit.** Regenerate with `node scripts/generate-pipeline-map.cjs`.',
    '> Phase 1 of #1071. Reads the source, so it cannot drift from it.',
    '',
    `Scanned **${m.scanned}** backend source files (specs excluded). Two access paths, because one`,
    'of them is invisible to the other: **Prisma model calls** and **raw SQL**. The writer that',
    'fabricated 1,172 bars (#1068) is only findable through the second.',
    '',
  ];
  for (const stage of m.pipeline.stages) {
    lines.push(`## ${stage.label}`);
    for (const r of stage.resources) {
      const d = m.byResource[r];
      lines.push('', `### \`${r}\``, '',
        `- **writers (${d.writerFiles.length}):** ${d.writerFiles.map((f) => `\`${f.split('/').pop()}\``).join(', ') || '_none_ — nothing writes this_'}`,
        `- **readers (${d.readerFiles.length}):** ${d.readerFiles.map((f) => `\`${f.split('/').pop()}\``).join(', ') || '_none_ — nothing reads this_'}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────────────────────
// A guard that has never been observed to fail is a decoration. This one asserts the map finds
// something we ALREADY KNOW is true — the #1068 writer — and that it can fail.
function selfTest() {
  let pass = 0, fail = 0;
  const check = (name, ok) => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

  const m = build();
  const mb = m.byResource.marketbar;

  check('marketbar HAS writers', mb.writers.length > 0);
  check('the #1068 writer is found BY RAW SQL (bar-refresh.service.ts:799)',
    mb.writers.some((w) => w.includes('bar-refresh.service.ts') && w.includes('(raw)')));

  // ⚠️ THE ASSERTION THAT WAS MISSING, and its absence is why a silent zero shipped: every other
  // check here could pass while the PRISMA path returned nothing at all. "Finds nothing" and
  // "found nothing to find" are indistinguishable without asserting a non-zero floor.
  const r = m.byResource.marketbar;
  check('Prisma path finds marketbar hits (a non-zero floor — catches a silent zero)',
    r.readerFiles.length + r.writerFiles.length >= 5);
  check('table-name resolution survives a model with NO @@map (model MarketBar -> marketbar)',
    r.readerFiles.length >= 5);
  check('marketbar readers include a known one (scoring/backtest family)',
    r.readerFiles.some((f) => /scoring|backtest|market-data/.test(f)));

  // ⚠️ CANARY: prove the raw-SQL path is load-bearing by disabling it and showing the writer VANISHES.
  const modelMap = readModelMap();
  const files = walk(SRC);
  const prismaOnly = files.flatMap((f) =>
    scanFile(f, modelMap).filter((h) => h.via === 'prisma' && h.table === 'marketbar'));
  check('canvas — with raw SQL ignored, the #1068 writer is INVISIBLE (this is why both paths matter)',
    !prismaOnly.some((h) => h.file.includes('bar-refresh.service.ts') && h.kind === 'write'));

  console.log(`\n  ${fail === 0 ? '✅' : '✖'} self-test: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('--self-test')) process.exit(selfTest());

const model = build();
const json = JSON.stringify({ generatedAt: 'SOURCE-DERIVED', pipeline: model.pipeline.name,
  scanned: model.scanned, resources: model.byResource }, null, 2);
const md = render(model);

if (argv.includes('--write')) {
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, json + '\n');
  fs.writeFileSync(OUT_MD, md + '\n');
  console.log(`[pipeline-map] wrote ${path.relative(ROOT, OUT_JSON)} and ${path.relative(ROOT, OUT_MD)}`);
} else if (argv.includes('--check')) {
  const stale = [OUT_JSON, OUT_MD].filter((p, i) =>
    !fs.existsSync(p) || fs.readFileSync(p, 'utf8').trim() !== (i === 0 ? json : md).trim());
  if (stale.length) {
    console.error('[pipeline-map] ✖ stale or missing:');
    for (const p of stale) console.error(`    ${path.relative(ROOT, p)}`);
    console.error('  Regenerate: node scripts/generate-pipeline-map.cjs --write');
    process.exit(1);
  }
  console.log(`[pipeline-map] ✅ ${model.scanned} file(s) scanned, map current.`);
} else {
  console.log(md);
}
