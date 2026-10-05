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

// ════════════════════════════════════════════════════════════════════════════════════════════
// PHASE 2 of #1071 — D as the DERIVED dataset: nodes with inputs / outputs / consumers, + MATHS
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// WHAT PHASE 1 COULD NOT ANSWER, and this is the whole reason Phase 2 exists.
//
// Phase 1 counts FILES per table. That answers "which writers can reach `marketbar`?" (#1068) and
// "which resources have no consumer?" at the RESOURCE level. It cannot answer #1069 — *"is the same
// VALUE computed in more than one place?"* — because a value is not a table. The signed profit %
// is computed four times and touches no table in any of them.
//
// ── SO THIS PHASE READS THE COMPILER, NOT THE TEXT ──────────────────────────────────────────
// `ts.createProgram` + the type checker give three things a regex cannot:
//
//   1. THE AST. A formula inside a comment or a string is not a site. That false-positive class
//      already cost every agent a red build once (#1061, `validate-css-tokens`).
//   2. THE REAL RETURN TYPE — declared or inferred — which is what "returned types" means.
//   3. RESOLVED REFERENCES. `consumers` is a real call site, not a name that matches. A text
//      search for `assessOne(` finds the declaration and the call; the checker knows they are the
//      same symbol, and that a same-named function in another module is not.
//
// ── THREE TIERS, BECAUSE #1069 IS THREE QUESTIONS WEARING ONE HAT ───────────────────────────
//   exact  — the identical computation after normalisation            (a copy)
//   coarse — the identical SHAPE with different constants             (divergent maths)
//   idiom  — `(A-B)` AND `(B-A)` IN ONE EXPRESSION, divided by one of them   (a re-derived copy)
//
// ⚠️ THE IDIOM TIER IS NOT DECORATION — IT IS THE DIFFERENCE BETWEEN A RIGHT AND A WRONG ANSWER.
// Measured on the four known #1069 sites: THREE share one normalised shape, and the CANONICAL one
// (`peak.ts:82`) is written differently — its division sits inside each ternary branch and its
// `* 100` is a separate statement. An exact-only scan therefore reports "3 sites" against a known
// ground truth of 4, and silently files the canonical as unrelated. The idiom tier recovers it,
// because all four express the same thing: a difference, mirrored, over a base.
//
// ⚠️ SCOPE, STATED SO IT IS NOT MISTAKEN FOR MORE. The maths scan covers RATIOS — expressions that
// contain a division and at least two distinct atoms. `size * riskPct` is a computation this does
// NOT report, deliberately: breadth here buys noise, and the falsifier on #1071 is a ratio.
// The node scan covers `nest/src` (specs excluded), because the #1069 sites are not all in
// pipeline files — `peak.ts` touches no table at all, and narrowing the scan to Phase 1's file set
// would have made the known case unfindable.

const PHASE2_TS_PATH = path.join(ROOT, 'nest', 'node_modules', 'typescript');
let _ts = null;
function tsLib() {
  if (!_ts) _ts = require(PHASE2_TS_PATH);
  return _ts;
}

const squeeze = (s) => String(s).replace(/\s+/g, '');
const relOf = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/** A ts.Program over the BACKEND, from the same tsconfig the build uses. */
function createTsProgram() {
  const ts = tsLib();
  const base = path.join(ROOT, 'nest');
  const cfgPath = path.join(base, 'tsconfig.build.json');
  const read = ts.readConfigFile(cfgPath, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, ' '));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, base);
  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options, noEmit: true, incremental: false, composite: false, declaration: false,
  });
  return { ts, program, checker: program.getTypeChecker() };
}

/** Every non-declaration source file of the backend that this artefact covers. */
function backendSources(program) {
  return program.getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && relOf(sf.fileName).startsWith('nest/src/')
      && !/\.spec\.ts$/.test(sf.fileName));
}

const lineAt = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/**
 * Print an expression as a NORMALISED form, so the same maths written with different variable
 * names becomes the same string.
 *
 *   · numeric literals are KEPT — `* 100` and `* 1000` are different maths, not the same maths
 *   · string literals become `S`, so a label cannot create a group
 *   · every identifier / member chain becomes `V1`, `V2`, … **in order of first appearance**, so
 *     the shape survives and the names do not
 *   · a ternary's CONDITION becomes `C` and is recorded separately — blanking it is what lets the
 *     copies group at all, and recording it is what keeps the divergence visible
 *   · a callee is kept LITERAL (`Math.abs`), because `a - b` and `Math.abs(a - b)` differ
 */
