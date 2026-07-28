-- ============================================================================
-- Directive Nature Classification
-- ============================================================================
--
-- ⚠️  CRITICAL DEV NOTE — The `type` column stores the directive's CATEGORY
--    (e.g. "Technical Analysis", "Other", "Risk & Structural"), NOT its ID.
--    The IN() lists below use directive IDs (e.g. 'rsi-oversold'), which will
--    NEVER match the `type` column.  This SQL is currently NON-FUNCTIONAL.
--
--    To fix: either (a) switch to `WHERE id IN (...)` which targets the PK,
--    or (b) add a `Directive.type` column that stores the directive's ID
--    (which is what TradePress legacy code expected).
--
--    WORKAROUND (2026-07-28): classifications applied manually via the API
--    and verified with:
--      SELECT id, type, nature FROM Directive WHERE id IN ('gold-...', ...);
--
-- Context: Runs after `POST /api/directives/seed` which sets nature='neutral'.
-- The `AND (nature IS NULL OR nature = 'neutral')` clause handles both fresh
-- seeds (neutral) and legacy installs that predate the nature column (NULL).
--
-- When adding a new directive, add its ID to the appropriate IN() list below,
-- then also run the UPDATE manually against the live DB (see workaround above).
-- ============================================================================

UPDATE Directive SET nature = 'predictive' WHERE type IN ('rsi-oversold','macd-crossover','ema-structure','atr-dip','volume-confirmation','mfi','adx','stochastic','rsi-overbought','momentum-continuation-combo','speed-momentum','multi-timeframe-trend','micro-sr-levels','price-above-sma','ma-crossover','bollinger-bands','cci','bollinger-band-squeeze','obv','volume-rhythm','vwap','volume-surge','rsi-divergence','macd-divergence','obv-divergence','vwap-confluence-simple','vwap-confluence-bands','mtf-confluence-conservative','mtf-confluence-weighted','gap-scanner','doji-pattern','hammer-pattern','engulfing-pattern','three-soldiers-pattern','pin-bar-pattern','price-action','confluence-reversal-combo','support-resistance-levels','overhead-supply-pressure','volatility-envelope','wick-filter','zigzag-swing-detector','fibonacci-levels') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'risk-gate' WHERE type IN ('budget-gate','liquidity-check','rollover-risk','position-size-kelly','position-size-confidence','panic-exhaustion-absorption','dilution-impact') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'exit' WHERE type IN ('momentum-exhaustion','target-achieved','regime-shift-exit','time-stop') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'calendar' WHERE type IN ('monday-effect','friday-drift','turnaround-tuesday','session-open-effect','santa-claus-rally','january-effect','sell-in-may','september-slump','october-relief','opex-gamma','triple-witching','election-cycle','crypto-weekend-effect','gold-session-profile') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'regime' WHERE type IN ('vix-regime','dxy-regime','market-regime') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'symbol-specific' WHERE type IN ('gold-macro-correlation','gold-round-numbers','cad-usd-oil-correlation','btc-halving-cycle','crypto-fear-greed') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'data-gated' WHERE type IN ('news-sentiment-positive','earnings-proximity','earnings-momentum','social-buzz','insider-activity') AND (nature IS NULL OR nature = 'neutral');
SELECT nature, COUNT(*) FROM Directive WHERE nature IS NOT NULL GROUP BY nature;
