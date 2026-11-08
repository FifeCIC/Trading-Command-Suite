-- #773 — set the position time-stop limits.
--
-- WHY THESE VALUES, AND WHY I AM NOT PICKING THEM FOR YOU BLINDLY
-- ---------------------------------------------------------------
-- Each limit is derived from what the strategy's OWN NAME AND PROTOCOL declare, not from
-- a number I chose. The names are the intent; a max hold that contradicts the name is the
-- bug being fixed.
--
--   strategy                protocol          name implies   limit set
--   ----------------------  ----------------  -------------  ---------
--   Gold Scalp M5           xau-speed-m5      minutes        4h
--   Gold Day-Trade M15      xau-speed-m15     a day          24h
--   Gold Swing 1H           xau-speed-1h      days           72h
--   Gold Position 4H        xau-speed-4h      days           120h
--   Sydney AUDUSD Session   forex-session-v1  a session     12h
--   Tokyo USDJPY Session    forex-session-v1  a session     12h
--   GBPUSD Session          forex-session-v1  a session     12h
--   USDCAD Forex Session    forex-session-v1  a session     12h
--
-- The SESSION limits are deliberately loose (12h) rather than tied to actual session hours.
-- A session is up to ~8h; 12h allows the position to survive a late entry plus a rollover
-- without being killed mid-thesis. Tightening to true session-close is a separate decision
-- that needs the session-window data, and #773 does not ask for it.
--
-- ⚠️ THIS DOES NOT RAISE THE POSITION CAP. It only guarantees slots become available again.
-- Risk does not increase; the time-stop REDUCES exposure by bounding how long capital can
-- sit in a position that is not working.
--
-- Idempotent: only sets a limit where none is present, so re-running cannot overwrite a
-- value someone has since tuned deliberately.

UPDATE trading_strategy SET maxHoldHours = 4
 WHERE maxHoldHours IS NULL AND protocolId = 'xau-speed-m5';

UPDATE trading_strategy SET maxHoldHours = 24
 WHERE maxHoldHours IS NULL AND protocolId = 'xau-speed-m15';

UPDATE trading_strategy SET maxHoldHours = 72
 WHERE maxHoldHours IS NULL AND protocolId = 'xau-speed-1h';

UPDATE trading_strategy SET maxHoldHours = 120
 WHERE maxHoldHours IS NULL AND protocolId = 'xau-speed-4h';

UPDATE trading_strategy SET maxHoldHours = 12
 WHERE maxHoldHours IS NULL AND protocolId = 'forex-session-v1';

SELECT id, name, symbol, protocolId, mode, active, maxHoldHours
  FROM trading_strategy
 WHERE maxHoldHours IS NOT NULL
 ORDER BY maxHoldHours, symbol;

SELECT COUNT(*) AS with_limit, SUM(active = 1 AND mode = 'auto') AS active_auto_total,
       SUM(active = 1 AND mode = 'auto' AND maxHoldHours IS NOT NULL) AS active_auto_limited
  FROM trading_strategy;