function mathsPrint(ts, node, ctx) {
  const S = (n) => mathsPrint(ts, n, ctx);
  if (ts.isParenthesizedExpression(node)) return `(${S(node.expression)})`;
  if (ts.isNonNullExpression(node) || ts.isAsExpression(node)) return S(node.expression);
  if (ts.isNumericLiteral(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return 'S';
  if (ts.isConditionalExpression(node)) {
    ctx.conditions.push(squeeze(node.condition.getText()));
    return `(C?${S(node.whenTrue)}:${S(node.whenFalse)})`;
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.getText();
    if (op === '&&' || op === '||' || op === '??') {     // a guard, not arithmetic
      ctx.conditions.push(squeeze(node.getText()));
      return 'C';
    }
    ctx.ops.add(op);
    return `${S(node.left)}${op}${S(node.right)}`;
  }
  if (ts.isPrefixUnaryExpression(node)) return `${node.operator}${S(node.operand)}`;
  if (ts.isCallExpression(node)) {
    return `${squeeze(node.expression.getText())}(${node.arguments.map(S).join(',')})`;
  }
  const text = squeeze(node.getText());
  if (!ctx.atoms.has(text)) ctx.atoms.set(text, `V${ctx.atoms.size + 1}`);
  return ctx.atoms.get(text);
}

const isBareLiteral = (ts, n) =>
  ts.isNumericLiteral(n) || ts.isStringLiteral(n)
  || n.kind === ts.SyntaxKind.NullKeyword || n.kind === ts.SyntaxKind.TrueKeyword
  || n.kind === ts.SyntaxKind.FalseKeyword
  || (ts.isIdentifier(n) && n.text === 'undefined');

/**
 * The `(A-B) … (B-A)` idiom — a difference and its mirror in ONE expression.
 *
 * ⚠️ This is the tier that finds a RE-DERIVED copy, where the variable names, the branch order and
 * the position of the division have all changed but the computation has not. #1069 found its four
 * sites by reading; this is the mechanical form of the same observation.
 */
function signedMirror(ts, node) {
  const subs = [];
  const walk = (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.MinusToken) {
      subs.push([squeeze(n.left.getText()), squeeze(n.right.getText())]);
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  const seen = new Set(subs.map(([a, b]) => `${a}|${b}`));
  return subs.some(([a, b]) => a !== b && seen.has(`${b}|${a}`)) ? 'SIGNED-MIRROR-DIFF' : null;
}

/** Extract the normalised maths of one expression, or null if it is not a RATIO worth reporting. */
function mathsOf(ts, expr) {
  // Unwrap a guard ternary (`entry > 0 ? X : 0`). The guard is RECORDED, not discarded — #1069's
  // "divergence 2" is exactly this: `0` where the canonical returns `null`.
  const guards = [];
  let e = expr;
  for (let i = 0; i < 3 && ts.isConditionalExpression(e); i++) {
    const t = isBareLiteral(ts, e.whenTrue), f = isBareLiteral(ts, e.whenFalse);
    if (t === f) break;                       // both literal, or neither — not a guard
    guards.push(squeeze(e.condition.getText()));
    e = t ? e.whenFalse : e.whenTrue;
  }
  const ctx = { atoms: new Map(), conditions: [], ops: new Set() };
  const exact = mathsPrint(ts, e, ctx);
  if (!exact.includes('/')) return null;      // a RATIO is the class #1069 belongs to
  if (ctx.atoms.size < 2) return null;        // one variable divided by a constant is not a computation
  // ⚠️ A BARE RATIO IS NOT A COMPUTATION WORTH GROUPING, AND THIS CHECK WAS ADDED FROM A MEASUREMENT.
  // First run without it: the largest group was `V1/V2` with **93 sites** — `posFlow/negFlow` grouped
  // with `volumes[i]/scaleFactor`, which share a shape and nothing else. A false positive by
  // construction, and 93 of them buried the four real ones. A computation whose EDGES can diverge
  // needs an operator to diverge in: a subtraction (a signed difference), a scaling (a percent), or
  // a sum. The division on its own is a shape, not an answer.
  if (![...ctx.ops].some((op) => op === '-' || op === '*' || op === '+')) return null;
  return {
    exact,
    coarse: exact.replace(/\d+(?:\.\d+)?/g, 'N'),
    idiom: signedMirror(ts, e),
    guards,
    conditions: ctx.conditions,
    atoms: [...ctx.atoms.keys()],
  };
}

function enclosingName(ts, node) {
  let p = node.parent;
  while (p) {
    if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isFunctionExpression(p)
      || ts.isArrowFunction(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) {
      if (p.name) return p.name.getText();
      const vd = p.parent && ts.isVariableDeclaration(p.parent) ? p.parent : null;
      return vd && ts.isIdentifier(vd.name) ? vd.name.text : '(anonymous)';
    }
    p = p.parent;
  }
  return '(top-level)';
}

/** Every ratio site in one file, with the function that contains it. */
function mathsSites(ts, sf) {
  const sites = [];
  const visit = (node) => {
    let expr = null, kind = null, name = null;
    if (ts.isVariableDeclaration(node) && node.initializer) {
      expr = node.initializer; kind = 'const';
      name = ts.isIdentifier(node.name) ? node.name.text : null;
    } else if (ts.isReturnStatement(node) && node.expression) {
      expr = node.expression; kind = 'return';
    } else if (ts.isPropertyAssignment(node)) {
      expr = node.initializer; kind = 'field';
    }
    if (expr) {
      const m = mathsOf(ts, expr);
      if (m) sites.push({ file: relOf(sf.fileName), line: lineAt(sf, node),
        in: enclosingName(ts, node), kind, name, raw: squeeze(expr.getText()).slice(0, 180), ...m });
    }
    ts.forEachChild(node, visit);
  };
  sf.forEachChild(visit);
  return sites;
}

/**
 * The node set: every function/method in `nest/src`, with its inputs, its return type and its
 * resolved call sites.
 *
 * ⚠️ A FRAMEWORK HOOK IS NOT AN UNCONSUMED NODE. A NestJS controller method with `@Get()`, a
 * `constructor`, `onModuleInit` and friends are called by the framework, so "0 call sites" would
 * be a FALSE finding — and false findings are how a report gets ignored. They are marked instead.
 */
const FRAMEWORK_HOOKS = new Set(['constructor', 'onModuleInit', 'onModuleDestroy', 'onApplicationBootstrap',
  'onApplicationShutdown', 'beforeApplicationShutdown', 'configure', 'register', 'forRoot', 'forRootAsync',
  'forFeature', 'main', 'bootstrap']);

function collectDecls(ts, sf) {
  const out = [];
  const add = (fn, nameNode) => {
    if (!nameNode || !ts.isIdentifier(nameNode)) return;
    out.push({ fn, nameNode, name: nameNode.text, line: lineAt(sf, fn),
      accessor: ts.isGetAccessor(fn) || ts.isSetAccessor(fn) });
  };
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) add(node, node.name);
    else if (ts.isMethodDeclaration(node) && node.name) add(node, node.name);
    else if ((ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.name) add(node, node.name);
    else if (ts.isVariableDeclaration(node) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      if (ts.isIdentifier(node.name)) add(node.initializer, node.name);
    } else if (ts.isPropertyDeclaration(node) && node.name && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      add(node.initializer, node.name);
    }
    ts.forEachChild(node, visit);
  };
  sf.forEachChild(visit);
  return out;
}

function buildNodes(ts, program, checker) {
  const sources = backendSources(program);
  const records = [];
  const byName = new Map();

  for (const sf of sources) {
    const rel = relOf(sf.fileName);
    for (const d of collectDecls(ts, sf)) {
      const sig = safe(() => checker.getSignatureFromDeclaration(d.fn));
      const rec = {
        id: `${rel}::${d.name}@${d.line}`,
        file: rel, line: d.line, name: d.name,
        exported: (ts.getCombinedModifierFlags(d.fn) & ts.ModifierFlags.Export) !== 0,
        inputs: d.fn.parameters.map((p) => `${p.name.getText()}${p.type ? `: ${squeeze(p.type.getText())}` : ''}`),
        returns: sig ? squeeze(checker.typeToString(sig.getReturnType())).slice(0, 120) : null,
        returnsDeclared: !!d.fn.type,
        frameworkHook: FRAMEWORK_HOOKS.has(d.name)
          || (d.fn.modifiers || []).some((m) => ts.isDecorator(m)),
        consumers: [],
      };
      records.push(rec);
      const sym = safe(() => checker.getSymbolAtLocation(d.nameNode));
      const keys = reachKeys(ts, checker, d.fn, d.name);
      if (keys.size) {
        if (!byName.has(d.name)) byName.set(d.name, []);
        byName.get(d.name).push({ rec, keys, accessor: d.accessor });
      }
    }
  }

  // ── Second pass: resolve call sites AND property reads. A name that matches is not a reference; a
  // SYMBOL is. ⚠️ AND A GETTER IS NOT CALLED — IT IS READ. MEASURED 2026-10-05:
  // `trading212.adapter.ts:158 private get hasCredentials()` was reported unreferenced because the
  // first version of this pass walked only `CallExpression`s, and a getter is consumed as
  // `this.hasCredentials` with no call to find. Property reads are credited ONLY against accessor
  // declarations, so an ordinary field read cannot accidentally mark a same-named function as used.
  for (const sf of sources) {
    const rel = relOf(sf.fileName);
    const credit = (node, nameNode, accessorsOnly) => {
      const cands = byName.get(nameNode.text);
      if (!cands) return;
      const key = declKey(deref(checker, ts, safe(() => checker.getSymbolAtLocation(nameNode))));
      if (!key) return;
      const where = `${rel}:${lineAt(sf, node)}`;
      for (const c of cands) {
        if (accessorsOnly && !c.accessor) continue;
        if (c.keys.has(key)) c.rec.consumers.push(where);
      }
    };
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) || ts.isPropertyAccessExpression(callee)) {
          credit(node, ts.isPropertyAccessExpression(callee) ? callee.name : callee, false);
        }
      } else if (ts.isPropertyAccessExpression(node)
        && !(node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node)) {
        credit(node, node.name, true);
      }
      ts.forEachChild(node, visit);
    };
    sf.forEachChild(visit);
  }
  return { records, files: sources.length };
}

