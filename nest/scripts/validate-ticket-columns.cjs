#!/usr/bin/env node
/**
 * validate-ticket-columns.cjs — a broker ticket is a 64-BIT identifier.
 *
 * ⚠️ WHY THIS GUARD EXISTS (2026-09-22). Four columns stored MT5 tickets in a 32-bit `int`:
 *
 *     decision_log.ticket          104 of 108 rows clamped
 *     trade.ticket                  15 rows clamped
 *     strategy_evaluation.tradeTicket 65 rows clamped
 *     decision_trail.tradeTicket
 *
 * Real MT5 tickets are 12 digits (e.g. 152668901120) and do not fit in int32. MySQL runs
 * NON-STRICT here — `sql_mode` is empty — so every out-of-range write was **silently clamped
 * to 2147483647** instead of erroring. No exception, no log line, a plausible number in the
 * column. 123 rows of real ticket data were destroyed and are NOT recoverable.
 *
 * It got worse than lost data. Someone read the constant 2147483647 as an intentional
 * "MT5 placeholder" and wrote a workaround in `decision-chain.service.ts` that SKIPPED the
 * join on that basis — so the score→evaluation link was quietly abandoned for every clamped
 * trade rather than the corruption being investigated. A wrong explanation in a comment is
 * more expensive than no explanation, because it stops the next reader looking.
 *
 * The fix is not "widen these four columns". It is "nothing may declare a ticket as 32-bit
 * again" — which is what this checks. Three sibling columns (`trade.brokerTicket`,
 * `position.brokerTicket`, `stop_adjustment.tradeTicket`) already used VARCHAR(100) and were
 * never affected, so both `BigInt` and a string are accepted here.
 *
 * Static (reads schema.prisma, no database) so it runs in `prebuild` alongside the others.
 */
const fs = require('fs');
const path = require('path');

const SCHEMA = path.join(__dirname, '..', 'prisma', 'schema.prisma');

/** Anything whose name marks it as a broker/trade ticket. */
const TICKET_NAME = /ticket/i;

/** 32-bit integer types. `Int` in Prisma maps to MySQL `int` — the bug. */
const NARROW_TYPES = new Set(['Int', 'UnsignedInt', 'SmallInt', 'TinyInt', 'MediumInt']);

function main() {
  if (!fs.existsSync(SCHEMA)) {
    console.error(`[ticket-columns] ✖ cannot read ${SCHEMA}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(SCHEMA, 'utf8').split(/\r?\n/);

  const problems = [];
  let model = '(top level)';
  lines.forEach((line, i) => {
    const modelMatch = line.match(/^\s*model\s+(\w+)\s*\{/);
    if (modelMatch) model = modelMatch[1];
    if (/^\s*}/.test(line)) model = '(top level)';

    // `fieldName  Type?  // comment`  — ignore commented-out lines.
    const m = line.match(/^\s*([A-Za-z_]\w*)\s+([A-Za-z_][\w[\]]*)(\?|\[\])?/);
    if (!m) return;
    const [, field, type] = m;
    if (!TICKET_NAME.test(field)) return;
    // Stripped of any @db.* native type — the Prisma scalar is what matters.
    if (!NARROW_TYPES.has(type)) return;
    problems.push(`${model}.${field} is declared ${type} (line ${i + 1})`);
  });

  if (problems.length) {
    console.error('[ticket-columns] ✖ a broker ticket must not be 32-bit:');
    for (const p of problems) console.error('    ' + p);
    console.error('');
    console.error('  A real MT5 ticket is 12 digits (e.g. 152668901120) and MySQL here is');
    console.error('  NON-STRICT, so an out-of-range write is silently clamped to 2147483647');
    console.error('  rather than rejected. Use BigInt (or a string, as trade.brokerTicket does).');
    process.exit(1);
  }

  console.log('[ticket-columns] ✅ OK — no ticket field is declared as a 32-bit integer');
}

main();
