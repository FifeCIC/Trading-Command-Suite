/**
 * identity-map.cjs — "which column holds which identity?", measured rather than assumed.
 *
 * ⚠️ TEMPORARY / DIAGNOSTIC. Writes public/identity-map.json for the /lab/identity-map page.
 *
 * WHY THIS EXISTS
 * ---------------
 * 123 reference-shaped columns exist (excluding each table's own `id`), spanning 22 tables for
 * "protocol" alone. **122 of the 123 have no foreign key.** So nothing enforces that a column
 * named `protocolId` holds a protocol, or WHICH protocol identifier it holds (UUID or slug).
 *
 * That is the mechanism behind a recurring class of defect: a column is named for an identity,
 * a reader trusts the name, and the value is from a different space. Measured examples:
 *   • `trade.scoringStrategyId` — 35% bot ids, 13% protocol slugs, 52% orphaned UUIDs
 *   • `trading_strategy.protocolId` holds BOTH (varchar(36)); `scoring_strategy.protocolId`
 *     is varchar(100) — the same NAME, two widths, two value spaces.
 *   • `brokerId` is `int` on symbol_route but `varchar(50)` on trading_strategy.
 *
 * This script classifies every reference column's ACTUAL values against the known identity
 * spaces, so the disagreement is visible in one place instead of being rediscovered per bug.
 *
 * Run:  node nest/scripts/identity-map.cjs
 * Out:  public/identity-map.json
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/** Identity families, by column-name family. Order matters: first match wins. */
const FAMILIES = [
  { key: 'protocol', label: 'Protocol', test: (c) => /protocol/i.test(c) },
  { key: 'strategy', label: 'Strategy / bot', test: (c) => /strateg/i.test(c) },
  { key: 'symbol', label: 'Symbol', test: (c) => /symbol|ticker|watchlist/i.test(c) },
  { key: 'broker', label: 'Broker / account', test: (c) => /broker|account|provider/i.test(c) },
  { key: 'other', label: 'Other', test: () => true },
];

const familyOf = (columnName) => FAMILIES.find((f) => f.test(columnName)).key;

/** Distinct-value cap per column. Enough to characterise a value space without scanning everything. */
const SAMPLE = 200;

