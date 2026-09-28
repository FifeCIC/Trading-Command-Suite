#!/usr/bin/env node
/**
 * validate-rule-enforcement.cjs — an `enforcedBy` attribution must name a mechanism that DECLARES
 * the column. A claim is not validated by being well-formed.
 * ==================================================================================================
 *
 * THE DEFECT (measured 2026-09-28)
 * --------------------------------
 * `bot-rules.ts` attributes every `trading_strategy` column to an enforcing file via `enforcedBy`.
 * `stop-guardian.service.ts` declares its own mechanisms in `GUARDIAN_RULES`. **Nothing compared
 * the two.** Measured on the bot page the owner was reading:
 *
 *   FIVE columns claimed `stop-guardian.service.ts` as their enforcer —
 *   `simTslEnabled`, `simTslActivationPct`, `simTslDistancePct`, `exhaustionObserveEnabled`,
 *   `exhaustionDecelPct` — while `GUARDIAN_RULES` declared ONE mechanism touching bot columns and
 *   named only TWO of the five, in a prose `value` string.
 *
 * So the guardian's own list — the thing the page renders as "Exit management" — was:
 *   • SILENT about a mechanism it runs every tick (`exhaustionObserver`), and
 *   • DUPLICATED the sim-TSL subject: three loose rows under "Exit" plus one mechanism row.
 *
 * A reader could study the exit configuration and not learn which mechanisms were missing. This is
 * the repo's signature shape — **plausible output, no error, wrong shape underneath** — and the fix
 * is a declaration plus a gate, not a paragraph warning.
 *
 * ── WHAT THIS CHECKS ──────────────────────────────────────────────────────────────────────────
 *   1. every non-null `enforcedBy` names a file that EXISTS;
 *   2. a column whose enforcer is the guardian must appear in EXACTLY ONE `GUARDIAN_RULES[].fields`
 *      — zero is the omission above, two-or-more is the duplication;
 *   3. every `fields` entry must be a column that `bot-rules.ts` actually declares;
 *   4. a mechanism's `enforcement` must agree with its columns' — the file header already promises
 *      the two registries "cannot drift into meaning different things by the same word";
 *   5. every `global` mechanism declares NO `fields` (a global mechanism reads no bot column).
 *
 * ── WHAT IT DOES NOT CLAIM ────────────────────────────────────────────────────────────────────
 * It proves the two DECLARATIONS agree. It cannot prove the code honours them — that a mechanism
 * actually reads the column it lists. Stating the difference is the difference between a guard and
 * a reassurance. (The read is structural: the service file is parsed as text, not executed.)
 *
 * Usage:
 *   node nest/scripts/validate-rule-enforcement.cjs              # both registries
 *   node nest/scripts/validate-rule-enforcement.cjs --self-test   # prove every rule CAN fail
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const BOT_RULES_FILE = path.join(ROOT, 'nest', 'src', 'modules', 'trading', 'bot-rules.ts');
const GUARDIAN_FILE = path.join(ROOT, 'nest', 'src', 'modules', 'automation', 'stop-guardian.service.ts');
const GUARDIAN_PATH = 'nest/src/modules/automation/stop-guardian.service.ts';

/** Parse the `BOT_RULES` array. Pure, so the self-test can inject text. */
function parseBotRules(text) {
  const start = text.indexOf('BOT_RULES');
  const body = start === -1 ? '' : text.slice(start);
  const out = [];
  // Each entry begins `{ field: '...'` — split on that boundary so a field cannot borrow its
  // neighbour's `enforcedBy`.
  const re = /\{\s*field:\s*'([^']+)'([\s\S]*?)(?=\n\s*\{\s*field:|\n\];)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const [, field, chunk] = m;
    const enf = chunk.match(/enforcement:\s*'([^']+)'/);
    const by = chunk.match(/enforcedBy:\s*'([^']+)'/);
    const isNull = /enforcedBy:\s*null/.test(chunk);
    out.push({ field, enforcement: enf ? enf[1] : null, enforcedBy: by ? by[1] : (isNull ? null : undefined) });
  }
  return out;
}

