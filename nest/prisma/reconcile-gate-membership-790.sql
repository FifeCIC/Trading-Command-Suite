-- reconcile-gate-membership-790.sql
-- ============================================================================
-- #790 — remove the obsolete RISK-GATE rows for `spy-qqq-relative-strength` after
-- moving it into scoring groups in `protocols-seed-data.ts`.
--
-- ⚠️ WHY THIS IS REQUIRED (the same reason as #789/#792)
-- ---------------------------------------------------------------------------
-- `ProtocolDbService.seedProtocolsToDatabase()` is **UPSERT-ONLY** — it creates and
-- updates but NEVER deletes. Moving a directive between groups therefore ADDS the new
-- placement but leaves the old row behind. Re-seeding cannot converge them.
--
-- `scripts/diff-seed-vs-db.cjs` caught exactly this straight after the edit:
--     KIND-CHANGED (3)  ⚠️ the gate/scoring kind differs, so whether it SCORES AT ALL differs
--       · dxy-sensitivity-v1 :: spy-qqq-relative-strength   seed scoring [sentiment] vs db GATE [risk]
--       · forex-session-v1   :: spy-qqq-relative-strength   seed scoring [sentiment] vs db GATE [risk]
--       · mt5-technical-short:: spy-qqq-relative-strength   seed scoring [bearish-sentiment] vs db GATE [short-risk]
--
-- ⚠️ THIS IS THE CASE THE GATE-3 CHECK WAS BUILT FOR. Without it the directive would have
-- been present in BOTH a scoring group and a gate, and the scorer's `seenDirectiveIds`
-- dedupe would silently pick whichever came first — so the fix would have appeared not to
-- work, with no error. That is the #789 duplicate trap again.
--
-- ⚠️ COLLATION: pin `COLLATE utf8mb4_unicode_ci` on BOTH sides of every join, or MySQL
-- raises ER_CANT_AGGREGATE_2COLLATIONS (1267).
--
-- Idempotent: safe to re-run. SELECT first, then DELETE, then verify.

-- ── 0. what is there now (expect the 3 obsolete gate rows) ──────────────────
SELECT p.slug AS protocol, g.id AS group_id, g.isRiskGate AS is_risk_gate, e.directiveId
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p
         ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 WHERE e.directiveId = 'spy-qqq-relative-strength'
 ORDER BY p.slug, g.isRiskGate DESC;

-- ── 1. delete ONLY the obsolete gate rows for this one directive ────────────
-- Scoped by directiveId, so no other directive's placement can be touched.
DELETE e FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
 WHERE g.isRiskGate = 1
   AND e.directiveId = 'spy-qqq-relative-strength';

-- ── 2. verify: no gate row remains (expect ZERO rows) ──────────────────────
SELECT p.slug AS protocol, g.id AS gate, e.directiveId AS still_in_gate
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p
         ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 WHERE g.isRiskGate = 1
   AND e.directiveId = 'spy-qqq-relative-strength';

-- ── 3. verify: it now sits in scoring groups only (expect 4 rows, all 0) ───
SELECT p.slug AS protocol, g.id AS scoring_group, g.isRiskGate
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p
         ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 WHERE e.directiveId = 'spy-qqq-relative-strength'
 ORDER BY p.slug;

-- ── 4. verify: no protocol double-counts any directive (expect ZERO) ───────
SELECT p.slug AS protocol, e.directiveId AS duplicated, COUNT(*) AS n
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p
         ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 GROUP BY p.slug, e.directiveId
HAVING COUNT(*) > 1;
