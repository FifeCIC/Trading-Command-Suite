import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import './hot-stock-picks-page.css';
import PageInfoPopover from '../components/PageInfoPopover';

const REFRESH_MS = 60_000;
const TOP_N = 10;

const DETECTION_FILTERS = [
  { id: 'all', label: 'All Picks' },
  { id: 'top-scoring', label: 'Top Scoring' },
  { id: 'entry-signal', label: 'Entry Signals' },
  { id: 'bullish', label: 'Bullish Bias' },
];

export default function HotStockPicksPage() {
  const [filter, setFilter] = useState('all');
  const qc = useQueryClient();

  const rankedQuery = useQuery({
    queryKey: ['hot-picks-ranked'],
    queryFn: () => apiGet('/api/scoring/ranked?limit=20'),
    refetchInterval: REFRESH_MS,
    staleTime: 30_000,
  });

  // Active strategies for META.Stack cross-reference
  const strategiesQuery = useQuery({
    queryKey: ['hot-picks-strategies'],
    queryFn: () => apiGet('/api/trading/strategies').catch(() => ({ strategies: [] })),
    staleTime: 60_000,
  });

  // Current priority queue
  const priorityQuery = useQuery({
    queryKey: ['hot-picks-priority'],
    queryFn: () => apiGet('/api/automation/priority').catch(() => []),
    refetchInterval: 15_000,
  });

  const boostMutation = useMutation({
    mutationFn: (body) => apiPost('/api/automation/priority', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hot-picks-priority'] }),
  });

  const removePriorityMutation = useMutation({
    mutationFn: ({ scoringStrategyId, symbol }) =>
      apiGet(`/api/automation/priority?scoringStrategyId=${scoringStrategyId}&symbol=${symbol}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hot-picks-priority'] }),
  });

  const strategies = strategiesQuery.data?.strategies || [];
  const priorityQueue = Array.isArray(priorityQuery.data) ? priorityQuery.data : [];

  const ranked = rankedQuery.data?.ranked ?? [];
  const isLoading = rankedQuery.isLoading && !rankedQuery.data;
  const isError = rankedQuery.isError;

  // Enrich and classify picks
  const picks = useMemo(() => {
    return ranked.map((r, i) => {
      const reasons = [];
      if (r.score >= 50) reasons.push('top-scoring');
      if (r.signal === 'entry') reasons.push('entry-signal');
      // Determine bias from breakdown
      const bullCount = (r.breakdown || []).filter(b => b.signalClass === 'bullish').length;
      const bearCount = (r.breakdown || []).filter(b => b.signalClass === 'bearish').length;
      if (bullCount > bearCount) reasons.push('bullish');
      else if (bearCount > bullCount) reasons.push('bearish');

      if (reasons.length === 0) reasons.push('top-scoring');

      return {
        ...r,
        rank: i + 1,
        reasons,
        bullCount,
        bearCount,
      };
    }).slice(0, TOP_N);
  }, [ranked]);

  const filteredPicks = useMemo(() => {
    if (filter === 'all') return picks;
    return picks.filter(p => p.reasons.includes(filter));
  }, [picks, filter]);

  const signalLabel = (s) => {
    switch (s) {
      case 'entry': return { text: 'Entry', cls: 'hsp-signal-entry' };
      case 'watch': return { text: 'Watch', cls: 'hsp-signal-watch' };
      default: return { text: s || '—', cls: 'hsp-signal-neutral' };
    }
  };

  const reasonLabel = (r) => {
    switch (r) {
      case 'top-scoring': return { icon: '⭐', text: 'High Score' };
      case 'entry-signal': return { icon: '🎯', text: 'Entry Signal' };
      case 'bullish': return { icon: '📈', text: 'Bullish Bias' };
      case 'bearish': return { icon: '📉', text: 'Bearish Bias' };
      default: return { icon: '📊', text: r };
    }
  };

  if (isLoading) {
    return (
      <div className="hsp-page">
        <header className="hsp-header">
          <h1>Hot Stock Picks
          <PageInfoPopover>
            Symbols showing unusual activity detected by the scoring engine.
          </PageInfoPopover>
        </h1>
        </header>
        <div className="hsp-grid">
          <LoadingSkeleton variant="card" count={6} />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="hsp-page">
        <header className="hsp-header">
          <h1>Hot Stock Picks</h1>
        </header>
        <EmptyState icon="⚠️" title="Unable to load picks" description="The scoring engine may be unavailable. Check API status." />
      </div>
    );
  }

  return (
    <div className="hsp-page">
      <header className="hsp-header">
        <h1>Hot Stock Picks</h1>
        <p className="hsp-subtitle">
          Top {TOP_N} symbols detected by scoring activity · Auto-refreshes every 60s
          {rankedQuery.isFetching && <span className="hsp-refreshing"> ⟳ refreshing…</span>}
        </p>
      </header>

      {/* Detection filters */}
      <div className="hsp-filters">
        {DETECTION_FILTERS.map(f => (
          <button
            key={f.id}
            className={`hsp-filter-chip ${filter === f.id ? 'hsp-filter-active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Picks grid */}
      {filteredPicks.length === 0 ? (
        <EmptyState icon="🔍" title="No picks match this filter" description="Try a different detection type or wait for the next refresh." />
      ) : (
        <div className="hsp-grid">
          {filteredPicks.map(pick => {
            const sig = signalLabel(pick.signal);
            return (
              <Link
                key={pick.symbolId}
                to={`/research/symbol/${pick.symbolId}`}
                className="hsp-card"
              >
                <div className="hsp-card-top">
                  <span className="hsp-rank">#{pick.rank}</span>
                  <span className="hsp-ticker">{pick.ticker}</span>
                  <span className={`hsp-signal ${sig.cls}`}>{sig.text}</span>
                </div>

                <div className="hsp-score-row">
                  <div className="hsp-score-bar">
                    <div
                      className={`hsp-score-fill ${pick.score >= 50 ? 'hsp-score-high' : pick.score >= 25 ? 'hsp-score-mid' : 'hsp-score-low'}`}
                      style={{ width: `${Math.min(pick.score, 100)}%` }}
                    />
                  </div>
                  <span className="hsp-score-value">{pick.score}</span>
                </div>

                <div className="hsp-confidence">
                  Confidence: {(pick.confidence * 100).toFixed(0)}%
                  {pick.bullCount > 0 || pick.bearCount > 0 ? (
                    <span className="hsp-bias">
                      {' · '}
                      {pick.bullCount > pick.bearCount ? '🟢' : '🔴'}
                      {' '}{pick.bullCount}B / {pick.bearCount}S
                    </span>
                  ) : null}
                </div>

                <div className="hsp-reasons">
                  {pick.reasons.map(r => {
                    const rl = reasonLabel(r);
                    return (
                      <span key={r} className="hsp-reason-tag">
                        {rl.icon} {rl.text}
                      </span>
                    );
                  })}
                </div>

                {/* Priority boost section */}
                <PriorityBoost
                  pick={pick}
                  strategies={strategies}
                  priorityQueue={priorityQueue}
                  onBoost={(strategy) => boostMutation.mutate({
                    symbol: pick.ticker,
                    scoringStrategyId: strategy.scoringStrategyId || strategy.id,
                    strategyName: strategy.name,
                    composite: pick.score,
                  })}
                  onRemove={(entry) => removePriorityMutation.mutate({
                    scoringStrategyId: entry.scoringStrategyId,
                    symbol: entry.symbol,
                  })}
                  boosting={boostMutation.isPending}
                />
              </Link>
            );
          })}
        </div>
      )}

      <footer className="hsp-footer">
        <span className="hsp-footer-note">
          Prototype · Data from scoring engine · Last updated: {new Date().toLocaleTimeString()}
        </span>
      </footer>
    </div>
  );
}

/** Priority boost UI — shown on each hot pick card */
function PriorityBoost({ pick, strategies, priorityQueue, onBoost, onRemove, boosting }) {
  // Find strategies that include this symbol
  const matchingStrategies = strategies.filter(s =>
    s.symbol?.toUpperCase() === pick.ticker?.toUpperCase() && s.active
  );

  // Check if already in priority queue
  const alreadyBoosted = priorityQueue.filter(e => e.symbol === pick.ticker);

  const handleBoost = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (matchingStrategies.length === 0) return;
    onBoost(matchingStrategies[0]);
  };

  const handleRemove = (e, entry) => {
    e.preventDefault();
    e.stopPropagation();
    onRemove(entry);
  };

  return (
    <div className="hsp-priority" onClick={e => e.preventDefault()}>
      {alreadyBoosted.length > 0 ? (
        <div className="hsp-priority-active">
          ⚡ Prioritized · expires soon
          {alreadyBoosted.map(entry => (
            <button
              key={entry.scoringStrategyId}
              className="hsp-priority-remove"
              onClick={e => handleRemove(e, entry)}
              title="Remove priority"
            >
              ✕
            </button>
          ))}
        </div>
      ) : matchingStrategies.length > 0 ? (
        <button
          className="hsp-boost-btn"
          onClick={handleBoost}
          disabled={boosting || priorityQueue.length >= 3}
          title={priorityQueue.length >= 3 ? 'Priority queue full (max 3)' : `Will execute via ${matchingStrategies[0].name}`}
        >
          {boosting ? '⏳' : '⚡'} Boost Priority
          <span className="hsp-strategy-hint">{matchingStrategies[0].name}</span>
        </button>
      ) : (
        <span className="hsp-no-strategy" title="This symbol is not part of any active trading strategy">
          📡 Signal only — no strategy linked
        </span>
      )}
    </div>
  );
}
