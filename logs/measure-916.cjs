/**
 * measure-916.cjs — #916 / #1059: NAME the actor closing winners early.
 *
 * Read-only. Uses the repo's ONE mysql connection layer.
 *
 * The sprint's headline is: every active bot declares tpPct/slPct = 2.0, but the realised payoff is
 * 0.54 and there is ONE `broker:tp` close in 377. So something else closes winners.
 *
 * ⚠️ RAW ROWS, DERIVED IN THE OPEN. `ratio` = how far price actually moved, as a fraction of the
 * move the trade's OWN take-profit asked for: |exit-entry| / |tp-entry|. A winner closed at 0.18 is
 * a winner taken at 18% of its target. Printing the derivation means the number can be checked.
 */
const path = require('path');
const { query, connect } = require(path.resolve(__dirname, '..', 'scripts', 'lib', 'mysql-cli.cjs'));
const conn = connect();

function tsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
  if (!lines.length) return [];
  return lines.slice(1).map((l) => l.split('\t'));
}

const rows = tsv(query(
  `SELECT symbol, side, entryPrice, exitPrice, pnl, status, origin, closeReason, tp, sl,
          openedAt, closedAt, TIMESTAMPDIFF(MINUTE, openedAt, closedAt) AS holdMin
     FROM trade
    WHERE status = 'closed' AND pnlInvalid = 0 AND closedAt IS NOT NULL AND exitPrice IS NOT NULL;`,
  conn,
)).map(([symbol, side, entry, exit, pnl, status, origin, closeReason, tp, sl, openedAt, closedAt, holdMin]) => ({
  symbol, side,
  entry: Number(entry), exit: Number(exit), pnl: Number(pnl),
  origin, closeReason: closeReason || '(NULL)',
  tp: tp === 'NULL' ? null : Number(tp), sl: sl === 'NULL' ? null : Number(sl),
  openedAt, closedAt, holdMin: holdMin === 'NULL' ? null : Number(holdMin),
}));

console.log(`[trade] ${rows.length} closed, valid-P&L rows\n`);

/** How far price moved toward this trade's OWN take-profit. null when tp is absent. */
function ratio(r) {
  if (r.tp == null || !r.entry) return null;
  const intended = Math.abs(r.tp - r.entry);
  if (!intended) return null;
  return Math.abs(r.exit - r.entry) / intended;
}
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const p = (v, d = 2) => (v == null ? '—' : v.toFixed(d));

const byReason = new Map();
for (const r of rows) {
  const k = r.closeReason;
  if (!byReason.has(k)) byReason.set(k, []);
  byReason.get(k).push(r);
}

console.log('=== BY closeReason (the actor) ===');
console.log('reason'.padEnd(22) + 'n'.padStart(5) + 'wins'.padStart(6) + 'win%'.padStart(7) + 'avgPnl'.padStart(10) + 'medHoldH'.padStart(10) + 'med%ofTP'.padStart(10) + '  tp present');
for (const [k, g] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const wins = g.filter((r) => r.pnl > 0).length;
  const holds = g.map((r) => r.holdMin).filter((h) => h != null && h >= 0).map((h) => h / 60);
  const ratios = g.map(ratio).filter((x) => x != null);
  const withTp = g.filter((r) => r.tp != null).length;
  console.log(
    k.padEnd(22) + String(g.length).padStart(5) + String(wins).padStart(6) +
    String(((wins / g.length) * 100).toFixed(0)).padStart(7) +
    p(avg(g.map((r) => r.pnl))).padStart(10) +
    p(med(holds)).padStart(10) +
    p(med(ratios), 3).padStart(10) +
    `  ${withTp}/${g.length}`,
  );
}

// The headline: WINNERS, and how much of their own target they captured.
const winners = rows.filter((r) => r.pnl > 0);
const wRatios = winners.map(ratio).filter((x) => x != null);
console.log(`\n=== WINNERS (pnl > 0): ${winners.length} of ${rows.length} ===`);
console.log(`  median %ofTP captured : ${p(med(wRatios), 3)}`);
console.log('  by reason:');
const wByReason = new Map();
for (const r of winners) { const k = r.closeReason; if (!wByReason.has(k)) wByReason.set(k, []); wByReason.get(k).push(r); }
for (const [k, g] of [...wByReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const ratios = g.map(ratio).filter((x) => x != null);
  console.log(`    ${k.padEnd(22)} n=${String(g.length).padStart(4)}  med%ofTP=${p(med(ratios), 3)}  avgPnl=${p(avg(g.map((r) => r.pnl)))}  medHoldH=${p(med(g.map((r) => r.holdMin).filter((h) => h != null).map((h) => h / 60)))}`);
}

// The #917 contradiction: the time stop is documented as never firing, yet system:time-stop closes exist.
const ts = byReason.get('system:time-stop') || [];
if (ts.length) {
  const holds = ts.map((r) => r.holdMin).filter((h) => h != null).map((h) => h / 60);
  console.log(`\n=== system:time-stop — ${ts.length} closes (#917 says the stop never fires) ===`);
  console.log(`  hold hours: min=${p(Math.min(...holds))} median=${p(med(holds))} max=${p(Math.max(...holds))}`);
  console.log(`  wins=${ts.filter((r) => r.pnl > 0).length}  avgPnl=${p(avg(ts.map((r) => r.pnl)))}`);
  const hist = new Map();
  for (const h of holds) { const b = h < 1 ? '<1h' : h < 4 ? '1-4h' : h < 12 ? '4-12h' : h < 24 ? '12-24h' : '>=24h'; hist.set(b, (hist.get(b) || 0) + 1); }
  console.log('  hold histogram: ' + [...hist.entries()].map(([b, c]) => `${b}=${c}`).join('  '));
}

// Which trade is the single take-profit close?
const tps = byReason.get('broker:tp') || [];
console.log(`\n=== broker:tp — ${tps.length} close(s) ===`);
for (const r of tps) console.log(`  ${r.symbol} ${r.side} pnl=${r.pnl} ratio=${p(ratio(r), 3)} holdH=${p(r.holdMin / 60)} origin=${r.origin}`);
