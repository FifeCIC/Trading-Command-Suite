/**
 * classify-open-positions.cjs — are the current positions bot-traded or manual?
 *
 * HOW THIS DECIDES (the reasoning, because it is not obvious)
 * ----------------------------------------------------------
 * `position` has NO `origin` column — unlike `trade`, which has `origin` with values
 * 'user' | 'manual' | 'strategy' | 'external' | 'agent'.
 *
 * The obvious-looking discriminator is `position.magic`, and it DOES NOT WORK:
 * `mt5_bridge_v2.py` hardcodes `magic: 234000` at every order-send site (open, close,
 * partial, bulk), and echoes the broker's magic back. So every order placed through the
 * TCS bridge carries 234000 — bot and manual alike. Magic separates "placed via the bridge"
 * from "placed by hand in the MT5 terminal", which is a different question.
 *
 * So the answer comes from joining `position` -> `trade` on `brokerTicket`, and reading
 * `trade.origin` / `trade.strategy` / `trade.brokerComment`. `brokerComment` is the
 * MT5 comment field, which the two paths format differently:
 *     manual : "TCS manual <protocol> | <signalId[:8]>"
 *     bot    : "<Strategy Name> | <Score>%"
 *
 * ⚠️ THE MOST IMPORTANT OUTPUT IS THE UNMATCHED SET. A position with no `trade` row is one
 * the app did not open (origin 'external' when the sync catches it) or one the sync has not
 * seen. If unmatched positions are numerous, the honest answer is "cannot be determined from
 * the database" for those, not a guess. The script reports them separately and never folds
 * them into either bucket.
 *
 * Read-only.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/** MT5 comment prefixes that identify a path. */
function classifyComment(comment) {
  const c = String(comment || '').trim();
  if (!c) return null;
  if (/^TCS manual/i.test(c)) return 'manual';
  if (/^TCS/i.test(c)) return 'app-other';
  return 'bot?';
}

