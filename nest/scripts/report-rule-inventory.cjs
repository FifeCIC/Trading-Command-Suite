/**
 * report-rule-inventory.cjs — every rule between "a bot has an opinion" and "an order is placed",
 * in ONE place, with how often each one actually fired.
 *
 * ── WHY THIS EXISTS (owner, 2026-11-04) ──────────────────────────────────────────────────────────
 * "Rule inventory sounds like an idea we should have already had, all rule types available to bots in
 * one place with global stats from ALL activity." A bot's rules were spread across the automation
 * loop, the queue, the duplicate guard, the risk gates and the exit path, and NOTHING answered
 * "which rule is actually stopping me?" without grepping a log. The gates are cheap to enumerate and
 * the evidence was already being written to `decision_log` — it just had no single reader.
 *
 * ⚠️ MEASURED THE LIMIT OF THE DATA FIRST. Refusals reach this report through `decision_log.reason`
 * text, because `decision_trail` (where AuditLogService sends pre-trade blocks) had **0 rows** when
 * this was written — nothing persists a structured blocker key. So the mapping below is a small,
 * explicit TEXT CLASSIFIER over known messages, and `unclassified` is reported loudly rather than
 * dropped: a rule that fires but cannot be named would otherwise vanish from the inventory, which is
 * exactly the "plausible numbers, no error" signature this repo keeps paying for.
 *
 * Run:
 *   node nest/scripts/report-rule-inventory.cjs              # global, all time
 *   node nest/scripts/report-rule-inventory.cjs --days 30    # window
 *   node nest/scripts/report-rule-inventory.cjs --bot "Gold Scalp M5 Bot"
 *   node nest/scripts/report-rule-inventory.cjs --self-test  # prove the classifier can fail
 */
const path = require('path');

const RULES = [
  {
    key: 'duplicate-position',
    name: 'Duplicate position guard',
    layer: 'pre-trade',
    enforced: 'nest/src/modules/trading/duplicate-guard.service.ts + pyramid-policy.service.ts',
    protects: 'one position per symbol+account',
    // ⚠️ NOT a broker rule on every account. Measured 2026-11-04: broker 2 is `netting` (a second
    // order MERGES — the rule is the broker's) while broker 3 is `hedging` (a second order OPENS —
    // so the rule is ours). This note is why the block message should say which.
    variesByAccount: true,
    match: /Duplicate blocked for/i,
  },
  {
    key: 'portfolio-risk-cap',
    name: 'Portfolio at-risk cap',
    layer: 'pre-trade',
    enforced: 'nest/src/modules/trading/risk-*.service.ts (risk.maxPortfolioRisk)',
    protects: 'total open risk as % of equity',
    match: /Portfolio at risk .* exceeds risk\.maxPortfolioRisk/i,
  },
  {
    key: 'per-symbol-cap-unpriceable',
    name: 'Per-symbol cap cannot be evaluated',
    layer: 'pre-trade',
    enforced: 'per-symbol exposure cap (refuses when no quote can price the order)',
    protects: 'per-symbol exposure, when a price is available',
    // ⚠️ This is a REFUSAL ABOUT A REFUSAL: the cap could not be computed, so the order was
    // refused rather than allowed. Counted separately because "we could not check" and "the check
    // failed" have different fixes.
    match: /Cannot evaluate the per-symbol cap for/i,
  },
  {
    key: 'pacing-cooldown',
    name: 'Queue pacing / cooldown',
    layer: 'queue',
    enforced: 'automation-loop.service.ts ([QueueBot] pacing)',
    protects: 'minimum spacing between trades',
    match: /\[QueueBot\] pacing|next trade in/i,
  },
  {
    key: 'session-window',
    name: 'Session window gate',
    layer: 'dispatch',
    enforced: 'automation-loop.service.ts Gate 4.5 (trading_strategy.sessionWindow)',
    protects: 'only trade inside the declared market session',
    match: /session window|outside (the |its )?session|not in (its )?session/i,
    // ⚠️ NARROWED 2026-11-04 after the self-test caught it: `/session/i` matched the PROTOCOL NAME
    // `forex-session-v1`, so every OBSERVED row was counted as a session refusal. A rule must not
    // fire because a name contains a word.
  },
  {
    key: 'max-open-positions',
    name: 'Max open positions (slot limit)',
    layer: 'dispatch',
    enforced: 'automation-loop.service.ts (Max open positions)',
    protects: 'broker-wide concurrent position count',
    match: /Max open positions/i,
  },
];

