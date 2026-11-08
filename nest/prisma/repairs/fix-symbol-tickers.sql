-- ============================================================================
-- Fix the four symbol tickers MT5 does not recognise (Mode C, see
-- docs/symbol-data-coverage-audit.md)
-- ============================================================================
-- These four have ZERO bars, ever, because the ticker spelled in the registry is
-- not a ticker MT5 offers. Four ACTIVE protocols depend on them and therefore
-- cannot score at all: spy-day-v1, spy-speed-v1, qqq-day-v1, qqq-speed-v1,
-- oil-speed-v1.
--
-- Verified against GET http://localhost:5000/symbols (12,411 symbols):
--   US500  present   USTEC  present   WTI   present   US30  present
--
-- Three renames are unambiguous (target ticker does not exist yet).
-- DJI30 -> US30 is NOT applied here: a US30 row already exists (mt5-sourced,
-- 1,400 bars, stale since 2026-07-24), so that pair needs a MERGE decision —
-- which row survives and what happens to the other's bars/assignments is a
-- judgement call, not a mechanical rename.
-- ============================================================================

START TRANSACTION;

-- ── 1. SPX500 -> US500 (S&P 500) — unblocks spy-day-v1, spy-speed-v1 ────────
UPDATE `symbol` SET ticker = 'US500', updatedAt = NOW()
 WHERE ticker = 'SPX500';
UPDATE `symbol_protocol_assignment` SET symbol = 'US500'
 WHERE symbol = 'SPX500';

-- ── 2. TECH100 -> USTEC (Nasdaq 100) — unblocks qqq-day-v1, qqq-speed-v1 ────
UPDATE `symbol` SET ticker = 'USTEC', updatedAt = NOW()
 WHERE ticker = 'TECH100';
UPDATE `symbol_protocol_assignment` SET symbol = 'USTEC'
 WHERE symbol = 'TECH100';

-- ── 3. USOIL -> WTI (crude) — unblocks oil-speed-v1 ────────────────────────
UPDATE `symbol` SET ticker = 'WTI', type = 'commodity', updatedAt = NOW()
 WHERE ticker = 'USOIL';
UPDATE `symbol_protocol_assignment` SET symbol = 'WTI'
 WHERE symbol = 'USOIL';

COMMIT;

-- ── 4. Report what changed ───────────────────────────────────────────────────
SELECT '--- AFTER ---' AS phase;
SELECT ticker, type, active,
       (SELECT COUNT(*) FROM marketbar b WHERE b.symbolId = s.id) AS bars,
       (SELECT COUNT(*) FROM symbol_protocol_assignment a WHERE a.symbol = s.ticker) AS assignments
FROM `symbol` s
WHERE ticker IN ('US500','USTEC','WTI','US30','DJI30')
ORDER BY ticker;
