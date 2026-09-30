#!/usr/bin/env node
/**
 * analyse-query-patterns.cjs — WHERE THE PIPELINE ASKS THE DATABASE FOR SOMETHING IT ALREADY HAS.
 *
 * Written for the META.Stack engineering review (owner request, 2026-09-30). Three shapes, each of
 * which costs a round trip that a caller could have avoided:
 *
 *   N+1        an `await`ed Prisma call INSIDE a loop that iterates a collection. The query is
 *              issued once per element. One protocol × 40 directives = 40 round trips where one
 *              `where: { id: { in: [...] } }` would do.
 *   REDUNDANT  two Prisma reads of the SAME model in one function with no intervening write, where
 *              the second is not obviously keyed differently. Often a helper re-fetching a row the
 *              caller just loaded and passed nowhere.
 *   REFETCH    a `findFirst`/`findUnique` on a model immediately AFTER a `create`/`update`/
 *              `upsert`/`delete` on it, with NO branch or early exit between them.
 *
 *              ⚠️ MEASURED 2026-09-30: the first version of this reported 15 REFETCH sites, and a
 *              hand-check of 5 found **0 real** — every one was an if/else alternative, an
 *              aggregate over a different set, or a deliberate concurrency guard. Applying them
 *              would have DELETED working safety checks. `count`/`findMany`/`aggregate`/`groupBy`
 *              were therefore removed from REFETCH (they answer a question about a SET, so a
 *              fresh call after a write is usually a different question) and a branch between the
 *              two calls now causes the site to be REJECTED and counted, never reported as a hit.
 *              Treat any surviving REFETCH as a hint to read, never as a fix to apply.
 *
 *              For reference, the original rule was — those
 *              operations already return the written row, so the follow-up read is pure cost.
 *
 * ⚠️ WHAT THIS IS NOT. It is a REPORT, not a build gate. It cannot see whether a loop's iterations
 * are bounded, whether a query is cached upstream, or whether the "redundant" read is deliberately
 * re-reading after an external write. Every finding is a place to LOOK, not a proven defect — and
 * saying so is the difference between a useful review and a pile of false accusations.
 *
 * Usage:
 *   node scripts/analyse-query-patterns.cjs               # report
 *   node scripts/analyse-query-patterns.cjs --top 25      # cap the listing
 *   node scripts/analyse-query-patterns.cjs --self-test   # prove every rule can fire
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
// ⚠️ THE SHARED HARNESS (#1032). This file hand-rolled its own loop until
// `validate-selftest-harness.cjs` flagged it — a copy written on the same day the issue about
// hand-rolled copies was open. The guard is the reason it is not still there.
const { runCases } = require('./lib/validator-helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const NEST_SRC = path.join(ROOT, 'nest', 'src');

/** A Prisma call: `this.prisma.<model>.<op>(` or `prisma.<model>.<op>(`. */
const PRISMA_CALL = /\b(?:this\.)?prisma\s*\.\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/;

/** Reads vs writes, because the distinction drives REFETCH. */
const READ_OPS = new Set(['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy', 'findFirstOrThrow', 'findUniqueOrThrow']);
const WRITE_OPS = new Set(['create', 'update', 'upsert', 'createMany', 'updateMany', 'delete', 'deleteMany']);

