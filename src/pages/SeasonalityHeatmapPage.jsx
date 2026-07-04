/**
 * SeasonalityHeatmapPage — 7×24 Hour × Day Win Rate Heatmap
 * =========================================================
 * Visualises historical bullish/bearish bias per hour per day.
 * Green = 70%+ bullish, Red = 70%+ bearish.
 * Route: /analysis/seasonality-heatmap
 */
import { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './seasonality-heatmap.css';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Map bullish % to color */
function heatColor(pct) {
  if (pct === 0) return 'transparent';
  if (pct >= 0.70) return `rgb(0, ${Math.round(180 + (pct - 0.7) * 250)}, 0)`;   // deep green
  if (pct >= 0.55) return `rgb(${Math.round((0.7-pct)*500)}, 160, 0)`;              // green
  if (pct >= 0.45) return `rgb(180, 160, 0)`;                                       // yellow/neutral
  if (pct >= 0.30) return `rgb(200, ${Math.round((pct-0.3)*500)}, 0)`;              // amber
  return `rgb(220, ${Math.round(pct * 150)}, ${Math.round(pct * 100)})`;            // red
}

/** Format hour for display */
function hourLabel(h) {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

function Tooltip({ day, hour, pct, samples }) {
  return (
    <div className="sh-tooltip">
      <strong>{DAY_LABELS[day]} {hourLabel(hour)}:00</strong>
      <span style={{ color: pct >= 0.55 ? '#22c55e' : pct <= 0.45 ? '#ef4444' : '#f59e0b' }}>
        {(pct * 100).toFixed(0)}% bullish
      </span>
      <span className="sh-tooltip-samples">{samples} samples</span>
    </div>
  );
}

export default function SeasonalityHeatmapPage() {
  const [symbol, setSymbol] = useState('EURUSD');
  const [inputVal, setInputVal] = useState('EURUSD');
  const [tooltip, setTooltip] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['seasonality', symbol],
    queryFn: () => apiGet(`/api/speed/seasonality/${symbol}`),
    enabled: !!symbol,
    refetchOnWindowFocus: false,
  });

  const heatmap = data?.heatmap || [];
  const samples = data?.samples || [];
  const totalBars = data?.totalBars || 0;

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    const clean = inputVal.trim().toUpperCase();
    if (clean && clean !== symbol) setSymbol(clean);
  }, [inputVal, symbol]);

  // Compute summary stats
  let bestCell = { day: 0, hour: 0, pct: 0 };
  let worstCell = { day: 0, hour: 0, pct: 1 };
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const pct = heatmap[d]?.[h] || 0;
      if (pct > bestCell.pct && (samples[d]?.[h] || 0) > 0) bestCell = { day: d, hour: h, pct };
      if (pct < worstCell.pct && (samples[d]?.[h] || 0) > 0) worstCell = { day: d, hour: h, pct };
    }
  }

  return (
    <div className="sh-page">
      <header className="sh-header">
        <div>
          <h1>Seasonality Heatmap</h1>
          <p className="sh-subtitle">Hour × Day win rate — historical bullish/bearish bias from MT5 data</p>
        </div>
      </header>

      {/* Symbol input */}
      <form className="sh-form" onSubmit={handleSubmit}>
        <input
          className="sh-input"
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder="Symbol (e.g. EURUSD, AAPL)"
          maxLength={10}
        />
        <button className="sh-btn" type="submit" disabled={isLoading}>Analyse</button>
        <button className="sh-btn sh-btn-secondary" type="button" onClick={() => refetch()} disabled={isLoading}>
          ↻
        </button>
      </form>

      {isError && <ApiOfflineBanner />}

      {isLoading ? (
        <LoadingSkeleton variant="chart" count={7} />
      ) : (
        <>
          {/* Summary stats */}
          {totalBars > 0 && (
            <div className="sh-summary">
              <span>{totalBars} bars analysed</span>
              <span className="sh-best">🟢 Best: {DAY_LABELS[bestCell.day]} {hourLabel(bestCell.hour)}:00 ({(bestCell.pct * 100).toFixed(0)}% bullish)</span>
              <span className="sh-worst">🔴 Worst: {DAY_LABELS[worstCell.day]} {hourLabel(worstCell.hour)}:00 ({(worstCell.pct * 100).toFixed(0)}% bullish)</span>
            </div>
          )}

          {/* Heatmap grid */}
          {heatmap.length > 0 ? (
            <motion.div className="sh-heatmap-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {/* Column headers (hours) */}
              <div className="sh-col-headers">
                <div className="sh-row-label" />
                {HOURS.map((h) => (
                  <div key={h} className="sh-col-header">{hourLabel(h)}</div>
                ))}
              </div>

              {/* Rows (days) */}
              {DAYS.map((day, d) => (
                <div key={day} className="sh-row">
                  <div className="sh-row-label">{day}</div>
                  {HOURS.map((h) => {
                    const pct = heatmap[d]?.[h] || 0;
                    const cnt = samples[d]?.[h] || 0;
                    const hasData = cnt > 0;
                    return (
                      <div
                        key={h}
                        className={`sh-cell ${hasData ? 'sh-cell-data' : 'sh-cell-empty'}`}
                        style={{ backgroundColor: heatColor(pct), opacity: hasData ? Math.min(1, 0.3 + cnt / 50) : 1 }}
                        onMouseEnter={() => hasData && setTooltip({ day: d, hour: h, pct, samples: cnt })}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {hasData && <span className="sh-cell-val">{(pct * 100).toFixed(0)}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Tooltip */}
              {tooltip && (
                <div className="sh-tooltip-anchor" style={{ /* positioned via JS would be better, but simple static works */ }}>
                  <Tooltip {...tooltip} />
                </div>
              )}
            </motion.div>
          ) : (
            <div className="sh-empty">
              <p>Enter a symbol and click Analyse to compute the seasonality heatmap.</p>
              <p className="sh-empty-hint">Requires MT5 data. Try EURUSD, GBPUSD, or XAUUSD.</p>
            </div>
          )}

          {/* Legend */}
          <div className="sh-legend">
            <span className="sh-legend-label">Bearish</span>
            {[0.15, 0.30, 0.45, 0.55, 0.70, 0.85].map((pct) => (
              <div key={pct} className="sh-legend-swatch" style={{ backgroundColor: heatColor(pct) }} title={`${(pct*100).toFixed(0)}%`} />
            ))}
            <span className="sh-legend-label">Bullish</span>
          </div>
        </>
      )}
    </div>
  );
}
