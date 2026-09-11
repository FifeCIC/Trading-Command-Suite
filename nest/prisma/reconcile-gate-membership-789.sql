-- reconcile-gate-membership-789.sql
-- ============================================================================
-- Move the 4 directional voters found by INV-GATE-MEMBERSHIP out of their risk
-- gates, mirroring the edit to protocols-seed-data.ts.
--
-- ⚠️ WHY THIS IS REQUIRED AND NOT OPTIONAL
-- ---------------------------------------------------------------------------
-- `ProtocolDbService.seedProtocolsToDatabase()` is UPSERT-ONLY: it creates and
-- updates but NEVER deletes. So removing/moving a directiveId in the seed file
-- does NOT move the `protocol_directive_entry` row — re-seeding alone leaves the
-- old placement in place. Proven live in #789: after removing 15 placements and
-- re-seeding, the API reported `entries: 419` (down from 434) while the DB still
-- held all 14 obsolete risk rows. The count reflects rows UPSERTED, not rows
-- that EXIST, so it reads exactly like a successful removal.
--
-- The correct sequence is: edit the seed, re-seed, THEN run this file.
--
-- ⚠️ COLLATION: `protocol_directive_group.id` and `protocol_directive_entry.groupId`
-- have different collations and MUST both be pinned with COLLATE utf8mb4_unicode_ci
-- or the join fails with ER_CANT_AGGREGATE_2COLLATIONS (1267).
--
-- Idempotent: safe to run repeatedly. Run SELECT first, then the DELETEs.

-- ── 0. what is there now ────────────────────────────────────────────────────
SELECT p.slug            AS protocol,
       g.id              AS group_id,
       g.isRiskGate      AS is_risk_gate,
       e.directiveId     AS directive
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p
         ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 WHERE e.directiveId IN ('btc-halving-cycle', 'crypto-weekend-effect', 'earnings-momentum')
 ORDER BY p.slug, g.isRiskGate DESC, g.sortOrder;

-- ── 1. remove the 4 obsolete placements from the risk gates ─────────────────
-- These directives are NOT deleted from the protocols — they are MOVED to a
-- scoring group by the re-seed. Only the risk-gate row is obsolete.
DELETE e FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
 WHERE g.isRiskGate = 1
   AND e.directiveId IN ('btc-halving-cycle', 'crypto-weekend-effect', 'earnings-momentum');

-- ── 2. verify: no voter is left in a risk gate ──────────────────────────────
-- Expect ZERO rows. Any row here means a category='structural' test would fail.
SELECT p.slug AS protocol, g.id AS gate, e.directiveId AS voter_still_in_gate
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p
         ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 WHERE g.isRiskGate = 1
   AND e.directiveId IN ('btc-halving-cycle', 'crypto-weekend-effect', 'earnings-momentum');

-- ── 3. verify: the directives now sit in scoring groups ─────────────────────
-- Expect 4 rows, all is_risk_gate = 0.
SELECT p.slug AS protocol, g.id AS scoring_group, e.directiveId AS directive
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p
         ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 WHERE e.directiveId IN ('btc-halving-cycle', 'crypto-weekend-effect', 'earnings-momentum')
 ORDER BY p.slug;

-- ── 4. verify: no protocol double-counts a directive ────────────────────────
-- Expect ZERO rows.
SELECT p.slug AS protocol, e.directiveId AS duplicated, COUNT(*) AS n
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g
         ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p
         ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 GROUP BY p.slug, e.directiveId
HAVING COUNT(*) > 1;
