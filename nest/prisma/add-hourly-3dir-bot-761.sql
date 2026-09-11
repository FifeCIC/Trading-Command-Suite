-- ─────────────────────────────────────────────────────────────────────────────
-- hourly-3dir-v1 — trading bot for the #761 control protocol.
--
-- WHY THIS IS A BOT AND NOT A SCRIPT:
--   The user's requirement is that the experiment must work through the SAME
--   META.Stack path every other protocol uses — watchlist → protocol → directive
--   groups → entries → scoring strategy → trading strategy → execution — and be
--   entirely database-resident. A bespoke script would prove nothing about the
--   real pipeline. So this is a normal trading_strategy row, indistinguishable in
--   structure from "Gold Swing 1H".
--
-- FIELD CHOICES, and why (mirrored from the live 1h bots so nothing is exotic):
--   timeframe      '1h'   — must match protocol.recommendedTimeframe, otherwise
--                           INV-SINGLE-CADENCE is violated (one array, one cadence)
--   minComposite    55    — the same gate the live 1h forex/gold bots use
--   requireDirection NONE  — the experiment measures whether direction APPEARS; a
--                           direction requirement would confound the measurement
--   slPct/tpPct  1.5/3.0  — the live 1h convention (Gold Swing 1H, Tokyo USDJPY)
--   maxHoldHours    12    — matches the declared avgHoldTime "2–12 hours" and is
--                           enforced by PositionTimeStopService (#773)
--   sessionWindow  NULL   — deliberately open. A session window is a SECOND gate,
--                           and #759 showed a session gate can silently block every
--                           signal while all surfaces look idle. Not a variable here.
--   mode         'manual' — the bot must NOT trade. It exists to SCORE, so the
--                           ordering layer can be inspected without live capital.
--   active            0   — do not start trading from this seed. Arming is explicit.
--
-- ⚠️ schema.prisma is NOT the only truth here: trading_strategy is a modelled table,
--    but the repo has 10 raw-managed tables. This file only INSERTs a row into a
--    modelled table — it does NOT alter schema, so no db push is involved and no
--    `db:check` violation is possible. Idempotent via INSERT ... ON DUPLICATE KEY.
-- ─────────────────────────────────────────────────────────────────────────────

SET @proto := (SELECT id FROM protocol WHERE slug = 'hourly-3dir-v1');

-- Fail loudly rather than insert an orphan bot pointing at a NULL protocol.
-- (A bot with protocolId NULL silently scores nothing — the "empty result that
-- looks like nothing to do" failure mode from #773.)
SELECT IF(@proto IS NULL,
          'ABORT: protocol hourly-3dir-v1 not found — run seedProtocolsToDatabase() first',
          CONCAT('OK: protocol id = ', @proto)) AS preflight;

INSERT INTO trading_strategy
  (id, name, description, protocolId, symbol, timeframe,
   minComposite, minRarityBand, requireDirection,
   slPct, tpPct, baseSize, useRaritySizing, maxSize,
   maxPositions, maxDailyLoss, cooldownMinutes, sessionWindow,
   mode, active, brokerId, maxHoldHours, version,
   hotStockEnabled, createdAt, updatedAt)
VALUES
  (UUID(),
   'Hourly Triple-Directive Control',
   'Experiment bot for issue #761. Scores the hourly-3dir-v1 protocol (three directional-only directives) on EURUSD 1h bars so the scoring-percentage ceiling can be measured without the idle-capacity denominator that every existing protocol carries. mode=manual and active=0 by design: this is a measurement instrument, not a trading strategy. Arm deliberately if/when a scored reading justifies it.',
   @proto,
   'EURUSD',
   '1h',
   55, NULL, NULL,
   1.5, 3.0, 0.01, 0, NULL,
   1, NULL, 5, NULL,
   'manual', 0, 'mt5', 12, '1.0.0',
   0, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
   description    = VALUES(description),
   minComposite   = VALUES(minComposite),
   maxHoldHours   = VALUES(maxHoldHours),
   updatedAt      = NOW(3);

-- Verify what we just wrote — never assume an INSERT landed.
SELECT t.name, t.symbol, p.slug AS protocol, t.timeframe, t.minComposite,
       t.mode, t.active, t.brokerId, t.maxHoldHours,
       (SELECT COUNT(*) FROM watchlist w WHERE w.protocolId COLLATE utf8mb4_unicode_ci = p.id COLLATE utf8mb4_unicode_ci) AS linked_watchlists,
       (SELECT COUNT(*) FROM symbol_protocol_assignment a WHERE a.protocolId COLLATE utf8mb4_unicode_ci = p.id COLLATE utf8mb4_unicode_ci) AS fk_assignments
  FROM trading_strategy t
  JOIN protocol p ON p.id COLLATE utf8mb4_unicode_ci = t.protocolId COLLATE utf8mb4_unicode_ci
 WHERE p.slug = 'hourly-3dir-v1';
