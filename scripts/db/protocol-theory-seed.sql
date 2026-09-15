-- Protocol Theory seed (#689) — first slice, 2026-08-26.
-- Adds the `theory` column if missing, then writes the written-intent text
-- for the first set of protocols. Theory structure per entry:
--   target behaviour · why these groups · what a good day looks like ·
--   suitability · known weaknesses.
-- Safe to re-run (pure UPDATEs; the ALTER is IF NOT EXISTS).
--
-- ⚠️ THE CHARSET FLAG IS MANDATORY. This file is UTF-8 and contains em dashes (—).
--    On Windows the mysql client defaults to the OEM code page (CP850), so the
--    em dash bytes E2 80 94 are read as three characters: D4 C7 F6 — written to the
--    database as that three-character sequence and rendered on the Protocols Registry as
--    mojibake. That is exactly what happened on 2026-08-26 and was repaired on 2026-09-15.
-- Apply with:
--   "C:\wamp64\bin\mysql\mysql9.1.0\bin\mysql.exe" -u tradingcs -p*** tradingcs ^
--       --default-character-set=utf8mb4 < scripts/db/protocol-theory-seed.sql
-- Verify after applying (must return 0 and 13):
--   SELECT COUNT(*) FROM protocol WHERE HEX(theory) LIKE '%C394C387%';
--   SELECT COUNT(*) FROM protocol WHERE HEX(theory) LIKE '%E28094%';

-- Add the column only if absent. MySQL has no `ADD COLUMN IF NOT EXISTS`
-- (that is MariaDB), so this is done with a prepared statement.
SET @have_theory := (SELECT COUNT(*) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'protocol'
                       AND COLUMN_NAME = 'theory');
SET @ddl := IF(@have_theory = 0, 'ALTER TABLE protocol ADD COLUMN theory TEXT NULL', 'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE protocol SET theory = 'Targets gold''s macro-driven trend days — the days real news (dollar, rates, risk appetite) moves gold decisively. The technical group measures trend structure and squeeze; the sentiment group adds macro-regime context; the risk group guards liquidity and session timing, and softens the score when conditions are thin. A good day: gold trending on real macro news with strong liquidity, so most groups fire together — the engine caught exactly this on 13 Aug 2026 (raw composite 772, rarity percentile 100, the highest on record). Known weakness: in quiet ranging gold almost nothing fires and the protocol correctly stays silent. It is an opportunity catcher, not a clockwork signaler — expect clusters of strong signals around macro events, not a daily drip.' WHERE slug = 'gold-macro-v1';

UPDATE protocol SET theory = 'The gold speed family — one directive set scored across four timeframes (M5 scalps, M15 day trades, 1H swings, 4H positions). The strategy intended inside the structure: catch fast directional gold moves with momentum/velocity directives tuned to gold''s volatility profile, with volume confirmation as the honesty check. A good day: a clean directional push with volume behind it — the rarity percentile then marks it as exceptional (the family''s all-time best hit rarity 100). Known ceiling: signal pct tops out around 77% because several directives are mutually exclusive by design (they cannot all fire on the same bar — that is intended, not a bug). The four timeframe siblings differ only in bar data, which is how one strategy is stress-tested across holding periods.' WHERE slug = 'xau-speed-v1';

UPDATE protocol SET theory = 'Session-timed forex for the major pairs. Targets London/NY session trends: technical group for trend structure, sentiment group for cross-pair context, and session timing as the timing layer. This is the most active protocol in the app (hundreds of actionable snapshots per week). A good day: a major pair trending through a session with clean structure and no conflicting sentiment. Known weakness: session-open-effect is zero outside its 30-minute window, so for most of the day that directive''s maxScore sits unpaid in the denominator — typical scores cap near 50% and only reach the high band inside the open window. If this protocol ever feels too quiet outside sessions, that is the timing layer working as designed, not a fault.' WHERE slug = 'forex-session-v1';

UPDATE protocol SET theory = 'Mean-reversion on VIX spikes: panic spikes revert. A deliberately small directive set (8 entries, no always-zero directives), which is why it reaches 95% signal pct — the app''s proof that the pipeline can score near-max when conditions truly align. A good day: VIX gaps up hard on fear and the mean-reversion and squeeze directives fire together. Known weakness: outside genuine spikes it is nearly silent (avg composite ~10) — that silence is the strategy doing its job; it waits for the spike.' WHERE slug = 'vix-spike-v1';

UPDATE protocol SET theory = 'The SHORT_ONLY mirror of vix-spike-v1: shorts VIX strength after spike exhaustion instead of buying the reversion long. Same directive philosophy on the bearish side (short-sentiment, short-technical, short-risk groups). Reaches 95% signal pct on its side of the trade. A good day: the spike is exhausted and the risk group confirms it is safe to fade strength. Pairs with vix-spike-v1 in dual-protocol strategies so one engine covers both directions of the same VIX behaviour.' WHERE slug = 'vix-short-v1';

UPDATE protocol SET theory = 'DIAGNOSED SILENT (#685, 2026-08-26): the strategy intended inside this structure — speed/momentum on a US index — does not match SPY''s actual behaviour. Speed-momentum and support-resistance demand conditions SPY daily bars rarely produce: best recent snapshot scored 46/215 (21%), and the protocol has never once produced an actionable signal in the measurement window. Kept active for monitoring only. Rebuild planned in #688 as an A/B-gated v2 using session-timed index directives (midweek-momentum, intraday-u-pattern, spy-qqq-relative-strength) — do not tune this v1 in place.' WHERE slug = 'spy-speed-v1';

UPDATE protocol SET theory = 'Same diagnosis as spy-speed-v1 (#685): the day-trade variant for SPY never fires because the momentum/volatility directive set is ill-suited to index daily bars (max 21.4% signal pct, zero actionable snapshots). Monitoring-only until the #688 rebuild delivers a session-timed v2 candidate through the A/B gate.' WHERE slug = 'spy-day-v1';

UPDATE protocol SET theory = 'The QQQ speed variant: same structure as spy-speed-v1, slightly better fit because QQQ carries more momentum than SPY — max 48.5% signal pct, but only 7 actionable snapshots in the window. Still far below what a fitted protocol should produce (xau-speed: 77%, vix-spike: 95%). Monitoring-only; v2 rebuild planned in #688.' WHERE slug = 'qqq-speed-v1';

UPDATE protocol SET theory = 'Day-trade variant of qqq-speed-v1. Same #685 diagnosis: momentum directives fire too rarely on QQQ daily bars (max 48.5%, 7 actionable snapshots). Monitoring-only; the #688 rebuild targets the day-trade style with session-timed index directives, gated behind A/B comparison.' WHERE slug = 'qqq-day-v1';
