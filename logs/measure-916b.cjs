/**
 * measure-916b.cjs — is the early exit the STOP? For each close, compare the exit price to the
 * trade's own `sl`, and compare the SL distance to the TP distance.
 *
 * If `|exit - sl|` is ~0 for the winners, then the actor is a stop-out, and
 * `|sl - entry| / |tp - entry|` IS the %ofTP the trade captures. That turns "winners exit at 9.5%
 * of target" from a correlation into a mechanism with a number attached.
 */
const path = require('path');
const { query, connect } = require(path.resolve(__dirname, '..', 'scripts', 'lib', 'mysql-cli.cjs'));
const conn = connect();

function tsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
  return lines.length ? lines.slice(1).map((l) => l.split('\t')) : [];
}

const rows = tsv(query(
  `SELECT side, entryPrice, exitPrice, pnl, closeReason, tp, sl,
          ABS(exitPrice - sl) / NULLIF(ABS(tp - entryPrice), 0) AS exitVsSl,
          ABS(sl - entryPrice) / NULLIF(ABS(tp - entryPrice), 0) AS slVsTp
     FROM trade
    WHERE status = 'closed' AND pnlInvalid = 0 AND closedAt IS NOT NULL
      AND exitPrice IS NOT NULL AND tp IS NOT NULL AND sl IS NOT NULL;`,
  conn,
)).map(([side, entry, exit, pnl, closeReason, tp, sl, exitVsSl, slVsTp]) => ({
  side, entry: Number(entry), exit: Number(exit), pnl: Number(pnl),
  closeReason: closeReason || '(NULL)',
  tp: Number(tp), sl: Number(sl),
  exitVsSl: exitVsSl === 'NULL' ? null : Number(exitVsSl),
  slVsTp: slVsTp === 'NULL' ? null : Number(slVsTp),
}));

const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p = (v, d = 3) => (v == null ? '—' : v.toFixed(d));
const NEAR = 0.02; // |exit-sl| within 2% of the TP distance is counted as "exited AT the stop"

console.log(`[trade] ${rows.length} closed rows that carry BOTH tp and sl\n`);
console.log('reason'.padEnd(22) + 'n'.padStart(5) + 'medSL/TP'.padStart(10) + 'exit@SL'.padStart(9) + '  (share)');
const by = new Map();
for (const r of rows) { const k = r.closeReason; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
for (const [k, g] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const atSl = g.filter((r) => r.exitVsSl != null && Math.abs(r.exitVsSl) <= NEAR).length;
  console.log(
    k.padEnd(22) + String(g.length).padStart(5) +
    p(med(g.map((r) => r.slVsTp).filter((x) => x != null))).padStart(10) +
    String(atSl).padStart(9) + `  (${((atSl / g.length) * 100).toFixed(0)}%)`,
  );
}

const wins = rows.filter((r) => r.pnl > 0);
console.log(`\nWINNERS with tp+sl: ${wins.length}`);
console.log(`  median  SL/TP distance ratio  : ${p(med(wins.map((r) => r.slVsTp).filter((x) => x != null)))}`);
const wAtSl = wins.filter((r) => r.exitVsSl != null && Math.abs(r.exitVsSl) <= NEAR);
console.log(`  winners that exited AT the SL : ${wAtSl.length}/${wins.length} (${((wAtSl.length / wins.length) * 100).toFixed(0)}%)`);

// Declared slPct/tpPct is meant to be 2.0 — so is the stored SL actually at the declared distance?
const declared = rows.filter((r) => r.tp && r.entry && r.sl);
console.log(`\n  sample (first 6) — entry / sl / tp / SL÷TP:`);
for (const r of declared.slice(0, 6)) {
  console.log(`    ${r.closeReason.padEnd(20)} entry=${r.entry} sl=${r.sl} tp=${r.tp}  SL÷TP=${p(r.slVsTp)}  pnl=${r.pnl}`);
}
