-- upside-exhaustion-995.sql — the UP-move exhaustion OBSERVER (#995)
-- ==============================================================================
-- ⚠️ APPLIED BY HAND, NEVER BY `prisma db push`. This repo has 13 tables managed outside
-- Prisma (including the trade execution queue), no migration history, and `db push` silently
-- DROPs every unmodelled table. Run `npm --prefix nest run db:check` BEFORE and AFTER.
--
-- WHAT THE GAP IS (#995). The guardian's four directives — atr-trailing-stop, supertrend,
-- chandelier-exit, wick-filter — are ALL trail-followers: they tighten the stop BEHIND price,
-- so their input is where price HAS BEEN. Nothing in the set notices that a move is LOSING
-- MOMENTUM. The two exhaustion directives that already exist cannot cover it either, and the
-- reason is direction, not availability:
--
--   momentum-exhaustion          directionBias = 'bullish'   <- "the DOWN-move is exhausting"
--   panic-exhaustion-absorption  directionBias = 'bullish'   <- "buy the panic dip"
--
-- Both are counter-trend ENTRY signals. This is the mirror: "the UP-move is tiring", which is
-- a statement about a position that is ALREADY OPEN and ALREADY in profit.
--
-- ⚠️ NEITHER EXISTING DIRECTIVE FITS THE GUARDIAN'S WINDOW ANYWAY — MEASURED, NOT ASSUMED.
-- The guardian evaluates `timeframe=5m&limit=30` (2.5 hours of history, stop-guardian.service.ts
-- L624). `momentum-exhaustion` declares `minBars {1d: 19}` and suitability `minTimeframe M15`;
-- `panic-exhaustion-absorption` is suited to `['stocks','crypto']` (minTimeframe M5/M15). So the
-- metric is computed by the guardian itself from the bars it already loads — the same reason
-- `observeSimulatedTsl()` (#936) does not add a directive either.
--
-- WHY ONE FLAG AND ONE NUMBER:
--   exhaustionObserveEnabled — default 0. ⚠️ DEFAULT-OFF IS THE CONTRACT, not a convenience: no
--                              existing bot changes behaviour, so nothing here needs an A/B copy.
--   exhaustionDecelPct       — how far recent progress must fall BELOW prior progress to count.
--                              NULL means "not configured", which the observer treats as not
--                              armed. There is deliberately no default: a guessed threshold would
--                              record firings against a fiction and produce evidence for a number
--                              nobody chose.
--
-- ⚠️ THE OBSERVER ACTS ON NOTHING. `action` is hardcoded 'recorded'. Escalating this to a real
-- exit means adding an id to STOP_GUARDIAN_DIRECTIVES, which changes how much a tradeable
-- position moves its stop — that is MATHS (maths-change-requires-ab) and needs a COPIED
-- configuration, which #929's precondition still blocks from reporting.
--
-- The event table exists because the theory (`upside-exhaustion-predicts-giveback`, status
-- `testing`) is FALSIFIABLE ONLY IF the firings are recorded: comparing peak giveback on flagged
-- versus unflagged closed positions needs the flagged set to be identifiable after the fact.

ALTER TABLE trading_strategy
  ADD COLUMN exhaustionObserveEnabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN exhaustionDecelPct DOUBLE NULL;

CREATE TABLE IF NOT EXISTS exhaustion_event (
  id                 VARCHAR(36)  NOT NULL,
  tradeTicket        VARCHAR(100) NOT NULL,
  strategyId         VARCHAR(36)  NULL,
  strategyName       VARCHAR(200) NULL,
  symbol             VARCHAR(20)  NOT NULL,
  -- the direction of the OPEN POSITION being watched. A 'sell' position's exhaustion is a
  -- FALLING move decelerating, which is the same code path mirrored.
  side               VARCHAR(10)  NOT NULL,
  -- The evidence, as numbers rather than a verdict. ⚠️ 'observed' is the ONLY event value the
  -- current engine writes; there is no 'acted' because nothing acts.
  event              VARCHAR(30)  NOT NULL DEFAULT 'observed',
  entryPrice         DOUBLE       NULL,
  price              DOUBLE       NULL,
  -- highest (lowest for a sell) close in the evaluated window — what the move achieved
  peakPrice          DOUBLE       NULL,
  profitPct          DOUBLE       NULL,
  -- net progress over the last k bars, and over the k bars immediately before those, as % of
  -- price. The comparison between them IS the signal, so both are stored raw.
  recentProgressPct  DOUBLE       NULL,
  priorProgressPct   DOUBLE       NULL,
  -- (prior - recent) / prior * 100 — how much the move decelerated, which is what
  -- `exhaustionDecelPct` is compared against. Stored so the comparison can be re-run at a
  -- DIFFERENT threshold later without re-observing anything.
  decelPct           DOUBLE       NULL,
  thresholdPct       DOUBLE       NULL,
  barsUsed           INT          NULL,
  -- ⚠️ 'recorded' is the ONLY value the current engine writes. Nothing reaches the broker from
  -- this table's code path.
  action             VARCHAR(30)  NOT NULL DEFAULT 'recorded',
  detail             JSON         NULL,
  -- ⚠️ `DEFAULT (UTC_TIMESTAMP(3))`, NOT `CURRENT_TIMESTAMP(3)`. MySQL evaluates
  -- NOW()/CURRENT_TIMESTAMP in the SESSION timezone (SYSTEM = UTC+1 on this machine), so the
  -- latter writes every row an HOUR IN THE FUTURE relative to the UTC the app stores — with no
  -- error. `validate-local-time-sources.cjs` fails the build on it (#844).
  occurredAt         DATETIME(3)  NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  INDEX exhaustion_event_ticket_occurredAt_idx (tradeTicket, occurredAt),
  INDEX exhaustion_event_symbol_occurredAt_idx (symbol, occurredAt),
  INDEX exhaustion_event_strategyId_occurredAt_idx (strategyId, occurredAt),
  -- Retention column must LEAD an index (validate-retention-columns.cjs).
  INDEX exhaustion_event_occurredAt_idx (occurredAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
