-- ============================================================================
-- #760 — provider routing for bar refresh
-- ============================================================================
-- Adds `symbol_route.provider` so a symbol can declare WHICH provider serves its
-- bars, then routes the crypto symbols to binance (their actual source).
--
-- WHY
-- ---
-- `symbol_route` already existed to pick a BROKER per symbol (that is how
-- UK100/GER40/FRA40/XAGUSD choose between bridges). The bar-refresh loop, however,
-- hardcoded `adapterFactory.create('mt5')` and wrote `provider: 'mt5'` for every
-- row — so `binance.adapter.ts` was implemented, correct, and never called.
--
-- Consequence: crypto was fetched once and then aged out. BTCUSD last saw data
-- 54 days ago, DOGEUSD 39, BTC-USD 16. The symbols stayed `active` in the registry
-- and kept being resolved for scoring, so protocols depending on them produced
-- nothing while reporting `scoring` — the same silent-empty failure as #758.
--
-- Reusing `symbol_route` rather than inventing a second routing table follows the
-- shared-core rule: one mechanism per job. `provider` defaults to 'mt5', which is
-- the behaviour every existing symbol already had, so nothing that works today
-- changes.
-- ============================================================================

-- ── 1. Add the provider column (idempotent-ish: fails harmlessly if present) ──
ALTER TABLE symbol_route
  ADD COLUMN provider VARCHAR(32) NOT NULL DEFAULT 'mt5' AFTER brokerSymbol;

-- ── 2. Route crypto to its real provider ─────────────────────────────────────
-- brokerId 0 = "no MT5 broker" — these are not bridge symbols at all. The column
-- is NOT NULL with no default, so 0 is used as the explicit marker rather than
-- inventing a fake broker id.
INSERT INTO symbol_route (id, symbol, brokerId, brokerSymbol, provider, priority, enabled, note, createdAt, updatedAt)
VALUES
  (UUID(), 'BTC',   0, NULL, 'binance', 0, 1, '#760 crypto via binance (not an MT5 symbol)', NOW(), NOW()),
  (UUID(), 'ETH',   0, NULL, 'binance', 0, 1, '#760 crypto via binance (not an MT5 symbol)', NOW(), NOW()),
  (UUID(), 'SOL',   0, NULL, 'binance', 0, 1, '#760 crypto via binance (not an MT5 symbol)', NOW(), NOW()),
  (UUID(), 'DOGE',  0, NULL, 'binance', 0, 1, '#760 crypto via binance (not an MT5 symbol)', NOW(), NOW())
ON DUPLICATE KEY UPDATE provider = 'binance', enabled = 1, updatedAt = NOW();

-- ── 3. Verify ────────────────────────────────────────────────────────────────
SELECT '--- routing table ---' AS phase;
SELECT symbol, brokerId, provider, enabled, note FROM symbol_route ORDER BY provider, symbol;