const EXIT_RULES = [
  { key: 'exit-time-stop', name: 'Time stop', match: /time-stop/i },
  { key: 'exit-stop-loss', name: 'Broker stop loss', match: /sl/i },
  { key: 'exit-take-profit', name: 'Broker take profit', match: /tp/i },
  { key: 'exit-manual', name: 'Manual close', match: /manual/i },
  { key: 'exit-reconciled', name: 'Reconciled', match: /reconciled/i },
];

/** Classify one decision_log reason. Returns a rule key or null. PURE — self-tested below. */
function classifyReason(reason) {
  const text = String(reason || '');
  if (!text) return null;
  // Order matters only where two patterns could overlap; `portfolio-risk-cap` is checked before the
  // generic ones because its message also contains the word "risk" from other rules.
  if (/Portfolio at risk .* exceeds risk\.maxPortfolioRisk/i.test(text)) return 'portfolio-risk-cap';
  if (/Cannot evaluate the per-symbol cap for/i.test(text)) return 'per-symbol-cap-unpriceable';
  if (/Duplicate blocked for/i.test(text)) return 'duplicate-position';
  if (/\[QueueBot\] pacing|next trade in/i.test(text)) return 'pacing-cooldown';
  if (/Max open positions/i.test(text)) return 'max-open-positions';
  if (/session window|outside (the |its )?session|not in (its )?session/i.test(text)) return 'session-window';
  return null;
}

function selfTest() {
  const ok = (label, cond) => {
    if (cond) console.log(`  ✅ ${label}`);
    else { console.log(`  ✖  ${label}`); process.exitCode = 1; }
  };
  console.log('[rule-inventory] self-test');
  ok('duplicate message classifies', classifyReason('Duplicate blocked for XAUUSD: 1 open position(s) on MT5.') === 'duplicate-position');
  ok('portfolio cap classifies', classifyReason('Portfolio at risk 15.7% exceeds risk.maxPortfolioRisk 15% — #1 XAUUSD') === 'portfolio-risk-cap');
  ok('cap-not-evaluable classifies', classifyReason('Cannot evaluate the per-symbol cap for USTEC: quote cannot price this order') === 'per-symbol-cap-unpriceable');
  ok('pacing classifies', classifyReason('[QueueBot] pacing — next trade in 10m') === 'pacing-cooldown');
  ok('slot limit classifies', classifyReason('Max open positions (20) reached') === 'max-open-positions');
  ok('an OBSERVED row (no refusal) is NOT a rule firing', classifyReason('forex-session-v1: composite=59 signal=BUY') === null);
  // ⚠️ THE CANARY THAT CAUGHT A REAL BUG: a protocol NAMED `forex-session-v1` must not look like a
  // session refusal. `/session/i` did exactly that, and the self-test above is what found it.
  ok('a protocol NAME containing "session" is not a session refusal', classifyReason('probe-1dir-v1: composite=60 signal=STRONG_BUY') === null);
  ok('empty reason is not a firing', classifyReason('') === null && classifyReason(null) === null);
  // ⚠️ CANARY — the patterns must not be so wide that every message matches. If this ever reports a
  // key, the classifier has started claiming rules fired when they did not.
  ok('an unrelated message is NOT claimed as a rule', classifyReason('MT5 connected (broker 2)') === null);
  if (process.exitCode === 1) console.log('[rule-inventory] ✖ self-test FAILED');
  else console.log('[rule-inventory] ✅ self-test passed');
}

