-- reconcile-rsi-overbought-792.sql
-- ============================================================================
-- Created 2026-09-11. Removes the DB rows for `rsi-overbought` that the seed no
-- longer contains — the live config behind issue #792.
--
-- ⚠️ WHY THIS IS REQUIRED
-- ---------------------------------------------------------------------------
-- `ProtocolDbService.seedProtocolsToDatabase()` is UPSERT-ONLY (creates and
-- updates, never deletes). So when `rsi-overbought` was removed from protocols
-- that are LONG_ONLY, the seed changed but the DATABASE DID NOT — and re-seeding
-- cannot fix it, because there is no delete path.
--
-- Measured 2026-09-11 with `scripts/diff-seed-vs-db.cjs`:
--     seed     : 419 placements (rsi-overbought in 2 protocols)
--     database : 449 placements (rsi-overbought in 30 protocols)
--     ORPHAN   : 30 rows
--
-- `rsi-overbought` declares `directionBias = 'bearish'`, `maxScore = 140`. In a
-- LONG_ONLY protocol it is excluded by the direction rule — from BOTH numerator
-- and denominator — so it does not read as a zero. It silently lowers the
-- REACHABLE CEILING of 28 protocols by 140 points each = 3,920 points. That is
-- issue #792, and these rows are what made it live.
--
-- ⚠️ THE CORRECT SET IS 2 PROTOCOLS: `vix-short-v1`, `mt5-technical-short`.
--    Both are short-side, where a bearish directive is legitimate. Every other
--    row is an orphan of a since-corrected seed.
--
-- Idempotent: safe to re-run. SELECT first, then DELETE, then verify.

-- ── 0. what is there now (expect 30 rows, 28 of them in LONG_ONLY protocols) ─
SELECT p.slug AS protocol,
       p.directionMode AS mode,
       g.id AS group_id,
       g.isRiskGate AS is_risk_gate
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p
         ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 WHERE e.directiveId = 'rsi-overbought'
 ORDER BY p.directionMode, p.slug;

-- ── 1. delete every row EXCEPT the two legitimate short-side protocols ──────
-- The keep-list is written explicitly rather than derived, so this script cannot
-- silently delete more than intended if `directionMode` is ever wrong in the DB.
DELETE e FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p
         ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 WHERE e.directiveId = 'rsi-overbought'
   AND p.slug NOT IN ('vix-short-v1', 'mt5-technical-short');

-- ── 2. verify: expect exactly 2 rows, both short-side ──────────────────────
SELECT p.slug AS protocol, p.directionMode AS mode, g.id AS group_id
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p
         ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 WHERE e.directiveId = 'rsi-overbought';

-- ── 3. verify: count of rsi-overbought rows (expect 2) ─────────────────────
SELECT COUNT(*) AS rsi_overbought_rows
  FROM protocol_directive_entry
 WHERE directiveId = 'rsi-overbought';