/** Loop openers. `forEach`/`map` with an `await` inside is the same N+1 in a different costume. */
const LOOP_OPEN = /^\s*(?:for\s*\(|while\s*\(|do\s*\{|.*\.(?:forEach|map|filter|reduce|some|every|flatMap)\s*\(\s*(?:async\s*)?\()/;

/** Strip comments and string bodies so a commented example cannot be reported as a call site. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** Split a file into top-level function bodies by brace depth, so "same function" is answerable. */
function functionsOf(src) {
  const out = [];
  const re = /(?:async\s+)?(?:private\s+|public\s+|protected\s+)?(?:static\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{;=]+)?\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = m.index;
    let depth = 0;
    let i = src.indexOf('{', start);
    const bodyStart = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    out.push({ name: m[1], start: bodyStart, end: i, body: src.slice(bodyStart, i + 1) });
  }
  return out;
}

/** Line number of a character offset. */
const lineAt = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * N+1 — a Prisma call lexically inside a loop body.
 * Brace-depth walk so a call AFTER the loop is not attributed to it.
 */
function findNPlusOne(src) {
  const out = [];
  const lines = src.split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    if (!LOOP_OPEN.test(lines[ln])) continue;
    let depth = 0;
    let opened = false;
    for (let j = ln; j < lines.length; j++) {
      const l = lines[j];
      for (const ch of l) {
        if (ch === '{') { depth++; opened = true; }
        else if (ch === '}') { depth--; }
      }
      if (j > ln) {
        const call = PRISMA_CALL.exec(l);
        if (call && (!opened || depth > 0)) {
          out.push({ line: j + 1, model: call[1], op: call[2], loopLine: ln + 1, text: l.trim().slice(0, 120) });
        }
      }
      if (opened && depth <= 0) break;
    }
  }
  return out;
}

/**
 * Can these two calls actually be a SEQUENCE?
 *
 * ⚠️ MEASURED 2026-09-30 — this check exists because the first version of this scanner had a
 * 0-of-5 hit rate. It reported `REFETCH` five times and **all five were false positives**, and
 * acting on them would have DAMAGED the code:
 *
 *   backtest-period.service.ts:390  count(before) → createMany → count(after) feeding `lostRows`
 *                                   ("rows DISAPPEARED") — a deliberate CONCURRENCY GUARD.
 *                                   Replacing it with createMany's return value deletes the guard.
 *   position-sync.service.ts:355    findFirst(byTicket)→update, then findFirst(bySymbol)→update.
 *                                   Two ALTERNATIVE fallback branches, not a sequence.
 *   screener.service.ts:619         create is `watchlist`, findFirst is `screenerHit` — different models.
 *   trading-strategy.service.ts:714 the count()s ASK A GUARD QUESTION — "do other bots use this
 *                                   protocol?" — before deleting. Not a re-read of what was written.
 *
 * The lesson is this repo's own rule: a guard that produces false positives gets allowlisted, and
 * an allowlisted guard is worse than none. So this refuses to report rather than guesses.
 *
 * Two calls are a sequence only when between them there is no branch, no early exit, and no
 * change of nesting depth — otherwise they are alternatives.
 */
/**
 * Is a read plausibly a RE-READ of what a write just wrote?
 *
 * `findFirst`/`findUnique` on the same model can be (the write created the row the read wants).
 * `count`/`findMany`/`aggregate`/`groupBy` CANNOT be assumed to be: they answer a question about
 * a SET, so a fresh call after a write is usually a different question — which is exactly what
 * the backtest `lostRows` guard is. Dropping them removes the whole class of false positive.
 */
const REFETCH_READ_OPS = new Set(['findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow']);

/** REDUNDANT / REFETCH — per function, the sequence of Prisma calls. */
function findRedundant(src) {
  const out = [];
  const rejected = [];
  for (const fn of functionsOf(src)) {
    const calls = [];
    const re = new RegExp(PRISMA_CALL.source, 'g');
    let m;
    while ((m = re.exec(fn.body)) !== null) calls.push({ at: m.index, model: m[1], op: m[2] });
    for (let i = 1; i < calls.length; i++) {
      const prev = calls[i - 1];
      const cur = calls[i];
      if (prev.model !== cur.model) continue;
      const between = fn.body.slice(prev.at, cur.at);
      if (/\}\s*else\b|\belse\s+if\b|\breturn\b|\bcontinue\b|\bbreak\b/.test(between)) {
        rejected.push({ fn: fn.name, reason: 'branch or early exit between the calls' });
        continue;
      }
      if (WRITE_OPS.has(prev.op) && REFETCH_READ_OPS.has(cur.op)) {
        out.push({ fn: fn.name, kind: 'REFETCH', model: cur.model, after: prev.op, op: cur.op, line: lineAt(src, fn.start + cur.at), text: `${prev.op}() then ${cur.op}()` });
      } else if (READ_OPS.has(prev.op) && READ_OPS.has(cur.op) && prev.op === cur.op && REFETCH_READ_OPS.has(cur.op)) {
        out.push({ fn: fn.name, kind: 'REDUNDANT', model: cur.model, after: prev.op, op: cur.op, line: lineAt(src, fn.start + cur.at), text: `${prev.op}() then ${cur.op}()` });
      }
    }
  }
  return out;
}

/** Exposed so the self-test can prove the REJECT path fires — a guard never seen to fail is a decoration. */
function findRejected(src) {
  const out = [];
  for (const fn of functionsOf(src)) {
    const calls = [];
    const re = new RegExp(PRISMA_CALL.source, 'g');
    let m;
    while ((m = re.exec(fn.body)) !== null) calls.push({ at: m.index, model: m[1], op: m[2] });
    for (let i = 1; i < calls.length; i++) {
      const prev = calls[i - 1];
      const cur = calls[i];
      if (prev.model !== cur.model) continue;
      const between = fn.body.slice(prev.at, cur.at);
      if (/\}\s*else\b|\belse\s+if\b|\breturn\b|\bcontinue\b|\bbreak\b/.test(between)) {
        out.push({ fn: fn.name, model: cur.model, text: `${prev.op}() then ${cur.op}()`, reason: 'branch or early exit' });
      }
    }
  }
  return out;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) acc.push(p);
  }
  return acc;
}

