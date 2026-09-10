/**
 * validate-symbol-references.cjs — Referential-integrity guard for symbol refs.
 * ===========================================================================
 * OPERATOR RULE (2026-09-10):
 *   "As for the other symbols — they must exist in the database tables at all
 *    times else they should not be able to be included in anything in the plugin."
 *
 * Why this exists
 * ---------------
 * `symbol_protocol_assignment.symbol` and `watchlist.symbols` are FREE TEXT —
 * `symbol` is a VARCHAR with NO foreign key to the `symbol` table, and
 * `watchlist.symbols` is a JSON array of plain strings. Writes are therefore
 * permissive; only the READ path fails, and it fails silently and much later:
 *
 *     resolvedSymbols → marketData.getBars(sym.id, ...) → sym is undefined
 *
 * Real incident: XAGUSD was assigned to `xau-speed-v1` and appears in two
 * watchlists, but no `symbol` row was ever created. It rendered a permanent
 * "Not scored" ladder card that looked like a transient state ("waiting"), when
 * the truth was a misconfiguration nothing would ever repair. Both MT5 bridges
 * priced it the whole time.
 *
 * This guard closes the asymmetry: a symbol reference that cannot be scored is
 * now a BUILD-TIME failure instead of a silent runtime dead end.
 *
 * Checks (each keyed to the table it protects):
 *   1. symbol_protocol_assignment.symbol → symbol.ticker
 *   2. watchlist.symbols[]               → symbol.ticker   (skips UUID entries)
 *   3. trading_strategy.symbol           → symbol.ticker
 *   4. symbol_route.symbol               → symbol.ticker
 *
 * Usage:
 *   node scripts/validate-symbol-references.cjs            # report only
 *   node scripts/validate-symbol-references.cjs --strict    # exit 1 on findings
 *
 * Exit codes: 0 = clean (or report-only), 1 = findings under --strict,
 *             2 = could not connect (never blocks a build on DB availability).
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  // nest/.env holds DATABASE_URL; Prisma does not auto-load it in plain node.
  for (const p of [path.join(ROOT, 'nest', '.env'), path.join(ROOT, '.env')]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}

// A watchlist entry that looks like a UUID is an id reference, not a ticker.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  loadEnv();
  const strict = process.argv.includes('--strict');

  let PrismaClient;
  try {
    ({ PrismaClient } = require(path.join(ROOT, 'nest', 'node_modules', '@prisma', 'client')));
  } catch {
    console.log('[validate-symbol-references] Prisma client unavailable — skipped.');
    process.exit(0);
  }

  const prisma = new PrismaClient();
  const findings = [];

  try {
    const symbols = await prisma.symbol.findMany({ select: { ticker: true } });
    const known = new Set(symbols.map((s) => String(s.ticker).toUpperCase()));

    const missing = (t) => !known.has(String(t ?? '').toUpperCase());

    // 1. Protocol assignments
    const assignments = await prisma.symbolProtocolAssignment.findMany({
      select: { symbol: true, protocolId: true },
    });
    for (const a of assignments) {
      if (missing(a.symbol)) {
        findings.push({
          table: 'symbol_protocol_assignment',
          symbol: a.symbol,
          detail: `assigned to protocol ${a.protocolId} — symbol row missing, so getBars() has no id and it can never be scored`,
        });
      }
    }

    // 2. Watchlist membership (JSON string arrays)
    const watchlists = await prisma.watchlist.findMany({ select: { name: true, symbols: true } });
    for (const w of watchlists) {
      const list = Array.isArray(w.symbols) ? w.symbols : [];
      for (const raw of list) {
        // Entries may be bare strings ("XAUUSD") or objects ({ticker|symbol}).
        // Objects used to stringify to "[object Object]" — resolve the field.
        let t;
        if (raw && typeof raw === 'object') {
          t = String(raw.ticker ?? raw.symbol ?? '').trim();
        } else {
          t = String(raw ?? '').trim();
        }
        if (!t || UUID_RE.test(t)) continue;
        if (missing(t)) {
          findings.push({
            table: 'watchlist',
            symbol: t,
            detail: `listed in watchlist "${w.name}" — symbol row missing`,
          });
        }
      }
    }

    // 3. Trading bots
    const bots = await prisma.tradingStrategy.findMany({
      select: { name: true, symbol: true, active: true },
    });
    for (const b of bots) {
      if (missing(b.symbol)) {
        findings.push({
          table: 'trading_strategy',
          symbol: b.symbol,
          detail: `bot "${b.name}"${b.active ? ' (ACTIVE)' : ''} targets an unregistered symbol — it can never fire`,
        });
      }
    }

    // 4. Routes
    let routes = [];
    try {
      routes = await prisma.symbolRoute.findMany({ select: { symbol: true, brokerId: true } });
    } catch {
      /* table may not exist on older installs */
    }
    for (const r of routes) {
      if (missing(r.symbol)) {
        findings.push({
          table: 'symbol_route',
          symbol: r.symbol,
          detail: `routed to broker ${r.brokerId} — symbol row missing`,
        });
      }
    }
  } catch (err) {
    console.log(`[validate-symbol-references] Could not query DB (${err.message}) — skipped.`);
    await prisma.$disconnect();
    process.exit(2);
  }

  await prisma.$disconnect();

  if (findings.length === 0) {
    console.log(
      `[validate-symbol-references] OK — every symbol reference resolves (${4} tables checked).`,
    );
    process.exit(0);
  }

  console.log(
    `[validate-symbol-references] ${findings.length} orphaned symbol reference(s) found:\n`,
  );
  for (const f of findings) {
    console.log(`  ✗ ${f.symbol}  [${f.table}]`);
    console.log(`      ${f.detail}`);
  }
  console.log(
    '\nFIX: either register the symbol (see nest/prisma/seed-symbol-onboarding.ts)\n' +
      '     or remove the reference. An unregistered symbol cannot be scored, so a\n' +
      '     reference to one is always a defect — never a transient state.',
  );

  process.exit(strict ? 1 : 0);
}

main().catch((err) => {
  console.error('[validate-symbol-references] fatal:', err.message);
  process.exit(2);
});
