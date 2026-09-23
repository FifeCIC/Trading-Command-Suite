-- ============================================================================================
-- #959 — `symbol.exchange` held two FABRICATED placeholders. Remove them.
-- ============================================================================================
--
-- ⚠️ WHY THIS IS A NULLABLE COLUMN CHANGE, NOT A VALUE EDIT
--
-- `exchange` was `NOT NULL`. A NOT NULL column cannot represent "this symbol has never been
-- delivered by any provider", so the schema forced a value to be invented — and the onboarding
-- seeder supplied one: `exchange: s.exchange ?? 'Xtrend'`. Measured 2026-09-23:
--
--     Xtrend     29 rows   (a broker name; there is no Xtrend exchange and no Xtrend adapter)
--     MetaQuotes  1 row    (the MT5 PLATFORM, declared by hand on GRML)
--     Unknown     1 row    (an adapter fallback, `x || 'Unknown'` in 5 adapters)
--     ---------
--     31 of 258 rows (12%) carried a value that cannot be true.
--
-- Absence needs to be representable. That is the fix; deleting the values is the consequence.
-- Same rule as INV-NO-FABRICATED-READING: absence must not become a value.
--
-- ⚠️ THE AUTHORITATIVE SOURCE IS `marketbar.provider`, NOT `symbol_route.provider`.
-- `docs/symbol-data-coverage-audit.md` says so explicitly:
--   "Do not assume `symbol_route.provider` is the same quantity — it is a different table."
-- So step 2 reads `marketbar`, which records what ACTUALLY DELIVERED bars.
--
-- ⚠️ Run with `ALTER TABLE` — NEVER `prisma db push` (it would DROP the 13 unmodelled tables,
-- including the trade execution queue). See database-schema.instructions.md and #769.
--
-- Applied: 2026-09-23.  Model updated in the same commit: `exchange String? @db.VarChar(50)`.
-- ============================================================================================

-- ── 1. Make absence representable ───────────────────────────────────────────────────────────
ALTER TABLE symbol MODIFY exchange VARCHAR(50) NULL;

-- ── 2. Reconcile every placeholder row to its AUTHORITATIVE source ──────────────────────────
--
-- Set `exchange` to the provider that actually delivered bars (`marketbar.provider`), via the
-- symbolId relation. Rows that never delivered anything are set to NULL by step 3 — they have no
-- source, and naming one would be the original defect in a new costume.
UPDATE symbol s
  JOIN (SELECT symbolId, MIN(provider) AS provider
          FROM marketbar
         GROUP BY symbolId) mb ON mb.symbolId = s.id
   SET s.exchange = mb.provider
 WHERE s.exchange IN ('Xtrend', 'MetaQuotes', 'Unknown');

-- ── 3. Anything left holding a placeholder never delivered a bar — NULL is the truth ────────
--
-- Measured before this step: GRML (route mt5/2 but NO bars), BTCUSD (superseded by BTC-USD),
-- DJI30 (superseded by US30), VWS (no bars, no route). Four rows, none with a real source.
UPDATE symbol
   SET exchange = NULL
 WHERE exchange IN ('Xtrend', 'MetaQuotes', 'Unknown');

-- ── 4. Verify ───────────────────────────────────────────────────────────────────────────────
-- Expect: no row holding 'Xtrend' / 'MetaQuotes' / 'Unknown'.
--   SELECT exchange, COUNT(*) n FROM symbol GROUP BY exchange ORDER BY n DESC;
-- Expect: mt5 has absorbed the 27 delivered CFDs (26 mt5 + DOGEUSD from binance), and 4 rows are NULL.