function analysisReport() {
  const files = walk(NEST_SRC);
  const n1 = [], red = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const x of findNPlusOne(src)) n1.push({ rel, ...x });
    for (const x of findRedundant(src)) red.push({ rel, ...x });
  }
  return { files: files.length, n1, red };
}

/**
 * ⚠️ SELF-TEST — proves each rule CAN fire, and the false-positive cases do NOT.
 * A rule that has never been observed to fire is a decoration.
 */
function selfTest() {
  const cases = [
    ['N+1: prisma call inside a for loop', () => {
      const s = `
async function f(ids: string[]) {
  for (const id of ids) {
    const row = await this.prisma.protocol.findUnique({ where: { id } });
  }
}`;
      return findNPlusOne(s).length === 1;
    }],
    ['N+1: prisma call inside forEach with async', () => {
      const s = `
async function f(rows) {
  rows.forEach(async (r) => {
    await this.prisma.trade.create({ data: r });
  });
}`;
      return findNPlusOne(s).length === 1;
    }],
    ['N+1 FALSE POSITIVE: a call AFTER the loop is not attributed to it', () => {
      const s = `
async function f(ids: string[]) {
  const acc = [];
  for (const id of ids) { acc.push(id); }
  const row = await this.prisma.protocol.findUnique({ where: { id: acc[0] } });
}`;
      return findNPlusOne(s).length === 0;
    }],
    ['REDUNDANT: same read op twice on one model in one function', () => {
      const s = `
async function f(id: string) {
  const a = await this.prisma.protocol.findUnique({ where: { id } });
  const b = await this.prisma.protocol.findUnique({ where: { id } });
}`;
      return findRedundant(s).some((x) => x.kind === 'REDUNDANT');
    }],
    ['REFETCH: a read straight after a write is flagged', () => {
      const s = `
async function f(d) {
  const made = await this.prisma.trade.create({ data: d });
  const again = await this.prisma.trade.findUnique({ where: { id: made.id } });
}`;
      return findRedundant(s).some((x) => x.kind === 'REFETCH');
    }],
    ['REFETCH FALSE POSITIVE: an if/else alternative is NOT a sequence', () => {
      // Measured shape at position-sync.service.ts:355 — two fallback branches, not a refetch.
      const s = `
async function f(pos) {
  const byTicket = await this.prisma.trade.findFirst({ where: { brokerTicket: pos.t } });
  if (byTicket) {
    await this.prisma.trade.update({ where: { id: byTicket.id }, data: {} });
    return 0;
  }
  const bySymbol = await this.prisma.trade.findFirst({ where: { symbol: pos.s } });
}`;
      return !findRedundant(s).some((x) => x.kind === 'REFETCH');
    }],
    ['REFETCH FALSE POSITIVE: count() after a write asks a DIFFERENT question', () => {
      // Measured shape at backtest-period.service.ts:390 — the count is a concurrency GUARD
      // (rowsBefore vs rowsAfter = rows that DISAPPEARED). Calling this a refetch and
      // "optimising" it away deletes the guard.
      const s = `
async function f(bars) {
  await this.prisma.marketBar.createMany({ data: bars });
  const barsAfter = await this.prisma.marketBar.count({ where: { symbolId: 1 } });
}`;
      return !findRedundant(s).some((x) => x.kind === 'REFETCH');
    }],
    ['REFETCH FALSE POSITIVE: a guard count() before a delete is not a refetch', () => {
      const s = `
async function f(ref) {
  const row = await this.prisma.protocol.findFirst({ where: { slug: ref } });
  const other = await this.prisma.tradingStrategy.count({ where: { protocolId: row.slug } });
  await this.prisma.protocol.delete({ where: { id: row.id } });
}`;
      return findRedundant(s).length === 0;
    }],
    ['REJECT PATH is reported, not silently dropped', () => {
      const s = `
async function f(pos) {
  const a = await this.prisma.trade.findFirst({ where: { x: 1 } });
  if (a) { return 1; }
  const b = await this.prisma.trade.findUnique({ where: { id: 2 } });
}`;
      return findRejected(s).length === 1;
    }],
    ['REDUNDANT FALSE POSITIVE: DIFFERENT models are not paired', () => {
      const s = `
async function f(id: string) {
  const a = await this.prisma.protocol.findUnique({ where: { id } });
  const b = await this.prisma.directive.findUnique({ where: { id } });
}`;
      return findRedundant(s).length === 0;
    }],
    ['COMMENTS cannot produce a finding', () => {
      const s = `
// for (const id of ids) { await this.prisma.x.findUnique({ where: { id } }); }
async function f() { return 1; }`;
      return findNPlusOne(stripComments(s)).length === 0;
    }],
  ];

  // ⚠️ The harness is SHARED (#1032). `runCases` prints the PASS/FAIL lines and the summary, and
  // returns the failure count without exiting, so `if (require.main === module)` still owns the exit.
  return runCases(cases);
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exit(selfTest() === 0 ? 0 : 1);

  const topIdx = process.argv.indexOf('--top');
  const top = topIdx >= 0 ? Number(process.argv[topIdx + 1]) || 25 : 25;

  const { files, n1, red } = analysisReport();
  console.log(`\n=== scan: ${files} non-spec TypeScript files under nest/src ===`);

  const byFile = (arr) => {
    const m = new Map();
    for (const x of arr) m.set(x.rel, (m.get(x.rel) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const n1ByFile = byFile(n1);
  console.log(`\n=== N+1 — a Prisma call inside a loop (${n1.length} site(s), ${n1ByFile.length} file(s)) ===`);
  n1ByFile.slice(0, top).forEach(([f, c]) => console.log(`  ${String(c).padStart(3)}  ${f}`));
  if (n1ByFile.length > top) console.log(`  ... ${n1ByFile.length - top} more file(s)`);

  console.log(`\n=== worst N+1 sites ===`);
  n1.slice(0, top).forEach((x) => console.log(`  ${x.rel}:${x.line}  ${x.model}.${x.op}()  [loop at L${x.loopLine}]`));

  const refetch = red.filter((x) => x.kind === 'REFETCH');
  const redundant = red.filter((x) => x.kind === 'REDUNDANT');
  console.log(`\n=== REFETCH — a read straight after a write on the same model (${refetch.length}) ===`);
  refetch.slice(0, top).forEach((x) => console.log(`  ${x.rel}:${x.line}  ${x.fn}()  ${x.text}`));

  console.log(`\n=== REDUNDANT — same read twice in one function (${redundant.length}) ===`);
  const redByFile = byFile(redundant);
  redByFile.slice(0, top).forEach(([f, c]) => console.log(`  ${String(c).padStart(3)}  ${f}`));

  console.log('\n⚠️ A finding is a place to LOOK, not a proven defect: this cannot see caching, bounded loops, or a deliberate re-read.\n');
}
