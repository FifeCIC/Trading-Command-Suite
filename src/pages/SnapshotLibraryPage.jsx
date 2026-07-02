import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import './snapshot-library.css';

const DEFAULT_SYMBOLS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'SPY', 'BTCUSD', 'XAUUSD', 'EURUSD'];

export default function SnapshotLibraryPage() {
  const [note, setNote] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [compSymbol, setCompSymbol] = useState('NVDA');
  const [dateA, setDateA] = useState('');
  const [dateB, setDateB] = useState('');
  const [compResult, setCompResult] = useState(null);
  const [compLoading, setCompLoading] = useState(false);
  const chartARef = useRef(null);
  const chartBRef = useRef(null);
  const qc = useQueryClient();

  const snapshotsQuery = useQuery({
    queryKey: ['snapshots'],
    queryFn: () => apiGet('/api/snapshots'),
  });

  const snapshots = snapshotsQuery.data || [];

  async function handleCapture() {
    setCapturing(true);
    await apiPost('/api/snapshots', {
      symbol: 'NVDA',
      timeframe: '1d',
      notes: note || 'Manual snapshot',
      candleData: Array.from({ length: 100 }, (_, i) => ({
        timestamp: new Date(Date.now() - (99 - i) * 3600000).toISOString(),
        open: 140 + Math.random() * 5,
        high: 143 + Math.random() * 5,
        low: 139 + Math.random() * 5,
        close: 141 + Math.random() * 5,
        volume: 50000000 + Math.random() * 20000000,
      })),
    });
    setNote('');
    setCapturing(false);
    qc.invalidateQueries({ queryKey: ['snapshots'] });
  }

  async function handleDelete(id) {
    if (!confirm('Delete this snapshot?')) return;
    await fetch(`/api/snapshots/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['snapshots'] });
  }

  async function handleCompare() {
    if (!dateA || !dateB || !compSymbol) return;
    setCompLoading(true);
    try {
      const result = await apiPost('/api/snapshots/compare', { symbol: compSymbol, dateA, dateB });
      setCompResult(result);
    } catch (e) {
      setCompResult({ error: 'Comparison failed. Is the backend running?' });
    }
    setCompLoading(false);
  }

  function renderMiniChart(el, bars) {
    if (!el || !bars?.length) return;
    const chart = createChart(el, {
      height: 150,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8', fontSize: 9 },
      grid: { vertLines: { color: 'rgba(148,163,184,0.06)' }, horzLines: { color: 'rgba(148,163,184,0.06)' } },
      timeScale: { borderColor: 'rgba(148,163,184,0.1)', timeVisible: false },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.1)' },
      crosshair: { mode: 0 },
    });
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    cs.setData(bars);
    chart.timeScale().fitContent();
  }

  return (
    <main className="snp-page">
      <header className="snp-header">
        <h1>Market Snapshots</h1>
        <p>Capture and replay chart moments for training and analysis.</p>
      </header>

      <div className="snp-capture-bar">
        <input type="text" placeholder="Notes (optional)..." value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="snp-btn" onClick={handleCapture} disabled={capturing}>
          {capturing ? 'Capturing…' : '📸 Capture NVDA Snapshot'}
        </button>
      </div>

      <div className="snp-grid">
        {snapshots.length === 0 && <p className="snp-empty">No snapshots yet. Capture one above.</p>}
        {snapshots.map((s) => (
          <article key={s.id} className="snp-card">
            <div className="snp-card-header">
              <strong>{s.symbol}</strong>
              <span className="snp-chip">{s.timeframe}</span>
              {s.starred && <span className="snp-star">⭐</span>}
            </div>
            <p className="snp-notes">{s.notes || 'No notes'}</p>
            <div className="snp-meta">
              {s.candleData?.length || 0} candles · {new Date(s.createdAt).toLocaleDateString()}
            </div>
            <div className="snp-actions">
              <button type="button" className="snp-btn-sm" onClick={() => window.open(`/research/replay/${s.id}`, '_blank')}>
                ▶ Replay
              </button>
              <button type="button" className="snp-btn-sm snp-btn-del" onClick={() => handleDelete(s.id)}>
                🗑
              </button>
            </div>
          </article>
        ))}
      </div>

      {/* ── Date-range Comparison ── */}
      <section className="snp-compare-section">
        <h2>Date-Range Comparison</h2>
        <p>Compare a symbol's state at two different points in time.</p>
        <div className="snp-compare-controls">
          <select value={compSymbol} onChange={(e) => setCompSymbol(e.target.value)}>
            {DEFAULT_SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="date" value={dateA} onChange={(e) => setDateA(e.target.value)} placeholder="Date A" />
          <input type="date" value={dateB} onChange={(e) => setDateB(e.target.value)} placeholder="Date B" />
          <button type="button" className="snp-btn" onClick={handleCompare} disabled={compLoading || !dateA || !dateB}>
            {compLoading ? 'Comparing…' : 'Compare'}
          </button>
        </div>

        {compResult?.error && <p className="snp-compare-error">{compResult.error}</p>}

        {compResult?.snapA && compResult?.snapB && (
          <div className="snp-compare-results">
            {/* Delta bar */}
            {compResult.delta && (
              <div className="snp-delta-bar">
                <span>{compResult.symbol} · </span>
                <strong className={compResult.delta.priceChange >= 0 ? 'snp-up' : 'snp-down'}>
                  {compResult.delta.priceChange >= 0 ? '+' : ''}{compResult.delta.priceChange}
                </strong>
                <span className={compResult.delta.priceChangePct >= 0 ? 'snp-up' : 'snp-down'}>
                  ({compResult.delta.priceChangePct >= 0 ? '+' : ''}{compResult.delta.priceChangePct}%)
                </span>
                {compResult.delta.signalChanged && (
                  <span className="snp-delta-badge">Signal: {compResult.delta.signalA} → {compResult.delta.signalB}</span>
                )}
                {compResult.delta.seasonalityShift && (
                  <span className="snp-delta-badge">Seasonality: {compResult.delta.seasonalityShift}</span>
                )}
                <span className="snp-delta-badge">News: {compResult.delta.newsBetween} articles</span>
                {compResult.delta.biggestDirectiveMover && (
                  <span className="snp-delta-badge">
                    Top mover: {compResult.delta.biggestDirectiveMover.id} ({compResult.delta.biggestDirectiveMover.delta >= 0 ? '+' : ''}{compResult.delta.biggestDirectiveMover.delta})
                  </span>
                )}
              </div>
            )}

            {/* Side-by-side OHLCV + charts */}
            <div className="snp-compare-cols">
              {[compResult.snapA, compResult.snapB].map((snap, si) => (
                <div className="snp-compare-col" key={si}>
                  <h3>{snap.date} {snap.scoring?.signal && <span className={`snp-signal-chip snp-signal-${snap.scoring.signal.toLowerCase()}`}>{snap.scoring.signal}</span>}</h3>
                  {snap.closestBar ? (
                    <table className="snp-compare-table">
                      <tbody>
                        <tr><td>Open</td><td>{snap.closestBar.open}</td></tr>
                        <tr><td>High</td><td>{snap.closestBar.high}</td></tr>
                        <tr><td>Low</td><td>{snap.closestBar.low}</td></tr>
                        <tr><td>Close</td><td><strong>{snap.closestBar.close}</strong></td></tr>
                        <tr><td>Volume</td><td>{snap.closestBar.volume?.toLocaleString() || '—'}</td></tr>
                      </tbody>
                    </table>
                  ) : <p>No data for this date</p>}
                  {snap.scoring && (
                    <div className="snp-scoring-mini">
                      <div className="snp-scoring-row"><span>Score</span><strong>{snap.scoring.composite?.toFixed(1)}</strong></div>
                      <div className="snp-scoring-row"><span>Directives</span><strong>{snap.scoring.activeDirectives}/{snap.scoring.directiveCount} active</strong></div>
                      <div className="snp-scoring-row"><span>Seasonality</span><strong>{(snap.scoring.seasonalityMultiplier * 100).toFixed(0)}%</strong></div>
                    </div>
                  )}
                  <div ref={(el) => { if (el && snap.chartBars?.length) renderMiniChart(el, snap.chartBars); }} className="snp-mini-chart" />
                  {snap.newsCount > 0 && (
                    <details className="snp-news-detail">
                      <summary>{snap.newsCount} news articles near this date</summary>
                      <div className="snp-news-list">
                        {snap.newsSummary?.map((n, ni) => (
                          <div key={ni} className={`snp-news-item snp-news-${n.sentiment > 0.1 ? 'pos' : n.sentiment < -0.1 ? 'neg' : 'neut'}`}>
                            <span className="snp-news-sent">{n.sentiment > 0.1 ? '🟢' : n.sentiment < -0.1 ? '🔴' : '⚪'}</span>
                            <span>{n.headline}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>

            {/* Directive-level comparison */}
            {compResult.snapA.scoring?.breakouts && compResult.snapB.scoring?.breakouts && (
              <details className="snp-directive-diff">
                <summary>Directive Score Comparison</summary>
                <table className="snp-diff-table">
                  <thead><tr><th>Directive</th><th>{compResult.snapA.date}</th><th>{compResult.snapB.date}</th><th>Δ</th></tr></thead>
                  <tbody>
                    {(() => {
                      const allKeys = new Set([...Object.keys(compResult.snapA.scoring.breakouts), ...Object.keys(compResult.snapB.scoring.breakouts)]);
                      return [...allKeys].sort().map((key) => {
                        const a = compResult.snapA.scoring.breakouts[key] || 0;
                        const b = compResult.snapB.scoring.breakouts[key] || 0;
                        const delta = b - a;
                        return (
                          <tr key={key}>
                            <td className="snp-diff-key">{key}</td>
                            <td>{a.toFixed(1)}</td>
                            <td>{b.toFixed(1)}</td>
                            <td className={delta > 0 ? 'snp-up' : delta < 0 ? 'snp-down' : ''}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
