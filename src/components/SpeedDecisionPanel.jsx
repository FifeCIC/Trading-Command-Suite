/**
 * Speed Decision Panel
 * ====================
 * Compact dashboard component for the Speed Trading page.
 * Shows multi-timeframe trend alignment, nearest S/R levels,
 * and directional bias to support split-second trading decisions.
 *
 * Theory: docs/theories/multi-timeframe-speed-trading.md
 */

import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../core/api/client';
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

export default function SpeedDecisionPanel({ symbol = 'BTCUSD', compact = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      // Fetch gated batch score which now includes multi-timeframe + micro-S/R directives
      const result = await apiGet('/api/scoring/gated/batch', {
        params: { tickers: symbol, protocolId: 'btc-scalp-v1' },
      });
      // Also fetch recent bars for the panel's own S/R display
      const barsRes = await apiGet(`/api/trading/mt5/candles`, {
        params: { symbol, timeframe: '15m', limit: 20 },
      }).catch(() => null);

      setData({
        score: result?.results?.[0] ?? null,
        bars: barsRes?.bars ?? [],
      });
      setError(null);
    } catch (err) {
      setError(noticeFromError(err));
    }
  }, [symbol]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

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
  // The multi-timeframe-trend directive reason string contains "1D: bullish | 1H: bearish | 15M: neutral"
  const trendReason = score?.directiveReasons?.['multi-timeframe-trend'] ?? '';
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
        <span className="sdp-symbol">{symbol}</span>
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