function parseArgs(argv) {
  const out = { days: null, bot: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') out.days = Number(argv[++i]);
    else if (argv[i] === '--bot') out.bot = argv[++i];
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (process.argv.includes('--self-test')) { selfTest(); process.exit(process.exitCode || 0); }

  const { PrismaClient } = require(path.resolve(__dirname, '..', 'node_modules', '@prisma/client'));
  const prisma = new PrismaClient();

  (async () => {
    const where = args.days ? `AND timestamp > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${Number(args.days)} DAY)` : '';
    const rows = await prisma.$queryRawUnsafe(
      `SELECT decision, reason, strategyId, symbol, COUNT(*) n
       FROM decision_log WHERE decision IN ('BLOCKED','SKIP','FAILED') ${where}
       GROUP BY decision, reason, strategyId, symbol ORDER BY n DESC`,
    );

    // Global tally + which bot each firing belongs to.
    const counts = new Map();
    const perBot = new Map();
    let unclassified = 0;
    for (const r of rows) {
      const key = classifyReason(r.reason);
      const n = Number(r.n);
      if (!key) { unclassified += n; continue; }
      counts.set(key, (counts.get(key) || 0) + n);
      const bot = String(r.strategyId || '').slice(0, 8) || '(no bot)';
      if (!perBot.has(key)) perBot.set(key, new Map());
      perBot.get(key).set(bot, (perBot.get(key).get(bot) || 0) + n);
    }

    const totalRefusals = [...counts.values()].reduce((a, b) => a + b, 0) + unclassified;

    console.log(`\n[rule-inventory] refusals in the window: ${totalRefusals}${args.days ? ` (last ${args.days}d)` : ' (all time)'}`);
    console.log(`  classified: ${totalRefusals - unclassified}   ⚠️ unclassified: ${unclassified}\n`);
    console.log('  fired  rule                                layer       what it protects');
    console.log('  -----  ----------------------------------  ----------  --------------------------------');
    for (const rule of RULES) {
      const n = counts.get(rule.key) || 0;
      const mark = n === 0 ? '  never' : String(n).padStart(7);
      console.log(`  ${mark}  ${rule.name.padEnd(34)}  ${rule.layer.padEnd(10)}  ${rule.protects}`);
    }

    if (args.bot) {
      console.log(`\n=== per-bot: ${args.bot} ===`);
      const bots = await prisma.$queryRawUnsafe(`SELECT id, name FROM trading_strategy WHERE name LIKE ?`, `%${args.bot}%`);
      for (const b of bots) {
        const short = String(b.id).slice(0, 8);
        const parts = RULES.map((r) => [r.key, perBot.get(r.key)?.get(short) || 0]).filter(([, n]) => n > 0);
        console.log(`  ${b.name} (${short})`);
        if (!parts.length) console.log('    no refusal recorded against this bot');
        for (const [k, n] of parts) console.log(`    ${String(n).padStart(5)}  ${k}`);
      }
    }

    console.log('\n=== exit rules (trade.closeReason, all time) ===');
    const ex = await prisma.$queryRawUnsafe(
      `SELECT IFNULL(closeReason,'(none)') c, COUNT(*) n FROM trade WHERE closedAt IS NOT NULL GROUP BY c ORDER BY n DESC`,
    );
    for (const r of ex) {
      const rule = EXIT_RULES.find((x) => x.match.test(String(r.c)));
      console.log(`  ${String(Number(r.n)).padStart(5)}  ${String(r.c).padEnd(18)} ${rule ? rule.name : '(unclassified)'}`);
    }

    console.log('\n⚠️ `duplicate-position` is account-dependent: netting MERGES a second order, hedging');
    console.log('   OPENS one. Read `positionModel` from /api/health before treating its count as a fault.');

    await prisma.$disconnect();
  })().catch(async (e) => { console.error('ERR', e.message); await prisma.$disconnect(); process.exit(1); });
}

module.exports = { classifyReason, RULES, EXIT_RULES };
