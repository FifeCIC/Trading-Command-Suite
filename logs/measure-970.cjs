/**
 * measure-970.cjs — MEASURE the full set of active bots whose protocol scores symbols the bot
 * itself does not trade (#970).
 *
 * Read-only. Uses the repo's ONE mysql connection layer (`scripts/lib/mysql-cli.cjs`), so it works
 * with the API down and the bridge down. No Prisma client needed.
 *
 * Input : trading_strategy (active=1), symbol_protocol_assignment, watchlist (JSON `symbols`),
 *         decision_log (what the protocol ACTUALLY scored in the window)
 * Output: per-bot verdict — is the bot's own symbol inside the set its protocol scores?
 *
 * ⚠️ Three outcomes, kept apart because they are not the same fault:
 *   ORPHAN  — the protocol scores symbols, but NONE of them is the bot's symbol   (#970)
 *   SILENT  — the protocol scored nothing in the window at all
 *   ok      — the bot's symbol is in the scored set, or in the config set
 * A protocol legitimately scoring many symbols is FINE. Only the bot's OWN symbol being absent is
 * the defect, because that is the one the bot can never act on.
 */
const path = require('path');
const { query, connect } = require(path.resolve(__dirname, '..', 'scripts', 'lib', 'mysql-cli.cjs'));

const WINDOW_DAYS = 7;

/** mysql --batch --raw emits TSV: first line is the header. Return array of string arrays. */
function tsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
  if (!lines.length) return [];
  return lines.slice(1).map((l) => l.split('\t'));
}

/** Pull tickers out of a watchlist `symbols` JSON blob, whichever shape it is in. */
function tickersFromJson(raw) {
  const out = [];
  if (!raw) return out;
  const push = (t) => { const u = String(t).toUpperCase(); if (u && !out.includes(u)) out.push(u); };
  for (const m of raw.matchAll(/"ticker"\s*:\s*"([^"]+)"/g)) push(m[1]);
  if (out.length) return out;
  for (const m of raw.matchAll(/"symbol"\s*:\s*"([^"]+)"/g)) push(m[1]);
  if (out.length) return out;
  for (const m of raw.matchAll(/"([A-Za-z0-9._-]{1,20})"/g)) {
    if (!['ticker', 'symbol', 'id', 'name'].includes(m[1].toLowerCase())) push(m[1]);
  }
  return out;
}

const conn = connect();

const bots = tsv(query(
  `SELECT id, name, symbol, protocolId FROM trading_strategy WHERE active = 1;`, conn,
)).map(([id, name, symbol, protocolId]) => ({ id, name, symbol, protocolId }));

console.log(`[bots] ${bots.length} active`);

// One query for the empirical scored set per protocol (prefix match, as the issue used).
const scoredByProto = new Map();
for (const [protocolId, symbols, cnt] of tsv(query(
  `SELECT ts.protocolId AS p, dl.symbol AS s, COUNT(*) AS c
     FROM trading_strategy ts
     JOIN decision_log dl
       ON dl.reason LIKE CONCAT(ts.protocolId, '%')
      AND dl.timestamp > DATE_SUB(NOW(), INTERVAL ${WINDOW_DAYS} DAY)
    WHERE ts.active = 1
    GROUP BY ts.protocolId, dl.symbol
    ORDER BY c DESC;`, conn,
))) {
  if (!scoredByProto.has(protocolId)) scoredByProto.set(protocolId, []);
  scoredByProto.get(protocolId).push({ symbol: String(symbols).toUpperCase(), count: Number(cnt) });
}

// Config path 1: symbol_protocol_assignment
const assignByProto = new Map();
for (const [protocolId, symbol] of tsv(query(
  `SELECT protocolId, symbol FROM symbol_protocol_assignment;`, conn,
))) {
  if (!assignByProto.has(protocolId)) assignByProto.set(protocolId, []);
  assignByProto.get(protocolId).push(String(symbol).toUpperCase());
}

// Config path 2: watchlist linked by FK (protocolId). Newlines stripped so --raw stays one row.
for (const [protocolId, raw] of tsv(query(
  `SELECT protocolId, REPLACE(REPLACE(symbols, '\\n', ''), '\\r', '') FROM watchlist
    WHERE protocolId IS NOT NULL AND protocolId <> '';`, conn,
))) {
  const list = tickersFromJson(raw);
  if (!list.length) continue;
  if (!assignByProto.has(protocolId)) assignByProto.set(protocolId, []);
  for (const t of list) if (!assignByProto.get(protocolId).includes(t)) assignByProto.get(protocolId).push(t);
}

const rows = bots.map((b) => {
  const pid = String(b.protocolId ?? '');
  const botSym = String(b.symbol ?? '').toUpperCase();
  const scored = scoredByProto.get(pid) || [];
  const cfg = assignByProto.get(pid) || [];
  const emp = scored.map((s) => s.symbol);
  return {
    ...b, botSym, pid, scored, cfg, emp,
    scoredRows: scored.reduce((a, s) => a + s.count, 0),
    inCfg: cfg.includes(botSym), inEmp: emp.includes(botSym),
  };
});

const orphans = rows.filter((r) => !r.inCfg && !r.inEmp && (r.cfg.length || r.emp.length));
const silent = rows.filter((r) => !r.cfg.length && !r.emp.length);
const ok = rows.filter((r) => r.inCfg || r.inEmp);

console.log("\n=== ORPHAN — protocol scores symbols, but NEVER the bot's own symbol ===");
for (const r of orphans) {
  console.log(`\n  !! ${r.name}   (id ${String(r.id).slice(0, 8)})`);
  console.log(`     bot symbol : ${r.botSym}`);
  console.log(`     protocol   : ${r.pid}`);
  console.log(`     scored set : [${r.emp.slice(0, 10).join(', ') || '-'}]  ${r.scoredRows} rows/${WINDOW_DAYS}d`);
  console.log(`     config set : [${r.cfg.slice(0, 10).join(', ') || '-'}]`);
}

console.log('\n=== COUNTS ===');
console.log(`  ORPHAN (scores exist, bot's symbol absent) : ${orphans.length}`);
console.log(`  SILENT (protocol scored nothing in ${WINDOW_DAYS}d)  : ${silent.length}`);
console.log(`  ok                                        : ${ok.length}`);
console.log(`  total active bots                         : ${rows.length}`);

if (process.argv.includes('--json')) {
  console.log('\n' + JSON.stringify(rows.map((r) => ({
    id: r.id, name: r.name, symbol: r.botSym, protocolId: r.pid,
    scoredSet: r.emp, configSet: r.cfg, inEmp: r.inEmp, inCfg: r.inCfg, scoredRows: r.scoredRows,
  })), null, 2));
}
