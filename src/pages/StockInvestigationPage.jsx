import { useState } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './stock-investigation.css';

export default function StockInvestigationPage() {
  const [symbol, setSymbol] = useState('');
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['investigations'],
    queryFn: () => apiGet('/api/research/investigations?limit=30'),
    refetchInterval: 60000,
  });

  const createMutation = useMutation({
    mutationFn: (body) => apiPost('/api/research/investigations', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investigations'] });
      setSymbol('');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, outcome }) =>
      apiPost(`/api/research/investigations/${id}/status`, { status, outcome }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['investigations'] }),
  });

  const investigations = listQuery.data ?? [];
  const apiOnline = !listQuery.isError;

  const handleInvestigate = (e) => {
    e.preventDefault();
    if (!symbol.trim()) return;
    createMutation.mutate({ symbol: symbol.trim().toUpperCase(), trigger: 'manual' });
  };

  return (
    <div className="si-page">
      <motion.header className="si-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>🔍 Stock Investigation</h1>
        <p className="si-subtitle">Persistent research — investigations survive sessions and build knowledge over time</p>
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}

      <form className="si-form" onSubmit={handleInvestigate}>
        <input
          className="si-input"
          type="text"
          placeholder="Symbol (e.g. NVDA, TSLA)..."
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          disabled={createMutation.isPending}
        />
        <button className="si-btn" type="submit" disabled={createMutation.isPending || !symbol.trim()}>
          {createMutation.isPending ? 'Investigating...' : 'Investigate'}
        </button>
      </form>

      {listQuery.isLoading && <LoadingSkeleton variant="text" lines={6} />}

      {!listQuery.isLoading && investigations.length === 0 && (
        <div className="si-empty">
          <p>No investigations yet. Enter a symbol above to start your first investigation.</p>
        </div>
      )}

      <div className="si-list">
        {investigations.map((inv, i) => (
          <motion.div
            key={inv.id}
            className={`si-card si-${inv.status}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
          >
            <div className="si-card-header">
              <span className="si-symbol">{inv.symbol}</span>
              <span className="si-status">{inv.status}</span>
              <span className="si-date">{new Date(inv.investigatedAt).toLocaleDateString()}</span>
            </div>
            <div className="si-card-body">
              <p className="si-summary">{inv.summary}</p>
              <div className="si-meta">
                <span>Trigger: {inv.trigger}</span>
                {inv.priceAtTime > 0 && <span>Price: ${inv.priceAtTime}</span>}
                {inv.analystConsensus && <span>{inv.analystConsensus}</span>}
                <span>{inv.newsCount} articles</span>
              </div>
            </div>
            {inv.status !== 'closed' && (
              <div className="si-actions">
                {inv.status === 'open' && (
                  <button
                    className="si-action-btn"
                    onClick={() => statusMutation.mutate({ id: inv.id, status: 'monitoring' })}
                  >
                    Start Monitoring
                  </button>
                )}
                <button
                  className="si-action-btn si-close"
                  onClick={() => statusMutation.mutate({ id: inv.id, status: 'closed', outcome: 'Archived' })}
                >
                  Close
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
