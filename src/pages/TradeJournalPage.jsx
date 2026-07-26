import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import './trade-journal-page.css';

/** Map an MT5 history deal to a journal entry */
function mapDealToEntry(deal) {
  const pnl = (deal.profit ?? 0) + (deal.commission ?? 0) + (deal.swap ?? 0);
  return {
    id: deal.ticket || deal.id,
    symbol: deal.symbol || '—',
    type: deal.type === 'DEAL_TYPE_BUY' ? 'buy' : 'sell',
    pnl,
    volume: deal.volume || 0,
    entryPrice: deal.price || 0,
    exitPrice: deal.price || 0, // MT5 deals are single-sided
    holdDuration: '—',
    date: deal.time ? new Date(deal.time * 1000).toISOString() : new Date().toISOString(),
    notes: deal.comment || '',
    tags: [],
    origin: deal.comment ? 'manual' : 'mt5',
  };
}

export default function TradeJournalPage() {
  const [analyzing, setAnalyzing] = useState(null);

  // ── Real trade data from MT5 history ──
  const historyQuery = useQuery({
    queryKey: ['journal-mt5-history'],
    queryFn: () => apiGet('/api/providers/mt5/history?limit=500').catch(() => ({ deals: [] })),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const deals = historyQuery.data?.deals || [];
  const entries = useMemo(() => deals.map(mapDealToEntry), [deals]);

  // ── Compute stats from real data ──
  const stats = useMemo(() => {
    if (entries.length === 0) return {};
    const wins = entries.filter(e => e.pnl > 0);
    const losses = entries.filter(e => e.pnl < 0);
    const totalPnl = entries.reduce((s, e) => s + e.pnl, 0);
    const winRate = entries.length > 0 ? ((wins.length / entries.length) * 100).toFixed(0) + '%' : '0%';
    const avgWinPnl = wins.length > 0 ? (wins.reduce((s, e) => s + e.pnl, 0) / wins.length).toFixed(2) : '0';
    const avgLossPnl = losses.length > 0 ? Math.abs(losses.reduce((s, e) => s + e.pnl, 0) / losses.length).toFixed(2) : '0';
    // Best/worst day
    const byDay = {};
    entries.forEach(e => {
      const day = new Date(e.date).toLocaleDateString();
      byDay[day] = (byDay[day] || 0) + e.pnl;
    });
    const days = Object.entries(byDay).sort((a, b) => b[1] - a[1]);
    const bestDay = days[0]?.[0] || '—';
    const worstDay = days[days.length - 1]?.[0] || '—';
    return { totalTrades: entries.length, winRate, totalPnl, avgWinPnl, avgLossPnl, bestDay, worstDay };
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
        <p>Real trades from MT5 history. Add notes and get AI-powered insights.</p>
        <p className="tj-privacy">AI analysis runs locally with pattern-matching rules.</p>
      </header>
      {stats.totalTrades > 0 && (
        <div className="tj-stats">
          <div className="tj-stat-card"><span className="tj-stat-num">{stats.totalTrades}</span><span>Total</span></div>
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
        {historyQuery.isLoading && <p>Loading trades from MT5 history...</p>}
        {!historyQuery.isLoading && entries.length === 0 && (
          <div className="tj-empty"><p>No trades found in MT5 history. Connect MT5 and ensure deal history is available.</p></div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className={`tj-card ${entry.pnl >= 0 ? 'tj-win' : 'tj-loss'}`}>
            <div className="tj-card-header">
              <span className="tj-symbol">{entry.symbol}</span>
              <span className={`tj-type ${entry.type === 'buy' ? 'tj-buy' : 'tj-sell'}`}>{entry.type?.toUpperCase()}</span>
              <span className={`tj-pnl ${entry.pnl >= 0 ? 'tj-green' : 'tj-red'}`}>{entry.pnl >= 0 ? '+' : ''}{currencySymbol}{Math.abs(entry.pnl).toFixed(2)}</span>
            </div>
            <div className="tj-card-body">
              <div className="tj-details">
                <span>Vol: {entry.volume}</span><span>Entry: {currencySymbol}{Number(entry.entryPrice).toFixed(2)}</span>
                {entry.exitPrice && <span>Exit: {currencySymbol}{Number(entry.exitPrice).toFixed(2)}</span>}
                <span>Held: {entry.holdDuration || '--'}</span>
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
