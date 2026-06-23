import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './multi-strategy-comparison.css';

const DISPLAY_MODES = ['compact', 'expanded', 'minimal'];

function SignalBadge({ signal }) {
  const tone = signal === 'entry' ? 'msc-entry' : signal === 'watch' ? 'msc-watch' : signal === 'no_data' ? 'msc-nodata' : 'msc-defensive';
  return <span className={`msc-signal ${tone}`}>{signal}</span>;
}

function StrategyPanel({ strategy, displayMode }) {
  const scoringQuery = useQuery({
    queryKey: ['scoring-ranked', strategy.id],
    queryFn: () => apiGet(`/api/scoring/ranked?strategyId=${strategy.id}&limit=5`),
    refetchInterval: 30_000,
    retry: 1,
  });

  const data = scoringQuery.data;
  const ranked = Array.isArray(data?.ranked) ? data.ranked : [];
  const mode = data?.mode || 'fallback';
  const summary = data?.summary;

  return (
    <div className="msc-panel">
      <div className="msc-panel-header">
        <h3>{strategy.name || strategy.id}</h3>
        <span className={`msc-mode msc-mode--${mode}`}>{mode}</span>
      </div>

      {summary && (
        <p className="msc-summary">
          {summary.symbolsWithData}/{summary.totalSymbols} symbols with data
        </p>
      )}

      {scoringQuery.isLoading && <p className="msc-loading">Loading scores...</p>}
      {scoringQuery.isError && <p className="msc-error">Unavailable</p>}

      {displayMode !== 'minimal' && ranked.length > 0 && (
        <table className="msc-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Score</th>
              {displayMode === 'expanded' && <><th>Conf</th><th>Fresh</th></>}
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.symbolId}>
                <td><strong>{r.ticker}</strong></td>
                <td>{r.score?.toFixed(1) ?? '—'}</td>
                {displayMode === 'expanded' && (
                  <><td>{r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : '—'}</td>
                  <td>{r.freshness || r.dataStatus || '—'}</td></>
                )}
                <td><SignalBadge signal={r.signal} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {displayMode === 'minimal' && ranked.length > 0 && (
        <div className="msc-minimal">
          {ranked.map((r) => (
            <div key={r.symbolId} className="msc-minimal-row">
              <strong>{r.ticker}</strong>
              <SignalBadge signal={r.signal} />
            </div>
          ))}
        </div>
      )}

      {ranked.length === 0 && !scoringQuery.isLoading && (
        <p className="msc-empty">No scores yet</p>
      )}

      <p className="msc-footer">Updated {new Date().toLocaleTimeString()}</p>
    </div>
  );
}

export default function MultiStrategyComparisonPage() {
  const [displayMode, setDisplayMode] = useState('compact');

  const strategiesQuery = useQuery({
    queryKey: ['strategies-list'],
    queryFn: () => apiGet('/api/strategies'),
    staleTime: 120_000,
  });

  const strategies = (Array.isArray(strategiesQuery.data?.strategies) ? strategiesQuery.data.strategies : [])
    .filter((s) => s.active !== false);

  return (
    <div className="msc-page">
      <div className="msc-topbar">
        <h1>Strategy Comparison</h1>
        <div className="msc-controls">
          <span>{strategies.length} strategies</span>
          <div className="msc-modes">
            {DISPLAY_MODES.map((m) => (
              <button key={m} className={displayMode === m ? 'msc-mode-btn active' : 'msc-mode-btn'} onClick={() => setDisplayMode(m)}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {strategiesQuery.isLoading && <p>Loading strategies...</p>}
      {strategiesQuery.isError && <p className="msc-error">Failed to load strategies</p>}

      {strategies.length === 0 && !strategiesQuery.isLoading && (
        <div className="msc-empty-state">
          <p>No active strategies found. Run the Setup Wizard to configure strategies.</p>
        </div>
      )}

      <div className="msc-scroll">
        {strategies.map((s) => (
          <StrategyPanel key={s.id} strategy={s} displayMode={displayMode} />
        ))}
      </div>
    </div>
  );
}