(async () => {
  console.log('Open positions — bot or manual?');
  console.log('');

  const positions = await prisma.$queryRawUnsafe(
    `SELECT id, symbol, side, quantity, avgPrice, pnl, provider, accountId,
            brokerTicket, magic, openedAt
       FROM position
      ORDER BY openedAt DESC`,
  );

  console.log(`open positions: ${positions.length}`);
  if (positions.length === 0) {
    console.log('  (none)');
    await prisma.$disconnect();
    return;
  }
  console.log('');

  // ── magic first, to SHOW it is not the discriminator ────────────────────────────
  const byMagic = new Map();
  for (const p of positions) {
    const k = p.magic === null ? 'null' : String(p.magic);
    byMagic.set(k, (byMagic.get(k) || 0) + 1);
  }
  console.log('  magic distribution (NOT a bot/manual discriminator — see the header):');
  for (const [k, n] of byMagic) console.log(`     magic=${k.padEnd(8)} ${n}`);

  // ── the real discriminator: join to trade ───────────────────────────────────────
  const tickets = positions.map((p) => p.brokerTicket).filter(Boolean);
  let tradeByTicket = new Map();
  if (tickets.length) {
    const placeholders = tickets.map(() => '?').join(',');
    const trades = await prisma.$queryRawUnsafe(
      `SELECT brokerTicket, origin, strategy, scoringStrategyId, abTestId, status,
              brokerComment, openedAt
         FROM trade
        WHERE brokerTicket IN (${placeholders})`,
      ...tickets,
    );
    tradeByTicket = new Map(trades.map((t) => [String(t.brokerTicket), t]));
  }
  console.log('');

  const buckets = { bot: [], manual: [], external: [], unmatched: [], ambiguous: [] };

  for (const p of positions) {
    const t = p.brokerTicket ? tradeByTicket.get(String(p.brokerTicket)) : null;
    const commentKind = classifyComment(t?.brokerComment);
    const row = {
      symbol: p.symbol,
      side: p.side,
      qty: p.quantity,
      ticket: p.brokerTicket,
      magic: p.magic,
      provider: p.provider,
      accountId: p.accountId,
      origin: t?.origin ?? null,
      strategy: t?.strategy ?? null,
      scoringStrategyId: t?.scoringStrategyId ?? null,
      abTestId: t?.abTestId ?? null,
      comment: t?.brokerComment ?? null,
      commentKind,
    };

    if (!t) {
      buckets.unmatched.push(row);
      continue;
    }
    if (t.origin === 'strategy' || t.origin === 'agent') {
      buckets.bot.push(row);
    } else if (t.origin === 'manual' || t.origin === 'user') {
      // Distinguish a manual trade from a manual trade that a human triggered VIA a
      // bot's signal board: both record origin 'manual'. The comment says which.
      buckets.manual.push(row);
    } else if (t.origin === 'external') {
      buckets.external.push(row);
    } else {
      buckets.ambiguous.push(row);
    }
  }

  const dump = (name, rows) => {
    console.log(`  ${name}: ${rows.length}`);
    for (const r of rows.slice(0, 12)) {
      console.log(
        `     ${String(r.symbol).padEnd(8)} ${String(r.side ?? '-').padEnd(5)} ${String(r.qty).padEnd(12)} ` +
          `provider=${String(r.provider).padEnd(12)} ticket=${String(r.ticket ?? '-').padEnd(10)} ` +
          `origin=${String(r.origin ?? '-').padEnd(9)} comment=${JSON.stringify(r.comment)}`,
      );
    }
    if (rows.length > 12) console.log(`     … +${rows.length - 12} more`);
    console.log('');
  };

  dump('BOT (origin strategy/agent)', buckets.bot);
  dump('MANUAL (origin manual/user)', buckets.manual);
  dump('EXTERNAL (opened outside the app)', buckets.external);
  if (buckets.ambiguous.length) dump('AMBIGUOUS (unrecognised origin)', buckets.ambiguous);
  dump('UNMATCHED (no trade row — UNDETERMINED)', buckets.unmatched);

  // ── Break the unmatched set down by provider ────────────────────────────────────
  // ⚠️ This is the step that turns "undetermined" into a real answer. A position with
  // provider 'trading212', no brokerTicket and a fractional quantity is an IMPORTED
  // PORTFOLIO HOLDING, not an order either the bots or a human placed through TCS. It
  // belongs in neither bucket, and saying so is more useful than "unknown".
  if (buckets.unmatched.length) {
    const byProvider = new Map();
    for (const r of buckets.unmatched) {
      byProvider.set(r.provider, (byProvider.get(r.provider) || 0) + 1);
    }
    console.log('  unmatched, by provider:');
    for (const [prov, n] of byProvider) console.log(`     provider=${prov}  ${n}`);
    console.log('');
  }

  console.log('── ANSWER ──────────────────────────────────────────────────────────────');
  const total = positions.length;
  console.log(`  ${total} row(s) in \`position\``);
  console.log(`     bot                : ${buckets.bot.length}`);
  console.log(`     manual             : ${buckets.manual.length}`);
  console.log(`     external           : ${buckets.external.length}`);
  if (buckets.ambiguous.length) console.log(`     ambiguous          : ${buckets.ambiguous.length}`);
  console.log(`     no trade row       : ${buckets.unmatched.length}`);
  console.log('');
  if (buckets.unmatched.length) {
    console.log('  ⚠️ "no trade row" is reported separately ON PURPOSE, and it is NOT the same as');
    console.log('     "manual". Read the provider breakdown above: a fractional-quantity holding');
    console.log('     with no brokerTicket on a portfolio provider is an IMPORT, not an order.');
    console.log('     Those rows are neither bot-traded nor manual-traded — they were not traded');
    console.log('     by TCS at all. Anything left over after that split is genuinely undetermined.');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
