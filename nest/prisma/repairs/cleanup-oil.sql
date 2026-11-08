-- ============================================================================
-- WTI / oil-speed-v1 cleanup
-- ============================================================================
-- THE SITUATION, PLAINLY:
--
-- `oil-speed-v1` ("Oil Speed Scalp V1") is a protocol for trading OIL. It was
-- assigned three symbols — USOIL, UKOIL, NATGAS — and NONE of the three could
-- ever fetch data, because none of those names exist on the price provider:
--
--   USOIL   not offered (the provider calls crude "WTI")
--   UKOIL   not offered (no Brent contract exists at all)
--   NATGAS  not offered (no natural-gas contract exists at all)
--
-- So the protocol had zero usable data from the day it was seeded. It is also
-- INACTIVE and has no trading bots attached, so it was never going to trade
-- regardless — it was inert, not broken-and-trading.
--
-- The USOIL -> WTI rename already applied (fix-symbol-tickers.sql) gives this
-- protocol its ONE valid instrument. WTI now has 3,001 bars across 6 timeframes,
-- live. UKOIL and NATGAS have no equivalent on this provider and never will, so
-- their assignments are removed: leaving them would keep reporting as starved and
-- imply a capability that does not exist.
--
-- This does NOT activate oil-speed-v1. Whether oil is worth trading, and at what
-- cadence, is a strategy decision — not something the data layer should decide by
-- silently enabling a protocol.
-- ============================================================================

START TRANSACTION;

-- ── 1. Drop the assignments for instruments this provider does not offer ─────
DELETE a FROM symbol_protocol_assignment a
 WHERE a.symbol IN ('UKOIL', 'NATGAS');

-- ── 2. Retire the un-offerable symbol rows in place (keep them visible) ──────
UPDATE `symbol`
   SET active = 0, updatedAt = NOW(),
       name = CONCAT(name, ' [not offered by this broker — no equivalent contract; #760]')
 WHERE ticker IN ('UKOIL', 'NATGAS');

-- ── 3. Confirm WTI is the one oil instrument and is reachable ────────────────
UPDATE `symbol` SET active = 1, type = 'commodity', updatedAt = NOW()
 WHERE ticker = 'WTI';

COMMIT;

-- ── 4. Verify ────────────────────────────────────────────────────────────────
SELECT '--- oil symbols after cleanup ---' AS phase;
SELECT s.ticker, s.active, s.name,
       (SELECT COUNT(*) FROM marketbar b WHERE b.symbolId = s.id) AS bars,
       (SELECT COUNT(*) FROM symbol_protocol_assignment a WHERE a.symbol = s.ticker) AS assigns
FROM `symbol` s
WHERE s.ticker IN ('WTI', 'USOIL', 'UKOIL', 'NATGAS')
ORDER BY s.active DESC, s.ticker;
