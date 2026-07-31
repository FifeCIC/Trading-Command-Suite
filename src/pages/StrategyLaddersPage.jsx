/**
 * Strategy Ladders
 * ================
 * Detached from SEES Arena (#434). Shows trading strategies scored against
 * their protocol groups. Uses hardcoded strategy definitions from the
 * backend arena controller — future work will database-drive these.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './sees-arena.css';
import PageInfoPopover from '../components/PageInfoPopover';

export default function StrategyLaddersPage() {
  const arenaQuery = useQuery({
    queryKey: ['arena'],
    queryFn: () => apiGet('/api/scoring/arena'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  return (
    <div className="sa-page">
      <header className="sa-header">
        <div>
          <h1>Strategy Ladders
          <PageInfoPopover>
            Trading strategies scored against their protocol groups. Each strategy defines which protocols to run — 
            the best score across protocols is used. Strategies are currently hardcoded and will be database-driven in a future update.
          </PageInfoPopover>
        </h1>
        </div>
      </header>

      {arenaQuery.isLoading && <LoadingSkeleton variant="text" lines={8} />}

      {arenaQuery.data?.stacks?.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
          {arenaQuery.data.stacks.map((stack) => (
            <div key={stack.strategyId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: '0.75rem' }}>
              <div style={{ borderTop: `3px solid ${stack.color}`, paddingTop: '0.5rem', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.82rem' }}>{stack.strategyName}</strong>
                {stack.description && (
                  <span style={{ fontSize: '0.62rem', color: 'var(--ink-soft)', display: 'block', marginTop: 2, lineHeight: 1.4 }}>
                    {stack.description}
                  </span>
                )}
                <span style={{ fontSize: '0.62rem', color: 'var(--ink-soft)', display: 'block', marginTop: 4 }}>
                  {stack.symbols?.length ?? 0} symbols scored
                </span>
              </div>
              <div style={{ maxHeight: 350, overflowY: 'auto' }}>
                {stack.symbols?.map((s) => (
                  <div key={s.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0', fontSize: '0.73rem', borderBottom: '1px solid rgba(128,128,128,0.06)' }}>
                    <span>
                      <strong>{s.symbol}</strong>
                      <span style={{ fontSize: '0.6rem', color: 'var(--ink-soft)', marginLeft: 4 }}>
                        {s.signal === 'BUY' ? '▲' : s.signal === 'SELL' ? '▼' : '◆'}
                      </span>
                    </span>
                    <span className={s.score >= 65 ? 'sa-score-high' : s.score >= 40 ? 'sa-score-med' : 'sa-score-low'}
                      style={{ fontWeight: 700, padding: '1px 4px', borderRadius: 3 }}>
                      {s.score.toFixed(0)}%
                    </span>
                  </div>
                ))}
                {(!stack.symbols || stack.symbols.length === 0) && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--ink-soft)' }}>No symbols scored yet — run Compare first or wait for background scoring.</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {arenaQuery.data && !arenaQuery.data.stacks?.length && (
        <div className="sa-empty">
          <p>No trading strategies have scored data yet.</p>
          <p className="sa-hint">Strategies score symbols using protocol groups. Run a comparison or scoring run to populate stacks.</p>
        </div>
      )}

      {!arenaQuery.data && !arenaQuery.isLoading && (
        <p className="sa-empty">Backend unavailable — is the NestJS API running?</p>
      )}
    </div>
  );
}
