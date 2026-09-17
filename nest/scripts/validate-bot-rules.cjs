#!/usr/bin/env node
/**
 * validate-bot-rules.cjs — every behavioural column on `trading_strategy` must be DECLARED.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY (2026-09-17)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Measured that day: 8 of the 29 behavioural columns on `trading_strategy` were enforced nowhere on
 * the live path, yet the create form offered every one of them. Nothing failed. A user could set
 * `hotStockEnabled`, `maxSize`, `maxDailyLoss`, `minRarityBand` and believe they had shaped a bot's
 * behaviour, and the engine ignored all four.
 *
 * That is the same shape as three other defects found the same week — a parser reading a format
 * nothing emits, an attribution column holding the wrong id, a sign predicate inverting the
 * strongest bearish signal. **Plausible configuration, no error, wrong behaviour underneath.** Prose
 * warnings do not stop this; a build gate does.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IT CHECKS
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   1. Every scalar column on `model TradingStrategy` in `schema.prisma` is either declared in
 *      `BOT_RULES` or listed in `NON_BEHAVIOURAL_COLUMNS`. A new column with no declaration FAILS,
 *      naming the column.
 *   2. Every declared field still exists in the model (a dropped column leaves a stale rule).
 *   3. Every rule claiming `enforcement` other than `none` names an `enforcedBy` file, the file
 *      exists, and it REFERENCES the field. This catches the commonest decay: a rule pointing at a
 *      file that was refactored until the field no longer appears in it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHAT IT CANNOT DO — state this plainly, do not let it imply more
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * It is a STATIC check. It cannot prove a field is reachable at runtime, that a gate is on the live
 * queue path rather than the legacy `execute()` path, or that a rule actually fires. Passing this
 * validator means **"every column has a named, honest owner"** — not "every rule works".
 *
 * The claim that would overreach is `enforcement: 'live'`. Only `automation-loop.service.ts` is the
 * live path; a rule pointing at any other file is at best `legacy-only` or `display-only`, and this
 * script CANNOT tell. That judgement lives in `bot-rules.ts` and must be reviewed by a human.
 *
 * Exit 0 = every column declared. Exit 1 = at least one finding (names them).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const REGISTRY = path.join(__dirname, '..', 'src', 'modules', 'trading', 'bot-rules.ts');

/** Read the scalar field names of `model TradingStrategy`. */
function readModelColumns(schemaText) {
  const modelMatch = /model\s+TradingStrategy\s*\{([\s\S]*?)\n\}/.exec(schemaText);
  if (!modelMatch) {
    return { error: 'Could not find `model TradingStrategy` in schema.prisma' };
  }
  const body = modelMatch[1];
  const fields = [];
  const seen = new Set();
  for (const rawLine of body.split('\n')) {
    // Strip comments, then read `name Type ...`.
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_\[\]?]*)/.exec(line);
    if (!m) continue;
    const [, name, type] = m;
    // Relations / block attributes are not columns.
    if (name.startsWith('@@')) continue;
    if (/^(StrategyEvaluation|StrategyProtocol)/.test(type)) continue;
    if (['DateTime'].includes(type) && name.endsWith('At')) {
      // createdAt / updatedAt ARE columns — keep them, they are declared non-behavioural.
    }
    if (seen.has(name)) continue;
    seen.add(name);
    fields.push(name);
  }
  return { fields };
}

/** Parse `field: 'x'` / `enforcedBy: 'y'` pairs out of the registry source, per object literal. */
function readRegistry(registryText) {
  const entries = [];
  // Each rule is a single object literal `{ field: '...', ... }` (they are written one-ish per line,
  // but allow multi-line).
  const objectRe = /\{[^{}]*field:\s*'([^']+)'[\s\S]*?\}/g;
  let m;
  while ((m = objectRe.exec(registryText)) !== null) {
    const block = m[0];
    const enforcement = /enforcement:\s*'([^']+)'/.exec(block);
    const enforcedBy = /enforcedBy:\s*(null|'([^']*)')/.exec(block);
    entries.push({
      field: m[1],
      enforcement: enforcement ? enforcement[1] : null,
      enforcedBy: enforcedBy ? (enforcedBy[1] === 'null' ? null : enforcedBy[2]) : undefined,
    });
  }
  const declared = new Set();
  for (const e of entries) declared.add(e.field);
  return { entries, declared };
}

