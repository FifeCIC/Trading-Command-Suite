import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import './PredictiveSeesPage.css';

const HORIZONS = [
  { value: 1, label: '+1 Day' },
  { value: 3, label: '+3 Days' },
  { value: 7, label: '+7 Days' },
  { value: 30, label: '+30 Days' },
];

const DEFAULT_SYMBOLS = 'BTCUSD,NVDA,AAPL,MSFT,TSLA,EURUSD,SPY';

function ConfidenceBadge({ confidence }) {
  const map = {
    high: { label: 'HIGH', className: 'ps-conf-high' },
    medium: { label: 'MED', className: 'ps-conf-med' },
    low: { label: 'LOW', className: 'ps-conf-low' },
  };
  const m = map[confidence] || map.low;
  return <span className={`ps-conf-badge ${m.className}`}>{m.label}</span>;
}

export default function PredictiveSeesPage() {
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [horizon, setHorizon] = useState(7);
  const [expanded, setExpanded] = useState(null);

  const query = useQuery({
    queryKey: ['predictive-sees', symbols, horizon],
    queryFn: async () => {
      const res = await fetch(`/api/scoring/predictive?symbols=${encodeURIComponent(symbols)}&horizon=${horizon}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60000,
  });

  const predictions = query.data?.predictions || [];

  const selectedHorizonData = useMemo(() => {
    return predictions.map((p) => {
      const pred = p.predictions.find((pr) => pr.daysAhead <= horizon);
      return { ...p, activePrediction: pred || p.predictions[p.predictions.length - 1] };
    });
  }, [predictions, horizon]);

  return (
    <div className="ps-page">
      <header className="ps-header">
        <h2>Predictive SEES</h2>
        <p>Time-shifted scoring — preview how scores may change based on upcoming scheduled events.</p>
      </header>

      {/* Disclaimer */}
      <div className="ps-disclaimer">
        ⚠️ <strong>PROTOTYPE</strong> — Predictive scores are experimental. Historical patterns may not repeat.
        Only scheduled events (earnings, economic calendar) are considered. Random events (geopolitical, tweets) are not predicted.
      </div>

      {/* Controls */}
      <div className="ps-controls">
        <div className="ps-control-group">
          <label htmlFor="ps-symbols">Symbols</label>
          <input
            id="ps-symbols"
            value={symbols}
            onChange={(e) => setSymbols(e.target.value.toUpperCase())}
            placeholder="AAPL,NVDA,TSLA..."
          />
        </div>
        <div className="ps-control-group">
          <label>Horizon</label>
          <div className="ps-horizon-btns">
            {HORIZONS.map((h) => (
              <button
                key={h.value}
                className={`ps-horizon-btn ${horizon === h.value ? 'active' : ''}`}
                onClick={() => setHorizon(h.value)}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      {query.isLoading && <p className="ps-loading">Loading predictions...</p>}
      {query.isError && <p className="ps-error">Failed to load predictions. Ensure the API is running.</p>}

      {selectedHorizonData.length > 0 && (
        <div className="ps-table-wrap">
          <table className="ps-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Score Now</th>
                <th>Score ({horizon === 1 ? '+1d' : `+${horizon}d`})</th>
                <th>Δ</th>
                <th>Confidence</th>
                <th>Catalysts</th>
              </tr>
            </thead>
            <tbody>
              {selectedHorizonData.map((row) => {
                const pred = row.activePrediction;
                const isExpanded = expanded === row.symbol;
                return (
                  <>
                    <tr
                      key={row.symbol}
                      className={`ps-row ${isExpanded ? 'expanded' : ''}`}
                      onClick={() => setExpanded(isExpanded ? null : row.symbol)}
                    >
                      <td className="ps-symbol">{row.symbol}</td>
                      <td className="ps-score">{row.scoreNow}</td>
                      <td className="ps-score">{pred?.predictedScore ?? '—'}</td>
                      <td className={`ps-delta ${(pred?.delta ?? 0) >= 0 ? 'positive' : 'negative'}`}>
                        {(pred?.delta ?? 0) > 0 ? '+' : ''}{pred?.delta ?? 0}
                      </td>
                      <td><ConfidenceBadge confidence={pred?.confidence} /></td>
                      <td className="ps-catalysts">{pred?.catalysts?.join(', ') || 'No scheduled events'}</td>
                    </tr>
                    {isExpanded && pred?.catalysts?.length > 0 && (
                      <tr className="ps-expand-row">
                        <td colSpan={6}>
                          <div className="ps-expand-content">
                            <strong>Catalysts for {row.symbol}:</strong>
                            <ul>
                              {pred.catalysts.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                            <p className="ps-expand-note">
                              Confidence: <ConfidenceBadge confidence={pred.confidence} /> — 
                              {pred.confidence === 'high' ? ' Event is scheduled + historical pattern is strong.' :
                               pred.confidence === 'medium' ? ' Event is scheduled but historical pattern is moderate.' :
                               ' No major scheduled events — score based on current trend.'}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Timeline slider */}
      <div className="ps-timeline">
        <h3>Prediction Horizon Timeline</h3>
        <div className="ps-timeline-bar">
          <span className="ps-timeline-label">Now</span>
          {HORIZONS.map((h) => (
            <div key={h.value} className={`ps-timeline-point ${horizon >= h.value ? 'active' : ''}`}>
              <div className="ps-timeline-dot" />
              <span className="ps-timeline-label">{h.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
