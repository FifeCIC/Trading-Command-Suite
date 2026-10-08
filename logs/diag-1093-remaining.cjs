/**
 * #1093 diagnostic — why do the remaining ticketed gaps not resolve? (measurement only, not production)
 *
 * Reproduces, offline, exactly what the app's finaliser sees for each of the current ticketed gap
 * rows: which deals match the stored ticket (as positionId OR orderId), which side they are, what
 * `reason`/`comment` they carry, and against each bridge's retention boundary.
 *
 * Usage: node logs/diag-1093-remaining.cjs
 */
const mysql = require('c:/wamp64/www/trading-command-suite/nest/node_modules/mysql2/promise');

const BRIDGES = [
  { port: 5000, name: ':5000 (MetaQuotes)' },
  { port: 5001, name: ':5001 (Pepperstone)' },
];

(async () => {
  const db = await mysql.createConnection({
    host: 'localhost', user: 'tradingcs', password: 'tradingcs_dev_2026', database: 'tradingcs',
  });

  const [rows] = await db.query(
    `SELECT id, symbol, side, brokerTicket, openedAt, closedAt, exitPrice, pnl
     FROM trade
     WHERE provider='mt5' AND status='closed'
       AND (closeReason IS NULL OR closeReason='broker:unknown')
       AND brokerTicket IS NOT NULL AND brokerTicket <> ''
     ORDER BY closedAt ASC`,
  );

  const dealsByBridge = [];
  for (const b of BRIDGES) {
    const res = await fetch(`http://localhost:${b.port}/history/deals?days=120`).then((r) => r.json()).catch(() => ({ deals: [] }));
    const deals = res.deals || [];
    const oldest = deals.map((d) => d.time).sort()[0] ?? '(none)';
    const newest = deals.map((d) => d.time).sort().slice(-1)[0] ?? '(none)';
    console.log(`${b.name}: ${deals.length} deals, oldest=${oldest}, newest=${newest}`);
    dealsByBridge.push(deals);
  }
  console.log(`\nticketed gap rows: ${rows.length}\n`);

  const buckets = { served_closing: [], served_opening_only: [], unserved_inside: [], unserved_beyond: [] };

  for (const r of rows) {
    const ticket = String(r.brokerTicket);
    const opened = new Date(r.openedAt);
    let matched = [];
    let onBridge = '(none)';
    for (let i = 0; i < dealsByBridge.length; i += 1) {
      const hits = dealsByBridge[i].filter((d) => String(d.orderId) === ticket || String(d.positionId) === ticket);
      if (hits.length) { matched = hits; onBridge = BRIDGES[i].name; break; }
    }
    if (matched.length === 0) {
      // Not in either fetch window. Is the row INSIDE a window at all?
      const oldest5000 = dealsByBridge[0].map((d) => new Date(d.time)).sort((a, b) => a - b)[0] ?? new Date(0);
      const oldest5001 = dealsByBridge[1].map((d) => new Date(d.time)).sort((a, b) => a - b)[0] ?? new Date(0);
      const inside5000 = opened >= oldest5000;
      const inside5001 = opened >= oldest5001;
      const bucket = inside5000 || inside5001 ? buckets.unserved_inside : buckets.unserved_beyond;
      bucket.push({ ...r, inside5000, inside5001, oldest5000, oldest5001 });
      continue;
    }
    const sides = matched.map((d) => d.side).join(',');
    const closingSide = String(r.side).toLowerCase() === 'sell' ? 'buy' : 'sell';
    const exitDeals = matched.filter((d) => d.side === closingSide);
    const rec = { ...r, onBridge, n: matched.length, sides, reasons: matched.map((d) => d.reason).join(','), comments: matched.map((d) => JSON.stringify(d.comment)).join(' ') };
    if (exitDeals.length > 0) {
      rec.exitReason = exitDeals[exitDeals.length - 1].reason;
      rec.exitComment = exitDeals[exitDeals.length - 1].comment;
      buckets.served_closing.push(rec);
    } else {
      buckets.served_opening_only.push(rec);
    }
  }

  console.log('SERVED WITH A CLOSING DEAL:', buckets.served_closing.length);
  for (const r of buckets.served_closing) {
    console.log(`  ${r.symbol} ${r.side} tk=${r.brokerTicket} closed=${r.closedAt.toISOString().slice(0, 16)} bridge=${r.onBridge} deals=${r.n} sides=${r.sides} exitReason=${r.exitReason} exitComment=${JSON.stringify(r.exitComment)}`);
  }
  console.log('\nSERVED, OPENING DEAL ONLY (no closing side found):', buckets.served_opening_only.length);
  for (const r of buckets.served_opening_only) {
    console.log(`  ${r.symbol} ${r.side} tk=${r.brokerTicket} closed=${r.closedAt.toISOString().slice(0, 16)} bridge=${r.onBridge} deals=${r.n} sides=${r.sides} reasons=${r.reasons} comments=${r.comments}`);
  }
  console.log('\nUNSERVED, OPENED INSIDE A WINDOW (should have been found!):', buckets.unserved_inside.length);
  for (const r of buckets.unserved_inside) {
    console.log(`  ${r.symbol} ${r.side} tk=${r.brokerTicket} opened=${r.openedAt.toISOString().slice(0, 16)} closed=${r.closedAt.toISOString().slice(0, 16)} inside5000=${r.inside5000} inside5001=${r.inside5001}`);
  }
  console.log('\nUNSERVED, OPENED BEFORE BOTH WINDOWS (retention wall):', buckets.unserved_beyond.length);
  for (const r of buckets.unserved_beyond.slice(0, 8)) {
    console.log(`  ${r.symbol} ${r.side} tk=${r.brokerTicket} opened=${r.openedAt.toISOString().slice(0, 16)} closed=${r.closedAt.toISOString().slice(0, 16)}`);
  }
  if (buckets.unserved_beyond.length > 8) console.log(`  … and ${buckets.unserved_beyond.length - 8} more`);

  const [nulls] = await db.query(
    `SELECT COUNT(*) n, MIN(closedAt) oldest, MAX(closedAt) newest FROM trade
     WHERE provider='mt5' AND status='closed' AND (closeReason IS NULL OR closeReason='broker:unknown')
       AND (brokerTicket IS NULL OR brokerTicket='')`,
  );
  console.log(`\nunticketed gap rows: ${nulls[0].n}, closed ${nulls[0].oldest?.toISOString?.().slice(0, 10)} → ${nulls[0].newest?.toISOString?.().slice(0, 10)}`);

  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
