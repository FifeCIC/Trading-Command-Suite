/**
 * Speed Decision Panel
 * ====================
 * Compact dashboard component for the Speed Trading page.
 * Shows multi-timeframe trend alignment, nearest S/R levels,
 * and directional bias to support split-second trading decisions.
 *
 * Theory: docs/theories/multi-timeframe-speed-trading.md
 *
 * ⚠️ `protocolId` IS REQUIRED, AND THAT IS THE POINT (#867, 2026-11-06). This component used to
 * hardcode `protocolId: 'btc-scalp-v1-long'` with `symbol` defaulting to `'BTCUSD'`, so any caller
 * that mounted it for another symbol silently got BTC's protocol scores under a different heading.
 * A component may not choose a strategy: the caller declares it, and without one the panel says so
 * rather than guessing. Silence here would be the repo's signature defect — plausible output, no error.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '../core/api/client';
import NoticeBlock from './NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import './speed-decision-panel.css';

const POLL_MS = 10_000; // Refresh every 10s

function TrendDot({ direction, label }) {
  const color =
    direction === 'bullish' ? '#10b981' :
    direction === 'bearish' ? '#ef4444' : '#64748b';
  return (
    <span className="sdp-trend-dot" title={`${label}: ${direction}`}>
      <span className="sdp-dot" style={{ background: color }} />
      <span className="sdp-dot-label">{label}</span>
    </span>
  );
}

function LevelRow({ label, price, distance, side }) {
  const distColor = side === 'support' ? '#10b981' : '#ef4444';
  return (
    <div className={`sdp-level-row sdp-level--${side}`}>
      <span className="sdp-level-label">{label}</span>
      <span className="sdp-level-price">{price}</span>
      <span className="sdp-level-dist" style={{ color: distColor }}>
        {distance}
      </span>
    </div>
  );
}

/**
 * @param {string}  symbol      Instrument used for the price/S-R bars fetch.
 * @param {string=} scoreSymbol Instrument the SCORE is fetched for. Defaults to `symbol`, and exists
 *                              because the scored ticker can differ from the charted one — measured
 *                              2026-11-06: `btc-scalp-v1-long` scores `BTC` (13,668 rows, minutes
 *                              old) while `BTCUSD` has 5 rows and none since 2026-09-10.
 * @param {string}  protocolId  REQUIRED. Which protocol's decision this panel shows.
 */