function run() {
  const findings = [];

  if (!fs.existsSync(SCHEMA)) {
    console.error(`[bot-rules] schema.prisma not found at ${SCHEMA}`);
    process.exit(1);
  }
  if (!fs.existsSync(REGISTRY)) {
    console.error(`[bot-rules] registry not found at ${REGISTRY}`);
    process.exit(1);
  }

  const schemaText = fs.readFileSync(SCHEMA, 'utf8');
  const registryText = fs.readFileSync(REGISTRY, 'utf8');

  const model = readModelColumns(schemaText);
  if (model.error) {
    console.error(`[bot-rules] ${model.error}`);
    process.exit(1);
  }
  const { entries, declared } = readRegistry(registryText);

  if (declared.size === 0) {
    // A parser that reads nothing must ERROR, never pass. An empty declaration set would make every
    // check below vacuous and report a clean bill of health — the exact failure this gate exists to
    // prevent.
    console.error('[bot-rules] CANARY INVALID — parsed 0 rule declarations from bot-rules.ts.');
    console.error('[bot-rules]   The registry was not read, so this check inspected nothing.');
    console.error('[bot-rules]   Refusing to report OK. Fix the parser or the registry format.');
    process.exit(1);
  }

  const nonBehavioural = new Set(
    (/NON_BEHAVIOURAL_COLUMNS\s*=\s*\[([^\]]*)\]/.exec(registryText)?.[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean),
  );
  if (nonBehavioural.size === 0) {
    console.error('[bot-rules] CANARY INVALID — could not parse NON_BEHAVIOURAL_COLUMNS.');
    console.error('[bot-rules]   Refusing to report OK rather than treating every column as declared.');
    process.exit(1);
  }

  // ── 1. every column declared ────────────────────────────────────────────────────────────────
  for (const col of model.fields) {
    if (nonBehavioural.has(col)) continue;
    if (declared.has(col)) continue;
    findings.push(
      `UNDECLARED COLUMN  trading_strategy.${col} has no entry in bot-rules.ts.\n` +
        `    Every behavioural column needs a declared enforcement status. Add one:\n` +
        `      { field: '${col}', label: '...', stage: '...', enforcement: 'live|legacy-only|display-only|none',\n` +
        `        enforcedBy: '...' | null, summary: '...', caveat?: '...' }\n` +
        `    …or list '${col}' in NON_BEHAVIOURAL_COLUMNS if it cannot affect a trade.`,
    );
  }

  // ── 2. every declaration still exists ───────────────────────────────────────────────────────
  const modelColumns = new Set(model.fields);
  for (const e of entries) {
    if (e.field === 'role' || e.field === 'sortOrder') continue; // StrategyProtocol, checked below
    if (!modelColumns.has(e.field)) {
      findings.push(
        `STALE RULE         bot-rules.ts declares '${e.field}' but that column is not on ` +
          `model TradingStrategy. Remove the declaration or restore the column.`,
      );
    }
  }

  // ── 3. a rule that is enforced must name a file that exists and references the field ────────
  //
  // ⚠️ `display-only` and `none` are allowed a null `enforcedBy`, because by definition there IS no
  // enforcement point to name — `name` and `description` are labels. Only `live` and `legacy-only`
  // make a claim about ENFORCEMENT, so only they must name where it happens. When a `display-only`
  // rule does name a file (e.g. `timeframe`), it is still verified — naming where a field is READ is
  // worth checking, it is just not required.
  for (const e of entries) {
    if (e.enforcedBy === undefined) {
      findings.push(`MISSING enforcedBy  rule '${e.field}' has no \`enforcedBy\` key at all (use null for none).`);
      continue;
    }
    if (e.enforcement === 'none') {
      if (e.enforcedBy !== null) {
        findings.push(
          `CONTRADICTION      rule '${e.field}' is enforcement:'none' but names a file ` +
            `('${e.enforcedBy}'). One of the two is wrong.`,
        );
      }
      continue;
    }
    if (!e.enforcedBy) {
      if (e.enforcement === 'live' || e.enforcement === 'legacy-only') {
        findings.push(
          `NO ENFORCER        rule '${e.field}' claims enforcement:'${e.enforcement}', which asserts ` +
            `the field CAN change a trade, but lists no file. Name where it is applied.`,
        );
      }
      // display-only with no file = a label. Legitimate, nothing to verify.
      continue;
    }
    const abs = path.join(ROOT, e.enforcedBy);
    if (!fs.existsSync(abs)) {
      findings.push(
        `MISSING FILE       rule '${e.field}' points at ${e.enforcedBy}, which does not exist.`,
      );
      continue;
    }
    const src = fs.readFileSync(abs, 'utf8');
    if (!src.includes(e.field)) {
      findings.push(
        `NOT REFERENCED     rule '${e.field}' claims enforcement:'${e.enforcement}' in ` +
          `${e.enforcedBy}, but that file never mentions '${e.field}'. Either the rule moved or it ` +
          `is no longer applied there.`,
      );
    }
  }

  const counted = {};
  for (const e of entries) counted[e.enforcement ?? 'unset'] = (counted[e.enforcement ?? 'unset'] ?? 0) + 1;
  const summary =
    `columns=${model.fields.length} declared=${declared.size} ` +
    Object.entries(counted).map(([k, v]) => `${k}=${v}`).join(' ');

  if (findings.length) {
    console.error(`\n[bot-rules] ✖ ${findings.length} finding(s) — ${summary}\n`);
    for (const f of findings) console.error(`  ${f}\n`);
    console.error('[bot-rules] A rule that is not declared is a rule nobody owns.');
    process.exit(1);
  }

  console.log(`[bot-rules] ✅ OK — ${summary}`);
  console.log(
    '[bot-rules]   note: static check. It proves every column has a declared owner, NOT that a rule fires.',
  );
}

run();
