import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import './TradeJournalPage.css';

export default function TradeJournalPage() {
  const [analyzing, setAnalyzing] = useState(null);
  const [editingNote, setEditingNote] = useState(null);

  const entriesQuery = useQuery({
    queryKey: ['journal-entries'],
    queryFn: () => fetch('/api/journal/entries').then((r) => r.json()),
    staleTime: 30000,
  });
  const statsQuery = useQuery({
    queryKey: ['journal-stats'],
    queryFn: () => fetch('/api/journal/stats').then((r) => r.json()),
    staleTime: 60000,
  });

  const entries = entriesQuery.data || [];
  const stats = statsQuery.data || {};

  const handleAnalyze = async (id) => {
    setAnalyzing(id);
    await fetch(`/api/journal/entries/${id}/analyze`, { method: 'POST' });
    entriesQuery.refetch();
    setAnalyzing(null);
  };

  const handleAddNote = async (id, notes) => {
    await fetch(`/api/journal/entries/${id}/note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) });
    setEditingNote(null);
    entriesQuery.refetch();
  };

  return (
    <div className="tj-page">
      <header className="tj-header">
        <h2>Trade Journal</h2>
        <p>Review your trades, add notes, and get AI-powered insights.</p>
        <p className="tj-privacy">AI analysis runs locally with pattern-matching rules.</p>
      </header>
      {stats.totalTrades > 0 && (
        <div className="tj-stats">
          <div className="tj-stat-card"><span className="tj-stat-num">{stats.totalTrades}</span><span>Total</span></div>
          <div className="tj-stat-card"><span className="tj-stat-num">{stats.winRate}</span><span>Win Rate</span></div>
          <div className="tj-stat-card"><span className={`tj-stat-num ${stats.totalPnl >= 0 ? 'tj-green' : 'tj-red'}`}>{stats.totalPnl >= 0 ? '+' : ''}£{Math.abs(stats.totalPnl || 0).toFixed(2)}</span><span>Total P&amp;L</span></div>
          <div className="tj-stat-card"><span className="tj-stat-num tj-green">+£{stats.avgWinPnl}</span><span>Avg Win</span></div>
          <div className="tj-stat-card"><span className="tj-stat-num tj-red">-£{Math.abs(stats.avgLossPnl)}</span><span>Avg Loss</span></div>
        </div>
      )}
      {stats.topStrength && (
        <div className="tj-ai-summary">
          <h3>AI Insights</h3>
          <p><strong>Strength:</strong> {stats.topStrength}</p>
          <p><strong>Weakness:</strong> {stats.topWeakness}</p>
          <p><strong>Best day:</strong> {stats.bestDay} | <strong>Worst:</strong> {stats.worstDay}</p>
        </div>
      )}
      <div className="tj-entries">
        {entriesQuery.isLoading && <p>Loading journal...</p>}
        {!entriesQuery.isLoading && entries.length === 0 && (
          <div className="tj-empty"><p>No trade journal entries yet. Connect a trading account or add entries manually.</p></div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className={`tj-card ${entry.pnl >= 0 ? 'tj-win' : 'tj-loss'}`}>
            <div className="tj-card-header">
              <span className="tj-symbol">{entry.symbol}</span>
              <span className={`tj-type ${entry.type === 'buy' ? 'tj-buy' : 'tj-sell'}`}>{entry.type?.toUpperCase()}</span>
              <span className={`tj-pnl ${entry.pnl >= 0 ? 'tj-green' : 'tj-red'}`}>{entry.pnl >= 0 ? '+' : ''}£{Math.abs(entry.pnl).toFixed(2)}</span>
            </div>
            <div className="tj-card-body">
              <div className="tj-details">
                <span>Vol: {entry.volume}</span><span>Entry: £{entry.entryPrice}</span>
                {entry.exitPrice && <span>Exit: £{entry.exitPrice}</span>}
                <span>Held: {entry.holdDuration || '--'}</span>
                <span>{new Date(entry.date).toLocaleDateString()}</span>
              </div>
              {entry.tags && <div className="tj-tags">{entry.tags.map((tag) => <span key={tag} className="tj-tag">{tag}</span>)}</div>}
              {entry.notes && <p className="tj-note">{entry.notes}</p>}
              {editingNote === entry.id ? (
                <div className="tj-note-edit"><textarea id={`note-${entry.id}`} defaultValue={entry.notes} rows={2} /><button onClick={() => handleAddNote(entry.id, document.getElementById(`note-${entry.id}`).value)}>Save</button><button onClick={() => setEditingNote(null)}>Cancel</button></div>
              ) : (
                <button className="tj-btn-sm" onClick={() => setEditingNote(entry.id)}>+ Add Note</button>
              )}
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
