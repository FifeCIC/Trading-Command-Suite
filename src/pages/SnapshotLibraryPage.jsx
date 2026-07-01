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
            {compResult.delta && (
              <div className="snp-delta-bar">
                <span>Change: </span>
                <strong className={compResult.delta.priceChange >= 0 ? 'snp-up' : 'snp-down'}>
                  {compResult.delta.priceChange >= 0 ? '+' : ''}{compResult.delta.priceChange}
                </strong>
                <span className={compResult.delta.priceChangePct >= 0 ? 'snp-up' : 'snp-down'}>
                  ({compResult.delta.priceChangePct >= 0 ? '+' : ''}{compResult.delta.priceChangePct}%)
                </span>
              </div>
            )}

            <div className="snp-compare-cols">
              {/* Date A */}
              <div className="snp-compare-col">
                <h3>{compResult.snapA.date}</h3>
                {compResult.snapA.closestBar ? (
                  <table className="snp-compare-table">
                    <tbody>
                      <tr><td>Open</td><td>{compResult.snapA.closestBar.open}</td></tr>
                      <tr><td>High</td><td>{compResult.snapA.closestBar.high}</td></tr>
                      <tr><td>Low</td><td>{compResult.snapA.closestBar.low}</td></tr>
                      <tr><td>Close</td><td><strong>{compResult.snapA.closestBar.close}</strong></td></tr>
                      <tr><td>Volume</td><td>{compResult.snapA.closestBar.volume?.toLocaleString() || '—'}</td></tr>
                    </tbody>
                  </table>
                ) : <p>No data for this date</p>}
                <div ref={(el) => { if (el && compResult.snapA.chartBars?.length) renderMiniChart(el, compResult.snapA.chartBars); }} className="snp-mini-chart" />
              </div>

              {/* Date B */}
              <div className="snp-compare-col">
                <h3>{compResult.snapB.date}</h3>
                {compResult.snapB.closestBar ? (
                  <table className="snp-compare-table">
                    <tbody>
                      <tr><td>Open</td><td>{compResult.snapB.closestBar.open}</td></tr>
                      <tr><td>High</td><td>{compResult.snapB.closestBar.high}</td></tr>
                      <tr><td>Low</td><td>{compResult.snapB.closestBar.low}</td></tr>
                      <tr><td>Close</td><td><strong>{compResult.snapB.closestBar.close}</strong></td></tr>
                      <tr><td>Volume</td><td>{compResult.snapB.closestBar.volume?.toLocaleString() || '—'}</td></tr>
                    </tbody>
                  </table>
                ) : <p>No data for this date</p>}
                <div ref={(el) => { if (el && compResult.snapB.chartBars?.length) renderMiniChart(el, compResult.snapB.chartBars); }} className="snp-mini-chart" />
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
