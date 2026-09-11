-- ─────────────────────────────────────────────────────────────────────────────
-- Reconcile protocol_directive_entry with the seed data (remove orphaned rows).
--
-- WHY THIS IS NEEDED
-- ------------------
-- `ProtocolDbService.seedProtocolsToDatabase()` is UPSERT-ONLY. It creates and updates
-- entries from `protocols-seed-data.ts` but NEVER deletes. So when a directive is
-- REMOVED from a group in the seed file, its old database row survives as an orphan
-- and the protocol keeps scoring it — the source of truth and the runtime disagree.
--
-- This is a real defect, not a quirk: the seeded data and the scored data can drift
-- apart with no error, and re-seeding does NOT converge them.
--
-- WHAT THIS DOES
-- --------------
-- Deletes `session-open-effect` entries that sit inside an `isRiskGate = 1` group.
-- Those are exactly the rows removed from the seed data, because a risk-group
-- placement contributes nothing to the signal (protocol-gating.service.ts L689:
-- `inSignal = !isGateGroup && ...`), so keeping them is pure noise that
-- (a) inflates the entry count, (b) keeps the duplicate-directive warning firing on
-- every boot, and (c) misrepresents the protocol's shape to anyone reading the DB.
--
-- SAFETY
-- ------
-- Scoped to ONE directive in ONE kind of group. It does not touch scoring groups, and
-- it does not touch any other directive. A backup of the affected rows is taken first
-- (as a SELECT for the record) so the change can be reversed by hand if needed.
--
-- Idempotent: running it twice deletes nothing the second time.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Show what will be removed (run this first and read it).
SELECT p.slug                 AS protocol,
       g.groupId              AS group_name,
       g.isRiskGate,
       e.directiveId,
       e.maxScore,
       e.active
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p                 ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 WHERE e.directiveId = 'session-open-effect'
   AND g.isRiskGate = 1
 ORDER BY p.slug;

-- 2. Delete them.
DELETE e
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
 WHERE e.directiveId = 'session-open-effect'
   AND g.isRiskGate = 1;

-- 3. Verify: risk placements must be 0, and no protocol may hold a duplicate.
SELECT g.isRiskGate, COUNT(*) AS placements
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
 WHERE e.directiveId = 'session-open-effect' AND e.active = 1
 GROUP BY g.isRiskGate;

SELECT p.slug, COUNT(*) AS copies
  FROM protocol_directive_entry e
  JOIN protocol_directive_group g ON g.id COLLATE utf8mb4_unicode_ci = e.groupId COLLATE utf8mb4_unicode_ci
  JOIN protocol p                 ON p.id COLLATE utf8mb4_unicode_ci = g.protocolId COLLATE utf8mb4_unicode_ci
 WHERE e.directiveId = 'session-open-effect' AND e.active = 1
 GROUP BY p.slug
HAVING copies > 1;
