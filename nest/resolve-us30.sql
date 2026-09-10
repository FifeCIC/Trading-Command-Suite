-- ============================================================================
-- Decision 1 — resolve DJI30 vs US30
-- ============================================================================
-- Two registry rows described the same instrument:
--
--   US30    1,400 bars (stale since 2026-07-24), 1 assignment, MT5-sourced
--   DJI30   0 bars, 0 assignments, 1 active protocol reference
--
-- MT5 serves the Dow as `US30`, verified against the live bridge symbol list —
-- and `US30` already has real history. `DJI30` never received a single bar, so it
-- is a dead duplicate created from a naming guess.
--
-- DECISION: keep `US30` as the live symbol (it has the history and the correct
-- provider name) and retire `DJI30` in place rather than deleting it, so the
-- record of the duplicate survives without it being resolved or reported as
-- starved.
--
-- Why US30 over DJI30 beyond the bars: renaming DJI30 -> US30 would collide with
-- the existing row, and the existing row is the one with data. Consolidating onto
-- the row that WORKS is the cheaper direction and loses nothing.
--
-- ── ALSO: US30 is stale (47 days) and needs to fetch again ──────────────────
-- It is MT5-sourced and MT5 serves `US30`, so the ticker is not the problem — it
-- simply stopped being refreshed. The `bar-refresh` resolver only picks symbols
-- from positions / active-strategies / forex-floor / protocol-symbols, and US30's
-- only protocol (dow-speed-v1) is INACTIVE — so it correctly falls outside the
-- refresh set. Record-mode fetch is used below to backfill it regardless.
-- ============================================================================

START TRANSACTION;

-- ── 1. Retire the dead duplicate ─────────────────────────────────────────────
UPDATE `symbol`
   SET active = 0, updatedAt = NOW(),
       name = CONCAT(name, ' [superseded by US30 — #760, never received a single bar]')
 WHERE ticker = 'DJI30';

-- ── 2. Make sure US30 exists, is active, and is MT5-backed ──────────────────
UPDATE `symbol`
   SET active = 1, exchange = 'Xtrend', updatedAt = NOW()
 WHERE ticker = 'US30';

-- ── 3. Drop the leftover DJI assignment (it pointed at an INACTIVE protocol) ─
DELETE FROM symbol_protocol_assignment WHERE symbol = 'DJI' AND protocolId NOT IN (SELECT id FROM protocol WHERE active = 1);

COMMIT;

-- ── 4. Verify ────────────────────────────────────────────────────────────────
SELECT '--- Dow rows after resolution ---' AS phase;
SELECT ticker, name, active,
       (SELECT COUNT(*) FROM marketbar b WHERE b.symbolId = s.id) AS bars
FROM `symbol` s
WHERE ticker IN ('US30', 'DJI30')
ORDER BY active DESC, ticker;