export default function SpeedDecisionPanel({ symbol = 'BTCUSD', scoreSymbol, protocolId, compact = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const tickerForScore = scoreSymbol ?? symbol;

  const fetchData = useCallback(async () => {
    if (!protocolId) { setData(null); setError(null); return; }
    try {
      // ⚠️ POST, and a BODY — three separate faults here until 2026-11-06:
      //   1. `apiGet` on `@Post('batch')`  → 404 on every poll;
      //   2. `params` put the arguments in a QUERY STRING, but the handler reads `@Body()`;
      //   3. `tickers` must be `string[]` — a bare string made the handler return `[]` anyway.
      // So the panel was dead three ways over, and `.catch` upstream hid it. Route declared in
      // `protocol-gating.controller.ts` as `@Post('batch')` body `{ tickers: string[], protocolId? }`.
      const result = await apiPost('/api/scoring/gated/batch', {
        tickers: [tickerForScore],
        protocolId,
      });
      // Also fetch recent bars for the panel's own S/R display
      const barsRes = await apiGet(`/api/trading/mt5/candles`, {
        params: { symbol, timeframe: '15m', limit: 20 },
      }).catch(() => null);

      setData({
        // ⚠️ The handler returns `GatedScore[]` — an ARRAY, not `{ results: [] }`. Reading
        // `result?.results?.[0]` produced `undefined` even once the verb was right.
        score: Array.isArray(result) ? (result[0] ?? null) : null,
        bars: barsRes?.bars ?? [],
      });
      setError(null);
    } catch (err) {
      setError(noticeFromError(err));
    }
  }, [symbol, tickerForScore, protocolId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

    // A MISSING PROTOCOL IS NOT AN ERROR AND NOT AN EMPTY RESULT — it is "cannot judge". Saying so
    // keeps the three states distinct: no protocol (this block), a failed fetch (next block), and a
    // protocol that legitimately scored nothing (the normal render with `composite === null`).
    if (!protocolId) {
      return (
        <div className="sdp-panel sdp-panel--error">
          <span className="sdp-error-icon">⚠</span>
          <span>
            No protocol supplied — this panel shows one protocol&apos;s decision, so it will not guess.
          </span>
        </div>
      );
    }

    if (error) {
    return (
      <div className="sdp-panel sdp-panel--error">
        <span className="sdp-error-icon">⚠</span>
        {/* The old form was three words and no identity: "Decision data unavailable" told the user
            nothing to act on and gave support nothing to grep (cf. #824). */}
        <NoticeBlock notice={error} compact />
      </div>
    );
  }

  // ── Compute nearest S/R from bars ────────────────────
  const bars = data?.bars ?? [];
  const currentPrice = bars.length > 0 ? bars[bars.length - 1].close : null;

  // Simple S/R from bar extremes
  let nearestSupport = null;
  let nearestResistance = null;
  if (currentPrice && bars.length >= 5) {
    const recentHighs = bars.slice(-10).map(b => b.high);
    const recentLows = bars.slice(-10).map(b => b.low);

    // Find levels below current price (support)
    const supports = recentLows
      .filter(l => l < currentPrice)
      .sort((a, b) => b - a);
    if (supports.length > 0) {
      nearestSupport = supports[0];
    }

    // Find levels above current price (resistance)
    const resistances = recentHighs
      .filter(h => h > currentPrice)
      .sort((a, b) => a - b);
    if (resistances.length > 0) {
      nearestResistance = resistances[0];
    }
  }

  // ── Score data ───────────────────────────────────────
  const score = data?.score;
  const signal = score?.signal ?? 'neutral';
  const composite = score?.composite ?? null;

  // ── Trend dots (extracted from scoring results) ──────
  // The multi-timeframe-trend directive's reason reads "… 1D: bearish (weak) | 1H: bearish (strong)
  // | 15M: bullish (strong)".
  // ⚠️ This used to read `score.directiveReasons['multi-timeframe-trend']` — a field that DOES NOT
  // EXIST on `GatedScore`. So all three dots were permanently `neutral`, which reads as "the market
  // is neutral" when the truth was "not measured" — the collapse of "fine" and "cannot judge" that
  // this repo treats as a defect. Measured 2026-11-06: the reason lives in
  // `breakouts.technical[]`, on the entry whose `directiveId` is `multi-timeframe-trend`.
  const trendEntry = (score?.breakouts?.technical ?? [])
    .find((b) => b.directiveId === 'multi-timeframe-trend');
  const trendReason = trendEntry?.reason ?? '';
  const dayTrend = trendReason.match(/1D:\s*(\w+)/)?.[1] ?? 'neutral';
  const hourTrend = trendReason.match(/1H:\s*(\w+)/)?.[1] ?? 'neutral';
  const min15Trend = trendReason.match(/15M:\s*(\w+)/)?.[1] ?? 'neutral';

  // ── Bias indicator ───────────────────────────────────
  const biasIcon =
    signal === 'BUY' ? '🟢' :
    signal === 'SELL' ? '🔴' : '⚪';
  const biasLabel =
    signal === 'BUY' ? 'Long Bias' :
    signal === 'SELL' ? 'Short Bias' : 'Neutral';

  return (
    <div className={`sdp-panel ${compact ? 'sdp-panel--compact' : ''}`}>
      {/* ── Header: Symbol + Price ────────────────────── */}
      <div className="sdp-header">
        {/* ⚠️ The SCORED ticker, not the charted one. Showing `BTCUSD` above a score computed for
            `BTC` is a label that disagrees with its number — the defect class this repo keeps
            re-finding. Measured 2026-11-06: this panel scores `btc-scalp-v1-long`, which is scored
            on `BTC`; `BTCUSD` has no scoring rows since 2026-09-10. The charted ticker is kept in
            the tooltip so the difference is discoverable rather than hidden. */}
        <span className="sdp-symbol" title={tickerForScore !== symbol ? `Score for ${tickerForScore}; chart for ${symbol}` : undefined}>{tickerForScore}</span>
        {currentPrice && (
          <span className="sdp-price">{currentPrice.toFixed(symbol === 'BTCUSD' ? 1 : 5)}</span>
        )}
        {composite != null && (
          <span className={`sdp-composite sdp-composite--${signal.toLowerCase()}`}>
            {composite.toFixed(0)}
          </span>
        )}
      </div>

      {/* ── Trend Alignment ────────────────────────────── */}
      <div className="sdp-section">
        <span className="sdp-section-label">Trend</span>
        <div className="sdp-trend-dots">
          <TrendDot direction={dayTrend} label="1D" />
          <TrendDot direction={hourTrend} label="1H" />
          <TrendDot direction={min15Trend} label="15M" />
        </div>
      </div>

      {/* ── Nearest S/R ────────────────────────────────── */}
      {currentPrice && (
        <div className="sdp-section">
          <span className="sdp-section-label">Levels</span>
          <div className="sdp-levels">
            {nearestResistance && (
              <LevelRow
                label="R"
                price={nearestResistance.toFixed(symbol === 'BTCUSD' ? 1 : 5)}
                distance={`+${((nearestResistance - currentPrice) / currentPrice * 100).toFixed(2)}%`}
                side="resistance"
              />
            )}
            {nearestSupport && (
              <LevelRow
                label="S"
                price={nearestSupport.toFixed(symbol === 'BTCUSD' ? 1 : 5)}
                distance={`${((nearestSupport - currentPrice) / currentPrice * 100).toFixed(2)}%`}
                side="support"
              />
            )}
          </div>
        </div>
      )}

      {/* ── Directional Bias ───────────────────────────── */}
      <div className="sdp-section sdp-bias">
        <span className="sdp-bias-icon">{biasIcon}</span>
        <span className={`sdp-bias-label sdp-bias--${signal.toLowerCase()}`}>
          {biasLabel}
        </span>
      </div>

      {/* ── Compact: hide detail when collapsed ───────── */}
      {!compact && (
        <div className="sdp-detail">
          {score?.rarity && (
            <span className="sdp-rarity" title={`Rarity percentile: ${score.rarity.percentile?.toFixed(1)}%`}>
              {score.rarity.emoji} {score.rarity.label}
            </span>
          )}
          {score?.riskMultiplier != null && (
            <span className="sdp-risk">
              Risk: {score.riskMultiplier.toFixed(2)}x
            </span>
          )}
        </div>
      )}
    </div>
  );
}
