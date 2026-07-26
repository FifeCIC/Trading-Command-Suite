/**
 * SeasonalityHeatmap — 7×24 grid showing historical bullish/bearish bias
 * by hour and day of week for the active symbol.
 */
import { useEffect, useState, useRef } from 'react';
import './seasonality-heatmap.css';

const API = 'http://localhost:3201';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function getCellColor(bullishPct, samples) {
  if (samples < 30) return 'var(--cell-low-conf, #1e293b)';
  if (bullishPct >= 0.65) return `rgba(34,197,94,${0.2 + (bullishPct - 0.5) * 1.2})`;
  if (bullishPct >= 0.55) return `rgba(34,197,94,0.12)`;
  if (bullishPct <= 0.35) return `rgba(239,68,68,${0.2 + (0.5 - bullishPct) * 1.2})`;
  if (bullishPct <= 0.45) return `rgba(239,68,68,0.12)`;
  return '#1e293b'; // neutral 45-55%
}

function getLabel(pct) {
  if (pct >= 0.65) return `${Math.round(pct * 100)}% ↑`;
  if (pct <= 0.35) return `${Math.round(pct * 100)}% ↓`;
  return `${Math.round(pct * 100)}%`;
}

export default function SeasonalityHeatmap({ symbol }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [selectedCell, setSelectedCell] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/speed/seasonality/${encodeURIComponent(symbol)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (!cancelled) { setData(d); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setLoading(false);
    };
    fetchData();
    timer.current = setInterval(fetchData, 60000);
    return () => { cancelled = true; clearInterval(timer.current); };
  }, [symbol]);

  const now = new Date();
  const currentDay = now.getUTCDay();
  const currentHour = now.getUTCHours();

  return (
    <div className={`sh-panel ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="sh-header" onClick={() => setExpanded(e => !e)}>
        <span className="sh-title">
          📊 Seasonality {data && <span className="sh-badge">{data.totalBars} bars</span>}
        </span>
        <span className="sh-toggle">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="sh-body">
          {error && <div className="sh-error">No data: {error}</div>}
          {loading && !data && <div className="sh-loading">Computing…</div>}
          {data && (
            <>
              <div className="sh-grid">
                <div className="sh-corner" />
                {HOURS.map(h => (
                  <div key={h} className="sh-col-label">{h.toString().padStart(2, '0')}</div>
                ))}
                {DAYS.map((day, d) => (
                  <div key={day} className="sh-row">
                    <div className="sh-row-label">{day}</div>
                    {HOURS.map(h => {
                      const pct = data.heatmap[d][h] || 0;
                      const samples = data.samples[d][h] || 0;
                      const isCurrent = d === currentDay && h === currentHour;
                      const isSelected = selectedCell?.day === d && selectedCell?.hour === h;
                      return (
                        <div
                          key={h}
                          className={`sh-cell ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''} ${samples < 30 ? 'low-conf' : ''}`}
                          style={{ background: getCellColor(pct, samples) }}
                          onMouseEnter={() => setSelectedCell({ day: d, hour: h })}
                          onMouseLeave={() => setSelectedCell(null)}
                          title={`${DAYS[d]} ${h.toString().padStart(2, '0')}:00 — ${getLabel(pct)} (${samples} samples)`}
                        >
                          {isCurrent && <div className="sh-now" />}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="sh-legend">
                <span className="sh-legend-item"><span className="sh-legend-swatch" style={{ background: '#ef4444' }} />Bearish</span>
                <span className="sh-legend-item"><span className="sh-legend-swatch" style={{ background: '#334155' }} />Neutral</span>
                <span className="sh-legend-item"><span className="sh-legend-swatch" style={{ background: '#22c55e' }} />Bullish</span>
                <span className="sh-legend-item"><span className="sh-legend-swatch sh-dots" />Low data</span>
                {selectedCell && (
                  <span className="sh-legend-info">
                    {DAYS[selectedCell.day]} {selectedCell.hour.toString().padStart(2, '0')}:00
                    — {getLabel(data.heatmap[selectedCell.day][selectedCell.hour])}
                    ({data.samples[selectedCell.day][selectedCell.hour]} samples)
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