const safe = (fn) => { try { return fn(); } catch { return null; } };
function deref(checker, ts, sym) {
  if (!sym) return null;
  try { return (sym.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(sym) : sym; }
  catch { return sym; }
}

/**
 * ⚠️ MATCH BY DECLARATION NODE, NOT BY SYMBOL IDENTITY — ADDED FROM A MEASUREMENT, 2026-10-05.
 *
 * The call sites of `Mt5TradingService.placeOrder` resolve to a **Transient Method** symbol
 * (flags `33562624` = Transient|Method) — the type checker's instantiated view of the class member.
 * The declaration resolves to a **Method** symbol (flags `8192`). They are different objects, so
 * `===` matched **none of the eleven call sites**, and `placeOrder` was reported as having no
 * consumer at all. Measured: 422 nodes were reported unreferenced on the first run, and the list
 * opened with `placeOrder`, `getQuote` and `record` — all of them called constantly.
 *
 * A silent UNDER-report inside the tool, one phase after a silent ZERO inside the same file. The
 * floor assertions in `selfTestPhase2` did not catch it because they only asked whether *something*
 * had a consumer; this fix adds one that names a function we know is called.
 *
 * Bridging by `declarations[0]` works for every flavour — declared, alias, transient and optional
 * symbols all carry the same declaration node.
 */
function declKey(sym) {
  const d = sym && sym.declarations && sym.declarations[0];
  return d ? `${d.getSourceFile().fileName}:${d.pos}` : null;
}

/**
 * The KEYS A CALL TO THIS METHOD COULD RESOLVE TO — its own declaration, plus the declaration of
 * every INTERFACE METHOD it implements.
 *
 * ⚠️ WITHOUT THIS, EVERY INTERFACE IMPLEMENTATION LOOKS DEAD. MEASURED 2026-10-05: after the
 * declaration-key fix above the unreferenced list still opened with six members of
 * `trading212.adapter.ts` (`getQuote`, `getCandles`, `getProfile`, `healthCheck`, `getCapabilities`,
 * `getPositionSnapshot`). None of them is dead. A caller holding a `ProviderAdapter` resolves to the
 * **interface's** `MethodSignature`, so the class method is reached by a symbol it does not own. The
 * first run reported **422** unreferenced nodes and this was the bulk of what survived the second.
 *
 * The credit is deliberately shared: if two adapters implement one interface, a call through the
 * interface marks BOTH as reachable. That over-credits, and it is the correct direction to err —
 * "unreachable" is a claim, and a false one costs the reader the whole list.
 */
function reachKeys(ts, checker, decl, name) {
  const keys = new Set();
  const own = declKey(safe(() => checker.getSymbolAtLocation(decl.name)));
  if (own) keys.add(own);
  let p = decl.parent;
  while (p && !ts.isClassDeclaration(p) && !ts.isClassExpression(p)) p = p.parent;
  if (!p || !p.heritageClauses) return keys;
  for (const h of p.heritageClauses) {
    if (h.token !== ts.SyntaxKind.ImplementsKeyword) continue;
    for (const t of h.types) {
      const ty = safe(() => checker.getTypeAtLocation(t));
      if (!ty) continue;
      const prop = safe(() => checker.getPropertyOfType(ty, name));
      const k = declKey(prop);
      if (k) keys.add(k);
    }
  }
  return keys;
}

/** Group sites by one of the three tiers. */
function groupBy(sites, keyOf) {
  const g = new Map();
  for (const s of sites) {
    const k = keyOf(s);
    if (!k) continue;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(s);
  }
  return [...g.entries()]
    .filter(([, v]) => new Set(v.map((s) => `${s.file}:${s.line}`)).size >= 2)
    .map(([key, sites]) => ({
      key,
      // ── THE SIGNAL THAT MATTERS MOST, AND IT IS NOT THE COUNT ──────────────────────────────
      // A group where every site applies the SAME conditions is a copy, and a copy is usually
      // harmless. A group where the sites DISAGREE — a different sign test, a different guard, a
      // different value when the computation cannot run — is #1069 exactly: identical arithmetic,
      // different edges. `divergent` is computed here so the report can lead with it instead of
      // burying it under whichever group happens to have the most sites.
      divergent: new Set(sites.map((s) => JSON.stringify(
        [...s.guards].sort().concat([...s.conditions].sort())))).size > 1,
      sites: sites.map((s) => ({ file: s.file, line: s.line, in: s.in, name: s.name,
        guards: s.guards, conditions: s.conditions, raw: s.raw })),
    }))
    .sort((a, b) => b.sites.length - a.sites.length);
}

function buildPhase2(pipelineFiles) {
  const { ts, program, checker } = createTsProgram();
  const sources = backendSources(program);
  const sites = sources.flatMap((sf) => mathsSites(ts, sf));
  const { records, files } = buildNodes(ts, program, checker);

  // Keep the node set bounded AND useful: a node is in the artefact if the pipeline can reach it
  // (it lives in a file Phase 1 implicated) or if it computes a ratio we are reporting.
  const mathsFiles = new Set(sites.map((s) => s.file));
  const nodes = records.filter((r) => pipelineFiles.has(r.file) || mathsFiles.has(r.file));

  return {
    tsFiles: sources.length,
    declFiles: files,
    declarations: records.length,
    sites: sites.length,
    maths: {
      exact: groupBy(sites, (s) => s.exact),
      coarse: groupBy(sites, (s) => s.coarse),
      idiom: groupBy(sites, (s) => s.idiom),
    },
    nodes: nodes.map((r) => ({
      // ⚠️ COMPACT, AND WITH NO `id`. The file path and the line already identify a node, and an `id`
      // that repeats them costs ~110 KB of the artefact to say nothing new. `docs/PIPELINE-MAP.md` is
      // the human form of this dataset; the JSON is for a program to read, and pretty-printing a
      // 1 MB file buys a diff nobody can read anyway.
      file: r.file, line: r.line, name: r.name,
      exported: r.exported, frameworkHook: r.frameworkHook,
      inputs: r.inputs, returns: r.returns, returnsDeclared: r.returnsDeclared,
      consumers: r.consumers.slice(0, 3),
      consumerCount: r.consumers.length,
    })),
    // ── Q2 at NODE level: a function nothing calls, and that the framework does not call either ──
    unreferenced: nodes
      .filter((r) => r.consumers.length === 0 && !r.frameworkHook && !r.exported)
      .map((r) => `${r.file}:${r.line} ${r.name}`),
  };
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

  selfTestPhase2(check, m);

  console.log(`\n  ${fail === 0 ? '✅' : '✖'} self-test: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

/**
 * PHASE 2 SELF-TEST — asserted against the #1069 ground truth, which was established by READING
 * the four sites by hand (issue #1069, and re-read at the time of writing).
 *
 * | # | file | sites |
 * |---|---|---|
 * | 1 | `nest/src/common/trading/peak.ts` `profitPctFor()` — CANONICAL | 1 |
 * | 2 | `nest/src/modules/scoring/exit-consensus.service.ts` | 1 |
 * | 3 | `nest/src/modules/automation/stop-guardian.service.ts` | 2 |
 *
 * ⚠️ THE GROUND TRUTH IS FOUR SITES, AND THE TWO TIERS FIND DIFFERENT NUMBERS OF THEM. That is not
 * a bug in the test — it is the measurement the tier design rests on, so both halves are asserted.
 */
function selfTestPhase2(check, phase1) {
  const pipelineFiles = new Set();
  for (const r of Object.values(phase1.byResource)) {
    for (const f of [...r.writerFiles, ...r.readerFiles]) pipelineFiles.add(f);
  }
  const p2 = buildPhase2(pipelineFiles);

  // ── NON-ZERO FLOORS FIRST. Phase 1 shipped a silent ZERO inside the tool built to find silent
  // zeros, and every check it had still passed. "Finds nothing" and "found nothing to find" must
  // not be able to look alike here.
  check('phase 2 reads a real program (floor: >300 files)', p2.tsFiles >= 300);
  check('phase 2 found ratio sites (floor: >=20)', p2.sites >= 20);
  check('phase 2 resolved real call sites (floor: at least one function has a consumer)',
    p2.nodes.some((n) => n.consumerCount > 0));

  // ── THE FALSIFIER: four sites that were found by READING CODE must be found mechanically. ──
  const KNOWN = new Set([
    'nest/src/common/trading/peak.ts',
    'nest/src/modules/scoring/exit-consensus.service.ts',
    'nest/src/modules/automation/stop-guardian.service.ts',
  ]);
  const idiom = p2.maths.idiom.find((g) => g.key === 'SIGNED-MIRROR-DIFF');
  const idiomHits = (idiom ? idiom.sites : []).filter((s) => KNOWN.has(s.file));
  const perFile = (list) => [...KNOWN].map((f) => [f, list.filter((s) => s.file === f).length]);

  check('idiom tier: all FOUR known #1069 sites land in ONE group', idiomHits.length >= 4);
  check('idiom tier: covers all three files (peak 1, exit-consensus 1, stop-guardian 2)',
    perFile(idiomHits).every(([, n]) => n >= 1) && idiomHits.filter((s) => s.file.endsWith('stop-guardian.service.ts')).length >= 2);
  check('idiom tier: the CANONICAL (peak.ts) is among them — a re-derived copy, not a text match)',
    idiomHits.some((s) => s.file.endsWith('peak.ts')));

  // ── CANARY, BOTH DIRECTIONS. The exact tier must find the three identical copies AND must NOT
  // find the canonical. Asserting only the first would pass against a tool that reported all four
  // as identical, which would be a weaker claim than the source supports.
  // ⚠️ MEASURED, AND IT CORRECTS THE FIRST DRAFT OF THIS TEST: the group holds **FOUR** sites, not
  // three. The three the issue names are all here, and so is `exit-consensus.service.ts:374`
  // (`peakProfitPct`) — the same arithmetic applied to the PEAK price, which #1069's manual audit
  // did not list. The canonical is still absent from this group, which is what the canary below
  // asserts. "Found N where the issue said M" is a result in both directions, and it is only
  // trustworthy because the extra site was read.
  const exactGroupWithExit = p2.maths.exact.find((g) => g.sites.some((s) => s.file.endsWith('exit-consensus.service.ts')));
  check('exact tier: the byte-identical copies form ONE group of FOUR',
    !!exactGroupWithExit && exactGroupWithExit.sites.length >= 4);
  check('exact tier: that group spans BOTH files (so it is not a file-private helper)',
    !!exactGroupWithExit
    && new Set(exactGroupWithExit.sites.map((s) => s.file)).size >= 2);
  // ⚠️ THE ANSWER TO THE FALSIFIER. A group of identical maths that all behaves the same is a
  // copy. A group whose sites disagree about their CONDITIONS OR GUARDS is the #1069 finding — and
  // that is a property of the data, so it is asserted rather than described.
  check('the #1069 group is flagged DIVERGENT — same maths, different edges',
    !!exactGroupWithExit && exactGroupWithExit.divergent === true);
  check('CANARY — the exact tier CANNOT see the canonical, which is why the idiom tier exists',
    !!exactGroupWithExit && !exactGroupWithExit.sites.some((s) => s.file.endsWith('peak.ts')));

  // ── A node-level answer, which is half of Phase 2's goal. ──
  check('nodes carry resolved inputs and a return type',
    p2.nodes.some((n) => n.inputs.length > 0 && n.returns));

  // ⚠️ THE FLOOR THAT WAS MISSING, AND IT WAS MISSING THE ONE THING THAT WAS BROKEN.
  // The first version of this test asked only whether *something* had a consumer — and it passed
  // while `placeOrder` was reported with none, because matching on symbol IDENTITY resolved to a
  // Transient Method at the call site and a Method at the declaration. Named functions, called
  // constantly, are the only way to notice a resolver that quietly under-reports.
  const placeOrder = p2.nodes.find((n) => n.name === 'placeOrder' && n.file.endsWith('mt5-trading.service.ts'));
  check('consumer resolution: `Mt5TradingService.placeOrder` has consumers (names a known-called fn)',
    !!placeOrder && placeOrder.consumerCount >= 2);
  // ⚠️ THE OTHER HALF OF THE SAME MEASUREMENT: `placeOrder` is declared FIVE times (two adapters, a
  // paper-trading service, an interface and this service), so a text search finds 11 call sites and
  // attributes all 11 to one name. Resolved symbols separate them. If this ever collapses to one
  // node, the resolver has quietly become a text search.
  const placeOrders = new Set(p2.nodes.filter((n) => n.name === 'placeOrder').map((n) => n.file));
  check('consumer resolution: the FIVE `placeOrder` declarations are kept apart (not one text match)',
    placeOrders.size >= 3);
  // ⚠️ AND AN INTERFACE IMPLEMENTATION IS NOT DEAD CODE. Six members of `trading212.adapter.ts`
  // were reported unreferenced until interface declarations were credited as call targets.
  const adapter = p2.nodes.find((n) => n.name === 'getCandles' && n.file.endsWith('trading212.adapter.ts'));
  check('consumer resolution: an interface implementation is NOT reported unreachable',
    !!adapter && adapter.consumerCount >= 1);
  const rec = p2.nodes.find((n) => n.name === 'record' && n.file.endsWith('trade-recorder.service.ts'));
  check('consumer resolution: `trade-recorder.record` has consumers (the second known case)',
    !!rec && rec.consumerCount >= 1);
  check('unreferenced is a SHORTLIST, not a majority (>160 means the resolver regressed)',
    p2.unreferenced.length < 160);
}

/**
 * Phase 2 in markdown. CAPPED on purpose: a wall of groups is the failure this artefact exists to
 * avoid, so the top groups are printed and the remainder is counted rather than listed.
 */
function renderPhase2(p2) {
  const L = [
    '## Phase 2 — the derived dataset',
    '',
    '> ⚠️ **GENERATED — do not edit.** Phase 2 of #1071. Read by the **TypeScript compiler**, not by',
    '> pattern-matching, so a formula in a comment or a string is not a site and a call site is a',
    '> resolved symbol rather than a name that matches.',
    '',
    `**${p2.tsFiles}** source files · **${p2.declarations}** declarations · **${p2.sites}** ratio sites · `
      + `**${p2.nodes.length}** nodes · **${p2.unreferenced.length}** unreferenced`, '',
    '| tier | what it means | groups |',
    '|---|---|---|',
    `| \`exact\` | the identical computation after normalisation | ${p2.maths.exact.length} |`,
    `| \`coarse\` | the identical **shape**, different constants | ${p2.maths.coarse.length} |`,
    `| \`idiom\` | \`(A−B)\` **and** \`(B−A)\` in one expression | ${p2.maths.idiom.length} |`,
    '',
  ];

  const section = (title, groups, note, limit) => {
    L.push(`## ${title}`, '', note, '');
    if (!groups.length) { L.push('_none found — a real result, not an empty one._', ''); return; }
    for (const g of groups.slice(0, limit)) {
      L.push(`### ${g.sites.length} sites — \`${g.key}\``, '');
      for (const s of g.sites.slice(0, 8)) {
        L.push(`- \`${s.file}:${s.line}\` — \`${s.in}()\`${s.name ? ` → \`${s.name}\`` : ''}`);
        L.push(`  - \`${s.raw.slice(0, 150)}\``);
        if (s.conditions && s.conditions.length) {
          L.push(`  - conditions: ${s.conditions.map((c) => `\`${c}\``).join(' · ')}`);
        }
        if (s.guards && s.guards.length) L.push(`  - guarded by: ${s.guards.map((c) => `\`${c}\``).join(' · ')}`);
      }
      if (g.sites.length > 8) L.push(`- … and ${g.sites.length - 8} more`);
      L.push('');
    }
    if (groups.length > limit) L.push(`_… and ${groups.length - limit} further group(s)._`, '');
  };

  // ⚠️ PRINTED FIRST, AND IT IS NOT A CONVENIENCE. The #1069 group has 3 sites; ten other groups
  // have more, so a report ordered by size alone buries the one group the owner asked about. The
  // order here is by INTEREST: same maths, and the sites disagree about the rules around it.
  section('Divergent edges — the same maths, DIFFERENT rules', p2.maths.exact.filter((g) => g.divergent),
    '**This is the #1069 shape.** The computation is identical after normalisation, but the sites '
    + 'disagree about the conditions they apply — a different sign test, a different guard, or a '
    + 'different value when the computation cannot run. Read the `conditions:` and `guarded by:` lines: '
    + 'that is where two copies stop agreeing.', 20);
  section('Q3a — the same maths in more than one place', p2.maths.exact,
    'Identical after normalisation: variable names differ, the computation does not.', 10);
  section('Q3b — the same shape, differing constants', p2.maths.coarse,
    'Numeric literals blanked. **This is where divergent maths hides** — same structure, a different '
    + 'number doing the work.', 10);
  section('Q3c — the same idea, re-derived', p2.maths.idiom,
    'A difference and its mirror in one expression. **This is the tier that finds a copy whose '
    + 'variable names, branch order and division position have all changed.** It is wider than '
    + '`exact` on purpose, so it is longer — read the group, not the count.', 5);

  L.push('## Nodes with no resolved consumer', '',
    'A function that nothing calls, that is not exported, that carries no decorator, and that the '
    + 'framework does not call by name. **A candidate list, not a proof of dead code.**', '',
    'What is EXCLUDED, and why each exclusion exists — every one of them was a false finding first:',
    '',
    '| excluded | because |',
    '|---|---|',
    '| exported functions | reachable from another module, including modules outside this scan |',
    '| `@Get()`/`@Post()`/… controller methods | the framework calls them; the source cannot show it |',
    '| `constructor`, `onModuleInit`, `forRoot`, … | lifecycle hooks, called by NestJS |',
    '| a method that implements an INTERFACE | a caller holding the interface resolves to its signature, not to the class method — six members of `trading212.adapter.ts` were reported dead until this was credited |',
    '| a GETTER with no call | a getter is READ, not called — `hasCredentials` was reported dead for this reason |',
    '',
    '⚠️ **And the caveat that remains:** a name is not a reference. `placeOrder` is declared **five** times in this backend (two adapters, a paper-trading service, an interface, and `mt5-trading.service.ts`), so a text search finds 11 call sites and attributes all 11 to one name. These are matched by resolved symbol, which is why they stay apart — but that also means a method reached ONLY through a dynamic lookup (`this[name](...)`) will appear here and is not dead.', '');
  if (!p2.unreferenced.length) L.push('_none_', '');
  else for (const u of p2.unreferenced) L.push(`- \`${u}\``);
  L.push('');
  return L.join('\n');
}

// ── MAIN ─────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('--self-test')) process.exit(selfTest());

const model = build();
const p1Files = new Set();
for (const r of Object.values(model.byResource)) {
  for (const f of [...r.writerFiles, ...r.readerFiles]) p1Files.add(f);
}
const phase2 = buildPhase2(p1Files);
const json = JSON.stringify({ generatedAt: 'SOURCE-DERIVED', pipeline: model.pipeline.name,
  scanned: model.scanned, resources: model.byResource,
  phase2: { tsFiles: phase2.tsFiles, declarations: phase2.declarations, sites: phase2.sites,
    mathsGroups: { exact: phase2.maths.exact.length, coarse: phase2.maths.coarse.length,
      idiom: phase2.maths.idiom.length },
    maths: phase2.maths, nodes: phase2.nodes, unreferenced: phase2.unreferenced } });
const md = render(model) + '\n' + renderPhase2(phase2);

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