async function main() {
  // ── 1. The identity spaces a value could belong to ──────────────────────
  const protocols = await prisma.$queryRawUnsafe('SELECT id, slug, name, active FROM protocol');
  const bots = await prisma.$queryRawUnsafe('SELECT id, name, protocolId, symbol, active FROM trading_strategy');
  const scoring = await prisma.$queryRawUnsafe('SELECT id, name, protocolId FROM scoring_strategy');
  const symbols = await prisma.$queryRawUnsafe('SELECT id, ticker FROM symbol');

  const spaces = {
    'protocol.id': new Set(protocols.map((p) => p.id)),
    'protocol.slug': new Set(protocols.map((p) => p.slug).filter(Boolean)),
    'trading_strategy.id': new Set(bots.map((b) => b.id)),
    'scoring_strategy.id': new Set(scoring.map((s) => s.id)),
    'symbol.id': new Set(symbols.map((s) => s.id)),
    'symbol.ticker': new Set(symbols.map((s) => s.ticker).filter(Boolean)),
  };

  // ── 2. Every reference-shaped column, and whether anything enforces it ──
  const cols = await prisma.$queryRawUnsafe(`
    SELECT c.TABLE_NAME AS t, c.COLUMN_NAME AS col, c.COLUMN_TYPE AS ty, c.IS_NULLABLE AS nullable,
      (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE k
        WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
          AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL) AS fk
    FROM information_schema.COLUMNS c
    WHERE c.TABLE_SCHEMA = DATABASE()
      AND c.COLUMN_NAME <> 'id'
      AND (c.COLUMN_NAME LIKE '%Id' OR c.COLUMN_NAME LIKE '%slug%'
           OR c.COLUMN_NAME LIKE '%ticker%' OR c.COLUMN_NAME LIKE '%symbol%')
    ORDER BY c.TABLE_NAME, c.COLUMN_NAME
  `);

  const rows = [];
  for (const c of cols) {
    const table = String(c.t);
    const col = String(c.col);
    let sample = [];
    let totalRows = null;
    let nonNull = null;
    try {
      const t = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM \`${table}\``);
      totalRows = Number(t[0].n);
      const nn = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${col}\` IS NOT NULL AND \`${col}\` <> ''`,
      );
      nonNull = Number(nn[0].n);
      sample = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT \`${col}\` AS v FROM \`${table}\`
          WHERE \`${col}\` IS NOT NULL AND \`${col}\` <> '' LIMIT ${SAMPLE}`,
      );
    } catch {
      // Column or table unreadable — record it rather than silently dropping it.
      // ⚠️ This branch MUST emit the same shape as the success branch below. An earlier version
      // omitted `drawsFrom`, and the page then threw `Cannot read properties of undefined` while
      // filtering — i.e. the map reproducing the exact defect class it exists to expose (a record
      // written by one path, read as though written by another). Unreadable is a THIRD state:
      // not "fine", not "empty" — say so explicitly.
      rows.push({
        table, column: col, type: String(c.ty), family: familyOf(col),
        enforced: Number(c.fk) > 0,
        unreadable: true,
        nullable: c.nullable === 'YES',
        totalRows: null, nonNull: null, distinctSampled: 0,
        drawsFrom: [], ambiguous: false, unmatched: null, sample: [],
      });
      continue;
    }

    const values = sample.map((r) => String(r.v));
    const matches = {};
    for (const [space, set] of Object.entries(spaces)) {
      matches[space] = values.filter((v) => set.has(v)).length;
    }
    const hitAny = values.filter((v) => Object.values(spaces).some((s) => s.has(v))).length;
    const unmatched = values.length - hitAny;

    // The spaces this column draws from, biggest first. Empty = it matches no known identity,
    // which is a finding in itself (orphans, free text, or a space we have not identified).
    const drawsFrom = Object.entries(matches)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([space, n]) => ({ space, n }));

    rows.push({
      table, column: col, type: String(c.ty), family: familyOf(col),
      enforced: Number(c.fk) > 0,
      nullable: c.nullable === 'YES',
      totalRows, nonNull,
      distinctSampled: values.length,
      drawsFrom,
      ambiguous: drawsFrom.length > 1,
      unmatched,
      sample: values.slice(0, 6),
    });
  }

  // ── 3. Same NAME, different TYPE across tables — a schema-level tell ────
  const byName = {};
  for (const r of rows) (byName[r.column] ||= []).push(r);
  const nameConflicts = Object.entries(byName)
    .map(([column, uses]) => ({
      column,
      types: [...new Set(uses.map((u) => u.type))],
      tables: uses.length,
      enforcedAnywhere: uses.some((u) => u.enforced),
      uses: uses.map((u) => ({ table: u.table, type: u.type, drawsFrom: u.drawsFrom })),
    }))
    .filter((c) => c.types.length > 1)
    .sort((a, b) => b.tables - a.tables);

  const map = {
    generatedAt: new Date().toISOString(),
    headline: {
      referenceColumns: rows.length,
      enforced: rows.filter((r) => r.enforced).length,
      unenforced: rows.filter((r) => !r.enforced).length,
      ambiguous: rows.filter((r) => r.ambiguous).length,
      matchesNothingKnown: rows.filter((r) => !r.unreadable && r.drawsFrom.length === 0).length,
    },
    families: FAMILIES.map((f) => ({
      key: f.key,
      label: f.label,
      columns: rows.filter((r) => r.family === f.key).length,
      tables: new Set(rows.filter((r) => r.family === f.key).map((r) => r.table)).size,
    })),
    spaces: Object.fromEntries(
      Object.entries(spaces).map(([k, v]) => [k, v.size]),
    ),
    /** What each spine table's own protocol-ish columns actually contain. */
    spineEvidence: [
      { table: 'protocol', note: '47 rows. Has BOTH `id` (UUID) and `slug` — two identities for one protocol.' },
      { table: 'trading_strategy', note: `27 rows. protocolId varchar(36) = UUID width; scoringStrategyId varchar(36) is a THIRD protocol-ish column.` },
      { table: 'scoring_strategy', note: '27 rows. protocolId varchar(100) = slug width. Same NAME as trading_strategy.protocolId, different space likely.' },
      { table: 'strategy_protocol', note: '26 rows. protocolId varchar(100). This is the table queue routing actually reads.' },
    ],
    nameConflicts,
    columns: rows.sort((a, b) => a.family.localeCompare(b.family) || a.table.localeCompare(b.table)),
  };

  // Written into src/data so the page IMPORTS it as a module: no fetch, no API endpoint, and no
  // backend restart needed to view it. ⚠️ This is a SNAPSHOT — re-run the script after schema or
  // data changes, or the page will confidently show a stale map.
  const out = path.join(__dirname, '..', '..', 'src', 'data', 'identity-map.json');
  fs.writeFileSync(out, JSON.stringify(map, null, 1));
  console.log(`[identity-map] wrote ${out}`);
  console.log(`[identity-map] ${map.headline.referenceColumns} reference columns — ` +
    `${map.headline.enforced} enforced, ${map.headline.unenforced} free text`);
  console.log(`[identity-map] ${map.headline.ambiguous} draw from MORE THAN ONE identity space`);
  console.log(`[identity-map] ${map.headline.matchesNothingKnown} match NO known identity`);
  console.log(`[identity-map] ${nameConflicts.length} column names have conflicting types across tables`);
  for (const c of nameConflicts.slice(0, 8)) {
    console.log(`   ${c.column}: ${c.types.join(' vs ')} (${c.tables} tables)`);
  }
}

main()
  .catch((e) => { console.error('[identity-map] FAILED:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