/** Parse the `GUARDIAN_RULES` array. Pure. */
function parseGuardianRules(text) {
  const start = text.indexOf('GUARDIAN_RULES');
  const body = start === -1 ? '' : text.slice(start);
  const out = [];
  const re = /\{\s*id:\s*'([^']+)'([\s\S]*?)(?=\n\s*\/\/|\n\s*\{\s*id:|\n\];)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const [, id, chunk] = m;
    const enf = chunk.match(/enforcement:\s*'([^']+)'/);
    const scope = chunk.match(/scope:\s*'([^']+)'/);
    const fieldsMatch = chunk.match(/fields:\s*\[([^\]]*)\]/);
    const fields = fieldsMatch
      ? [...fieldsMatch[1].matchAll(/'([^']+)'/g)].map((f) => f[1])
      : [];
    out.push({ id, enforcement: enf ? enf[1] : null, scope: scope ? scope[1] : null, fields });
  }
  return out;
}

/** The rules. Pure — `fileExists` is injected so the self-test can drive it. */
function check(botText, guardianText, fileExists) {
  const errors = [];
  const bot = parseBotRules(botText);
  const guard = parseGuardianRules(guardianText);

  if (bot.length === 0) errors.push('bot-rules.ts: no rules parsed — has the array shape changed?');
  if (guard.length === 0) errors.push('stop-guardian.service.ts: no GUARDIAN_RULES parsed — has the array shape changed?');
  if (errors.length) return { errors, bot: bot.length, guard: guard.length, claimed: 0 };

  const declaredFields = new Set(bot.map((r) => r.field));

  // ── (1) every non-null `enforcedBy` names a file that EXISTS.
  for (const r of bot) {
    if (r.enforcedBy === undefined) {
      errors.push(`bot-rules.ts: \`${r.field}\` declares neither an \`enforcedBy\` nor \`null\` — state which, or the attribution is unreadable`);
    } else if (r.enforcedBy && !fileExists(r.enforcedBy)) {
      errors.push(`bot-rules.ts: \`${r.field}\` names enforcer \`${r.enforcedBy}\`, which does not exist at that path`);
    }
  }

  // ── (2) a column enforced by the guardian must be declared by EXACTLY ONE mechanism.
  const claiming = [];
  const seenByMechanism = new Map();
  for (const g of guard) {
    for (const f of g.fields) {
      if (seenByMechanism.has(f)) {
        errors.push(
          `stop-guardian.service.ts: column \`${f}\` is declared by TWO mechanisms — ` +
          `\`${seenByMechanism.get(f)}\` and \`${g.id}\`. One subject, two declarations; a reader ` +
          `sees it twice and cannot tell which one runs.`,
        );
      }
      seenByMechanism.set(f, g.id);
    }
  }

  const guardianFields = new Set(seenByMechanism.keys());
  for (const r of bot) {
    if (r.enforcedBy !== GUARDIAN_PATH) continue;
    claiming.push(r.field);
    if (!guardianFields.has(r.field)) {
      errors.push(
        `bot-rules.ts: \`${r.field}\` claims \`stop-guardian.service.ts\` as its enforcer, but NO ` +
        `GUARDIAN_RULES mechanism declares it in \`fields\`. Either add the column to the mechanism ` +
        `that reads it, or correct \`enforcedBy\`. ⚠️ This is the omission that made the guardian's ` +
        `own list silent about a mechanism it runs every tick.`,
      );
    }
  }

  // ── (3) every `fields` entry must be a column `bot-rules.ts` actually declares.
  for (const g of guard) {
    for (const f of g.fields) {
      if (!declaredFields.has(f)) {
        errors.push(
          `stop-guardian.service.ts: mechanism \`${g.id}\` lists field \`${f}\`, which \`bot-rules.ts\` ` +
          `does not declare. A mechanism cannot read a column that is not on the bot row.`,
        );
      }
    }
  }

  // ── (4) a mechanism's `enforcement` must agree with its columns'.
  const byField = new Map(bot.map((r) => [r.field, r]));
  for (const g of guard) {
    for (const f of g.fields) {
      const botRule = byField.get(f);
      if (!botRule) continue;
      if (botRule.enforcement !== g.enforcement) {
        errors.push(
          `enforcement disagrees for \`${f}\`: bot-rules.ts says \`${botRule.enforcement}\`, ` +
          `mechanism \`${g.id}\` says \`${g.enforcement}\` — the two registries must not mean ` +
          `different things by the same word.`,
        );
      }
    }
  }

  // ── (5) a `global` mechanism reads no bot column.
  for (const g of guard) {
    if (g.scope === 'global' && g.fields.length) {
      errors.push(
        `stop-guardian.service.ts: mechanism \`${g.id}\` is \`global\` but declares \`fields\` ` +
        `(${g.fields.join(', ')}). One implementation for all bots has no per-bot column.`,
      );
    }
  }

  return { errors, bot: bot.length, guard: guard.length, claimed: claiming.length };
}

