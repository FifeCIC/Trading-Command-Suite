import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './snapshot-library.css';
import PageInfoPopover from '../components/PageInfoPopover';

const TIMEFRAMES = ['1M', '5M', '15M', '1H', '4H', '1D', '1W'];
const QUICK_SYMBOLS = ['EURUSD', 'USDJPY', 'XAUUSD', 'BTCUSD', 'SPY', 'NVDA', 'AAPL', 'MSFT'];

function MiniChart({ bars, id }) {
  const elRef = useRef(null);
  useEffect(() => {
    if (!elRef.current || !bars?.length) return;
    const chart = createChart(elRef.current, {
      height: 120,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8', fontSize: 9 },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      timeScale: { borderColor: 'rgba(148,163,184,0.1)', timeVisible: false },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.1)' },
      crosshair: { mode: 0 },
    });
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    cs.setData(bars.map(b => ({
      time: b.timestamp ? new Date(b.timestamp).toISOString().split('T')[0] : b.time,
      open: b.open, high: b.high, low: b.low, close: b.close,
    })).filter(c => c.time));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, id]);
  return <div ref={elRef} className="sl-mini-chart" />;
}

export default function SnapshotLibraryPage() {
  const qc = useQueryClient();
  const [symbol, setSymbol] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [timeframe, setTimeframe] = useState('1D');
  const [notes, setNotes] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  // Comparison state
  const [compSymbol, setCompSymbol] = useState('');
  const [dateA, setDateA] = useState('');
  const [dateB, setDateB] = useState('');
  const [compResult, setCompResult] = useState(null);
  const [compLoading, setCompLoading] = useState(false);

  const snapshotsQuery = useQuery({
    queryKey: ['snapshots'],
    queryFn: () => apiGet('/api/snapshots'),
    refetchInterval: 15000,
  });

  const importMutation = useMutation({
    mutationFn: (payload) => apiPost('/api/snapshots/import', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snapshots'] });
      setNotes('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => fetch(`/api/snapshots/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['snapshots'] }),
  });

  const snapshots = snapshotsQuery.data || [];

  const handleImport = useCallback(() => {
    if (!symbol.trim() || !startDate || !endDate) return;
    importMutation.mutate({ symbol: symbol.trim().toUpperCase(), startDate, endDate, timeframe, notes: notes || undefined });
  }, [symbol, startDate, endDate, timeframe, notes, importMutation]);

  const handleCompare = useCallback(async () => {
    if (!dateA || !dateB || !compSymbol) return;
    setCompLoading(true);
    try {
      const result = await apiPost('/api/snapshots/compare', { symbol: compSymbol, dateA, dateB });
      setCompResult(result);
    } catch {
      setCompResult({ error: 'Comparison failed. Is the backend running?' });
    }
    setCompLoading(false);
  }, [compSymbol, dateA, dateB]);

  return (
    <div className="sl-page">
      <motion.header className="sl-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Snapshot Library
          <PageInfoPopover>
            Import real market data for a symbol + date range. Use snapshots for backtesting and moment-in-time replay.
          </PageInfoPopover>
        </h1>
      </motion.header>

      {/* ── Import Form ── */}
      <motion.div className="sl-import-form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <h3>Import Market Data</h3>
        <div className="sl-import-grid">
          <div className="sl-field">
            <label>Symbol</label>
            <input
              type="text" className="sl-input"
              value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="EURUSD, NVDA..."
            />
            <div className="sl-quick-symbols">
              {QUICK_SYMBOLS.map(s => (
                <button key={s} className={`sl-quick-chip ${symbol === s ? 'active' : ''}`} onClick={() => setSymbol(s)}>{s}</button>
              ))}
            </div>
          </div>
          <div className="sl-field">
            <label>Timeframe</label>
            <select className="sl-input" value={timeframe} onChange={e => setTimeframe(e.target.value)}>
              {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
            </select>
          </div>
          <div className="sl-field">
            <label>Start Date</label>
            <input type="date" className="sl-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="sl-field">
            <label>End Date</label>
            <input type="date" className="sl-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
        <div className="sl-import-actions">
          <input type="text" className="sl-input sl-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
          <button className="sl-import-btn" onClick={handleImport} disabled={importMutation.isPending || !symbol || !startDate || !endDate}>
            {importMutation.isPending ? '⏳ Importing...' : '📥 Import Snapshot'}
          </button>
        </div>
        {importMutation.data && (
          <div className="sl-import-result">
            ✅ Imported {importMutation.data.symbol} — {importMutation.data.candleData?.length || 0} candles from {importMutation.data.source}
          </div>
        )}
      </motion.div>

      {/* ── Snapshot List ── */}
      <motion.div className="sl-list-section" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
        <h3>Saved Snapshots ({snapshots.length})</h3>
        {snapshotsQuery.isLoading ? <LoadingSkeleton variant="card" count={2} /> : snapshots.length === 0 ? (
          <p className="sl-empty">No snapshots yet. Import market data above to create one.</p>
        ) : (
          <div className="sl-list">
            {snapshots.map((snap, i) => (
              <motion.div
                key={snap.id}
                className={`sl-card ${expandedId === snap.id ? 'sl-expanded' : ''}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => setExpandedId(expandedId === snap.id ? null : snap.id)}
              >
                <div className="sl-card-top">
                  <span className="sl-card-symbol">{snap.symbol}</span>
                  <span className="sl-card-tf">{snap.timeframe}</span>
                  <span className="sl-card-bars">{snap.candleData?.length || 0} candles</span>
                  <span className={`sl-card-source sl-src-${snap.source || 'empty'}`}>{snap.source || 'manual'}</span>
                  <span className="sl-card-date">{new Date(snap.createdAt).toLocaleDateString()}</span>
                  <button className="sl-delete-btn" onClick={e => { e.stopPropagation(); deleteMutation.mutate(snap.id); }}>✕</button>
                </div>
                {snap.notes && <p className="sl-card-notes">{snap.notes}</p>}
                {snap.startTime && snap.endTime && (
                  <p className="sl-card-range">
                    {new Date(snap.startTime).toLocaleDateString()} → {new Date(snap.endTime).toLocaleDateString()}
                  </p>
                )}

                <AnimatePresence>
                  {expandedId === snap.id && (
                    <motion.div className="sl-expand" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                      <MiniChart bars={snap.candleData} id={snap.id} />
                      <div className="sl-expand-actions">
                        <span>First: {snap.candleData?.[0]?.close?.toFixed(2) || '—'}</span>
                        <span>Last: {snap.candleData?.[snap.candleData?.length - 1]?.close?.toFixed(2) || '—'}</span>
                        {snap.candleData?.length > 1 && (() => {
                          const first = snap.candleData[0]?.close;
                          const last = snap.candleData[snap.candleData.length - 1]?.close;
                          const chg = first && last ? ((last - first) / first * 100) : 0;
                          return <span style={{ color: chg >= 0 ? '#22c55e' : '#ef4444' }}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>;
                        })()}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* ── Compare ── */}
      <motion.div className="sl-compare-section" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
        <h3>Date-Range Comparison</h3>
        <p className="sl-hint">Compare directive scoring at two different dates for the same symbol.</p>
        <div className="sl-compare-grid">
          <div className="sl-field">
            <label>Symbol</label>
            <input type="text" className="sl-input" value={compSymbol} onChange={e => setCompSymbol(e.target.value.toUpperCase())} placeholder="NVDA" />
          </div>
          <div className="sl-field">
            <label>Date A</label>
            <input type="date" className="sl-input" value={dateA} onChange={e => setDateA(e.target.value)} />
          </div>
          <div className="sl-field">
            <label>Date B</label>
            <input type="date" className="sl-input" value={dateB} onChange={e => setDateB(e.target.value)} />
          </div>
          <div className="sl-field sl-field-btn">
            <button className="sl-compare-btn" onClick={handleCompare} disabled={compLoading || !compSymbol || !dateA || !dateB}>
              {compLoading ? '⏳' : '⚖'} Compare
            </button>
          </div>
        </div>

        {compResult && !compResult.error && (() => {
          const r = compResult;
          const d = r.delta || {};
          const a = r.snapA || {};
          const b = r.snapB || {};
          return (
            <motion.div className="sl-compare-result" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="sl-compare-header">
                <span className="sl-cmp-symbol">{r.symbol}</span>
                <span className="sl-cmp-date-range">{a.date || 'A'} → {b.date || 'B'}</span>
              </div>

              {/* Price */}
              <div className="sl-cmp-metrics">
                <div className="sl-cmp-card">
                  <span className="sl-cmp-label">Price</span>
                  <span className="sl-cmp-val">${a.closestBar?.close?.toFixed(2) || '—'}</span>
                  <span className="sl-cmp-arrow">→</span>
                  <span className="sl-cmp-val">${b.closestBar?.close?.toFixed(2) || '—'}</span>
                  <span className={`sl-cmp-delta ${d.priceChange >= 0 ? 'pos' : 'neg'}`}>
                    {d.priceChangePct != null ? `${d.priceChangePct >= 0 ? '+' : ''}${d.priceChangePct}%` : '—'}
                  </span>
                </div>

                {/* Composite Score */}
                <div className="sl-cmp-card">
                  <span className="sl-cmp-label">Score</span>
                  <span className="sl-cmp-val">{a.scoring?.composite?.toFixed(0) || '—'}</span>
                  <span className="sl-cmp-arrow">→</span>
                  <span className="sl-cmp-val">{b.scoring?.composite?.toFixed(0) || '—'}</span>
                  <span className={`sl-cmp-delta ${d.compositeChange >= 0 ? 'pos' : 'neg'}`}>
                    {d.compositeChange >= 0 ? '+' : ''}{d.compositeChange}
                  </span>
                </div>

                {/* Signal */}
                <div className="sl-cmp-card">
                  <span className="sl-cmp-label">Signal</span>
                  <span className={`sl-cmp-signal ${(d.signalA || '').toLowerCase()}`}>{d.signalA || '—'}</span>
                  <span className="sl-cmp-arrow">→</span>
                  <span className={`sl-cmp-signal ${(d.signalB || '').toLowerCase()}`}>{d.signalB || '—'}</span>
                  {d.signalChanged && <span className="sl-cmp-flip">⬡ Changed</span>}
                </div>

                {/* Sub-scores */}
                {a.scoring?.subScores && b.scoring?.subScores && (
                  <div className="sl-cmp-card sl-cmp-card-wide">
                    <span className="sl-cmp-label">Sub-Scores</span>
                    <div className="sl-cmp-subs">
                      <span className="sl-cmp-sub">Technical: {a.scoring.subScores.technical?.toFixed(0) || '—'} → {b.scoring.subScores.technical?.toFixed(0) || '—'}</span>
                      <span className="sl-cmp-sub">Sentiment: {a.scoring.subScores.sentiment?.toFixed(0) || '—'} → {b.scoring.subScores.sentiment?.toFixed(0) || '—'}</span>
                      <span className="sl-cmp-sub">Risk: {a.scoring.subScores.risk?.toFixed(0) || '—'} → {b.scoring.subScores.risk?.toFixed(0) || '—'}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Delta details */}
              <div className="sl-cmp-details">
                {d.biggestDirectiveMover && (
                  <div className="sl-cmp-detail-row">
                    <span className="sl-cmp-detail-label">Biggest directive mover</span>
                    <span>{d.biggestDirectiveMover.id} ({d.biggestDirectiveMover.delta >= 0 ? '+' : ''}{d.biggestDirectiveMover.delta})</span>
                  </div>
                )}
                {d.newsBetween != null && (
                  <div className="sl-cmp-detail-row">
                    <span className="sl-cmp-detail-label">News between dates</span>
                    <span>{d.newsBetween} article{d.newsBetween !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {d.seasonalityShift && (
                  <div className="sl-cmp-detail-row">
                    <span className="sl-cmp-detail-label">Seasonality shift</span>
                    <span>{d.seasonalityShift}</span>
                  </div>
                )}
                {a.newsSummary?.length > 0 && (
                  <div className="sl-cmp-detail-row sl-cmp-news">
                    <span className="sl-cmp-detail-label">News at Date A</span>
                    <div className="sl-cmp-news-list">
                      {a.newsSummary.slice(0, 3).map((n, i) => (
                        <div key={i} className="sl-cmp-news-item">{n.headline}</div>
                      ))}
                    </div>
                  </div>
                )}
                {b.newsSummary?.length > 0 && (
                  <div className="sl-cmp-detail-row sl-cmp-news">
                    <span className="sl-cmp-detail-label">News at Date B</span>
                    <div className="sl-cmp-news-list">
                      {b.newsSummary.slice(0, 3).map((n, i) => (
                        <div key={i} className="sl-cmp-news-item">{n.headline}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })()}
        {compResult?.error && <p className="sl-error">{compResult.error}</p>}
      </motion.div>
    </div>
  );
}
