-- ============================================================================
-- Directive Nature & Readiness Classification
-- ============================================================================
--
-- FIXED 2026-07-29: Changed `WHERE type IN (...)` to `WHERE id IN (...)`.
-- The `type` column stores categories (e.g. "Technical Analysis"), not IDs.
-- The ID column is the primary key and correctly stores directive IDs.
--
-- Runs after `POST /api/directives/seed` which sets nature='neutral' and
-- readiness='alpha' by default.  The `AND (nature IS NULL OR nature = 'neutral')`
-- clause handles both fresh seeds and legacy installs.
--
-- When adding a new directive:
--   1. Add its ID to the relevant nature IN() list below
--   2. Add its readiness promotion if it's beta or ready
--   3. Run this SQL against the live DB after seeding
-- ============================================================================

-- ── Nature Classification ─────────────────────────────────────────────────

UPDATE Directive SET nature = 'predictive' WHERE id IN ('rsi-oversold','macd-crossover','ema-structure','atr-dip','volume-confirmation','mfi','adx','stochastic','rsi-overbought','momentum-continuation-combo','speed-momentum','multi-timeframe-trend','micro-sr-levels','price-above-sma','ma-crossover','bollinger-bands','cci','bollinger-band-squeeze','obv','volume-rhythm','vwap','volume-surge','rsi-divergence','macd-divergence','obv-divergence','vwap-confluence-simple','vwap-confluence-bands','mtf-confluence-conservative','mtf-confluence-weighted','gap-scanner','doji-pattern','hammer-pattern','engulfing-pattern','three-soldiers-pattern','pin-bar-pattern','price-action','confluence-reversal-combo','support-resistance-levels','overhead-supply-pressure','volatility-envelope','wick-filter','zigzag-swing-detector','fibonacci-levels') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'risk-gate' WHERE id IN ('budget-gate','liquidity-check','rollover-risk','position-size-kelly','position-size-confidence','panic-exhaustion-absorption','dilution-impact') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'exit' WHERE id IN ('momentum-exhaustion','target-achieved','regime-shift-exit','time-stop') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'calendar' WHERE id IN ('monday-effect','friday-drift','turnaround-tuesday','session-open-effect','santa-claus-rally','january-effect','sell-in-may','september-slump','october-relief','opex-gamma','triple-witching','election-cycle','crypto-weekend-effect','gold-session-profile') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'regime' WHERE id IN ('vix-regime','dxy-regime','market-regime') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'symbol-specific' WHERE id IN ('gold-macro-correlation','gold-round-numbers','cad-usd-oil-correlation','btc-halving-cycle','crypto-fear-greed') AND (nature IS NULL OR nature = 'neutral');
UPDATE Directive SET nature = 'data-gated' WHERE id IN ('news-sentiment-positive','earnings-proximity','earnings-momentum','social-buzz','insider-activity') AND (nature IS NULL OR nature = 'neutral');

-- ── Readiness Promotion (default is 'alpha' from seed) ────────────────────

-- BETA: Real math but proxy/degraded data
UPDATE Directive SET readiness = 'beta' WHERE id IN ('dxy-regime','gold-macro-correlation','cad-usd-oil-correlation','news-sentiment-positive','earnings-proximity','analyst-adjustments','dividend-yield-attractive','earnings-implementation','earnings-whispers','like-zacks') AND readiness = 'alpha';

-- READY: Verified real math on real data
-- All directives NOT in the above BETA list and NOT dead stubs are promoted.
-- Dead stubs (the 7 in placeholder-directives.stub.ts with priority:0) stay alpha.
UPDATE Directive SET readiness = 'ready' WHERE readiness = 'alpha' AND id NOT IN ('vix-regime','crypto-weekend-effect','panic-exhaustion-absorption','position-size-kelly');

-- ── Verification ──────────────────────────────────────────────────────────
SELECT nature, COUNT(*) FROM Directive WHERE nature IS NOT NULL GROUP BY nature;
SELECT readiness, COUNT(*) FROM Directive GROUP BY readiness;