// ── The self-test. ⚠️ Fixtures are INLINE so it needs no files, and every rule is driven once
//    with input that MUST fail and once with input that must pass.
const BOT_GOOD = `
export const BOT_RULES: BotRule[] = [
  { field: 'slPct', label: 'Stop loss %', stage: 'exit', enforcement: 'live',
    enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts',
    summary: 'x' },
  { field: 'simTslEnabled', label: 'Simulated TSL', stage: 'exit', enforcement: 'display-only',
    enforcedBy: '${GUARDIAN_PATH}',
    summary: 'x' },
  { field: 'hotStockMaxHoldHours', label: 'Hot stock max hold', stage: 'exit', enforcement: 'none', enforcedBy: null,
    summary: 'x' },
];`;
const GUARD_GOOD = `
export const GUARDIAN_RULES: GuardianRule[] = [
  { id: 'simulated-tsl', label: 'Simulated TSL', kind: 'rule', scope: 'per-bot',
    fields: ['simTslEnabled'],
    enforcement: 'display-only', value: 'v', detail: 'd' },
  { id: 'atr-trailing-stop', label: 'ATR', kind: 'input', scope: 'global',
    enforcement: 'live', value: 'v', detail: 'd' },
];`;
const always = () => true;

function selfTest() {
  const cases = [
    ['the two registries agreeing', () => check(BOT_GOOD, GUARD_GOOD, always).errors, false],

    // (1) a named enforcer that does not exist on disk.
    // ⚠️ Needs a DISCRIMINATING stub — with the permissive `always`, every path "exists" and the
    // case cannot fail. ⚠️ And it must match on `includes`: `fileExists` receives the FULL relative
    // path (`nest/src/...`), so an equality test against the bare filename never fires either. A
    // fixture that cannot fail is not a test of the rule — it is a fixture of the test.
    ['an `enforcedBy` naming a file that does not exist',
      () => check(BOT_GOOD.replace('automation-loop.service.ts', 'nowhere.service.ts'), GUARD_GOOD,
        (rel) => !rel.includes('nowhere.service.ts')).errors, true],

    // (2a) the OMISSION — a column claiming the guardian that no mechanism declares
    ['a column claiming the guardian with NO mechanism declaring it (the real defect)',
      () => check(BOT_GOOD.replace("enforcedBy: 'nest/src/modules/automation/automation-loop.service.ts'", `enforcedBy: '${GUARDIAN_PATH}'`), GUARD_GOOD, always).errors, true],

    // (2b) the DUPLICATION — one column, two mechanisms
    ['a column declared by TWO mechanisms (the duplication the owner saw)',
      () => check(BOT_GOOD, GUARD_GOOD.replace("{ id: 'atr-trailing-stop', label: 'ATR', kind: 'input', scope: 'global',",
        "{ id: 'atr-trailing-stop', label: 'ATR', kind: 'input', scope: 'per-bot',\n    fields: ['simTslEnabled'],"), always).errors, true],

    // (3) a mechanism reading a column that does not exist
    ['a mechanism listing a field `bot-rules.ts` does not declare',
      () => check(BOT_GOOD, GUARD_GOOD.replace("fields: ['simTslEnabled']", "fields: ['notAColumn']"), always).errors, true],

    // (4) the two registries disagreeing on enforcement
    ['a mechanism and its column disagreeing on `enforcement`',
      () => check(BOT_GOOD, GUARD_GOOD.replace("enforcement: 'display-only', value: 'v', detail: 'd'", "enforcement: 'live', value: 'v', detail: 'd'"), always).errors, true],

    // (5) a global mechanism claiming a per-bot column
    ['a `global` mechanism declaring `fields`',
      () => check(BOT_GOOD, GUARD_GOOD.replace("{ id: 'atr-trailing-stop', label: 'ATR', kind: 'input', scope: 'global',",
        "{ id: 'atr-trailing-stop', label: 'ATR', kind: 'input', scope: 'global',\n    fields: ['simTslEnabled'],"), always).errors, true],

    // an unreadable attribution
    ['a rule declaring neither `enforcedBy` nor `null`',
      () => check(BOT_GOOD.replace(', enforcedBy: null', ''), GUARD_GOOD, always).errors, true],

    // ⚠️ THE INVERSE: a parser that sees nothing must ERROR, never pass.
    ['an unparseable bot-rules array', () => check('const nothing = 1;', GUARD_GOOD, always).errors, true],
    ['an unparseable guardian array', () => check(BOT_GOOD, 'const nothing = 1;', always).errors, true],
  ];

  let bad = 0;
  for (const [label, run, shouldFail] of cases) {
    let errs;
    try { errs = run(); } catch (e) { console.log(`  ✗ SELF-TEST THREW: "${label}" — ${e.message}`); bad++; continue; }
    if ((errs.length > 0) !== shouldFail) {
      console.log(`  ✗ SELF-TEST INVALID: "${label}" — expected ${shouldFail ? 'a violation' : 'none'}, got ${errs[0] || 'none'}`);
      bad++;
    }
  }
  if (bad) {
    console.log(`\n  ✗ ${bad} self-test case(s) misbehaved — the rules are not doing what this file claims.`);
    return 1;
  }
  console.log(`  ✅ self-test: ${cases.length} cases — every rule observed to fail on invalid input, and valid input observed to pass.`);
  return 0;
}

function main() {
  if (process.argv.slice(2).includes('--self-test')) process.exit(selfTest());

  let botText, guardText;
  try {
    botText = fs.readFileSync(BOT_RULES_FILE, 'utf8');
    guardText = fs.readFileSync(GUARDIAN_FILE, 'utf8');
  } catch (e) {
    console.error(`FATAL: cannot read a registry — ${e.message}`);
    process.exit(1);
  }

  const fileExists = (rel) => fs.existsSync(path.join(ROOT, rel));
  const r = check(botText, guardText, fileExists);

  if (r.errors.length) {
    console.error(`\n  ✗ rule-enforcement: ${r.errors.length} violation(s)\n`);
    for (const e of r.errors) console.error(`      ${e}`);
    console.error('');
    process.exit(1);
  }

  console.log(`  [rule-enforcement] ✅ ${r.bot} declared rule(s); ${r.guard} guardian mechanism(s); ${r.claimed} column(s) claim the guardian and every one is declared by exactly one mechanism`);
  console.log(`  [rule-enforcement] ⚠️  this checks the two DECLARATIONS agree — it cannot prove the code reads the column it lists.`);
  process.exit(0);
}

main();
