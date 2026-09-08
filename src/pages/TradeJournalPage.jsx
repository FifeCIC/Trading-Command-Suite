import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import './trade-journal-page.css';

/**
 * Map a Trade row (the app's own audit trail — /api/trading/trade-history)
 * to a journal entry. This is the DB-first source of truth: it includes
 * brokerTicket (64-bit MT5 ticket), origin (manual/bot/external), source
 * pipeline, and the real exit price + PnL from position reconciliation.
 */
function mapTradeToEntry(t) {
  const isOpen = t.status === 'open';
  return {
    id: t.id,
    symbol: t.symbol || '—',
    type: (t.side || 'buy').toLowerCase(),
    pnl: t.pnl ?? 0,
    volume: t.quantity || 0,
    entryPrice: t.entryPrice || 0,
    exitPrice: t.exitPrice ?? null,
    holdDuration: '—',
    date: (t.closedAt || t.openedAt || t.createdAt || new Date()).toString(),
    notes: t.brokerComment || '',
    tags: [],
    brokerTicket: t.brokerTicket || null,
    origin: t.origin || 'unknown',
    source: t.source || null,
    status: t.status,
    strategy: t.strategy || null,
    isOpen,
  };
}

export default function TradeJournalPage() {
  const [analyzing, setAnalyzing] = useState(null);

  // ── DB-first: the app's own reconciled trade history ──
  const historyQuery = useQuery({
    queryKey: ['journal-trade-history'],
    queryFn: () => apiGet('/api/trading/trade-history?limit=500').catch(() => ({ trades: [] })),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const trades = historyQuery.data?.trades || [];
  const entries = useMemo(() => trades.map(mapTradeToEntry), [trades]);

  // ── Compute stats from real data ──
  const stats = useMemo(() => {
    if (entries.length === 0) return {};
    const closed = entries.filter(e => !e.isOpen);
    const wins = closed.filter(e => e.pnl > 0);
    const losses = closed.filter(e => e.pnl < 0);
    const totalPnl = closed.reduce((s, e) => s + e.pnl, 0);
    const winRate = closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(0) + '%' : '—';
    const avgWinPnl = wins.length > 0 ? (wins.reduce((s, e) => s + e.pnl, 0) / wins.length).toFixed(2) : '0';
    const avgLossPnl = losses.length > 0 ? Math.abs(losses.reduce((s, e) => s + e.pnl, 0) / losses.length).toFixed(2) : '0';
    const byDay = {};
    closed.forEach(e => {
      const day = new Date(e.date).toLocaleDateString();
      byDay[day] = (byDay[day] || 0) + e.pnl;
    });
    const days = Object.entries(byDay).sort((a, b) => b[1] - a[1]);
    const bestDay = days[0]?.[0] || '—';
    const worstDay = days[days.length - 1]?.[0] || '—';
    return { totalTrades: entries.length, closedCount: closed.length, winRate, totalPnl, avgWinPnl, avgLossPnl, bestDay, worstDay };
  }, [entries]);

  const handleAnalyze = async (id) => {
    setAnalyzing(id);
    try {
      await apiPost('/api/journal/entries/analyze', { id });
    } catch { /* analysis endpoint may not exist yet */ }
    setAnalyzing(null);
  };

  const currencySymbol = '$'; // MT5 is USD-denominated

  return (
    <div className="tj-page">
      <header className="tj-header">
        <h2>Trade Journal</h2>
        <p>Reconciled trades from the app's own audit trail — includes externally-opened and manually-closed positions.</p>
        <p className="tj-privacy">Source: <strong>database</strong> (live MT5 deals are shown on Trade History).</p>
      </header>
      {stats.totalTrades > 0 && (
        <div className="tj-stats">
          <div className="tj-stat-card"><span className="tj-stat-num">{stats.totalTrades}</span><span>Total</span></div>
          <div className="tj-stat-card"><span className="tj-stat-num">{stats.closedCount}</span><span>Closed</span></div>
          <div className="tj-stat-card"><span className="tj-stat-num">{stats.winRate}</span><span>Win Rate</span></div>
          <div className="tj-stat-card"><span className={`tj-stat-num ${stats.totalPnl >= 0 ? 'tj-green' : 'tj-red'}`}>{stats.totalPnl >= 0 ? '+' : ''}{currencySymbol}{Math.abs(stats.totalPnl || 0).toFixed(2)}</span><span>Total P&amp;L</span></div>
          <div className="tj-stat-card"><span className="tj-stat-num tj-green">+{currencySymbol}{stats.avgWinPnl}</span><span>Avg Win</span></div>
          <div className="tj-stat-card"><span className="tj-stat-num tj-red">-{currencySymbol}{stats.avgLossPnl}</span><span>Avg Loss</span></div>
        </div>
      )}
      {stats.bestDay && (
        <div className="tj-ai-summary">
          <h3>Trade Summary</h3>
          <p><strong>Best day:</strong> {stats.bestDay} | <strong>Worst:</strong> {stats.worstDay}</p>
        </div>
      )}
      <div className="tj-entries">
        {historyQuery.isLoading && <p>Loading trades from the audit trail...</p>}
        {!historyQuery.isLoading && entries.length === 0 && (
          <div className="tj-empty"><p>No trades recorded yet. The automation loop records every position it sees — open a position (via Signals, the bot, or directly in MT5) and it will appear here.</p></div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className={`tj-card ${entry.isOpen ? 'tj-open' : entry.pnl >= 0 ? 'tj-win' : 'tj-loss'}`}>
            <div className="tj-card-header">
              <span className="tj-symbol">{entry.symbol}</span>
              <span className={`tj-type ${entry.type === 'buy' ? 'tj-buy' : 'tj-sell'}`}>{entry.type?.toUpperCase()}</span>
              {entry.brokerTicket && <span className="tj-ticket" title={`MT5 ticket #${entry.brokerTicket}`}>#{entry.brokerTicket}</span>}
              <span className={`tj-origin tj-origin-${entry.origin}`}>{entry.origin}</span>
              <span className={`tj-pnl ${entry.isOpen ? '' : entry.pnl >= 0 ? 'tj-green' : 'tj-red'}`}>{entry.isOpen ? 'OPEN' : entry.pnl >= 0 ? '+' : ''}{!entry.isOpen ? currencySymbol + Math.abs(entry.pnl).toFixed(2) : ''}</span>
            </div>
            <div className="tj-card-body">
              <div className="tj-details">
                <span>Vol: {entry.volume}</span><span>Entry: {currencySymbol}{Number(entry.entryPrice).toFixed(2)}</span>
                {entry.exitPrice != null && <span>Exit: {currencySymbol}{Number(entry.exitPrice).toFixed(2)}</span>}
                {entry.strategy && <span>Strategy: {entry.strategy}</span>}
                <span>{new Date(entry.date).toLocaleDateString()}</span>
              </div>
              {entry.tags && <div className="tj-tags">{entry.tags.map((tag) => <span key={tag} className="tj-tag">{tag}</span>)}</div>}
              {entry.notes && <p className="tj-note">{entry.notes}</p>}
            </div>
            <div className="tj-card-footer">
              <button className="tj-btn-ai" onClick={() => handleAnalyze(entry.id)} disabled={analyzing === entry.id}>
                {analyzing === entry.id ? 'Analyzing...' : 'AI Review'}
              </button>
              {entry.aiAnalysis && <div className="tj-analysis"><pre>{entry.aiAnalysis}</pre></div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
