import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { useSearchParams } from 'react-router-dom';
import UnavailablePlaceholder from '../components/UnavailablePlaceholder';

const TYPE_OPTIONS = ['All', 'CFD', 'Forex', 'Stocks', 'Crypto', 'Indices'];
const STATUS_OPTIONS = ['All', 'Active', 'Draft'];

// ── Stack Card ─────────────────────────────────────────────
function StackCard({ stack }) {
  return (
    <div className="sa-stack-card">
      <div className="sa-stack-header" style={{ borderTopColor: stack.color }}>
        <strong>{stack.strategyName}</strong>
        <span className="sa-winrate" style={{ color: stack.color }}>
          {stack.winRate != null ? `${(stack.winRate * 100).toFixed(0)}% WR` : `${stack.symbols?.length ?? 0} symbols`}
        </span>
      </div>
      <div className="sa-stack-symbols">
        {stack.symbols.map((s) => (
          <div key={s.symbol} className="sa-symbol-row">
            <span className="sa-sym">{s.symbol}</span>
            <span className={`sa-sig-dot sa-sig-${s.signal}`} title={s.signal.toUpperCase()} />
            <span className="sa-score">{s.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────
export default function SeesArenaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') || 'All');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'All');
  const scrollRef = useRef(null);

  // Fetch arena data
  const arenaQuery = useQuery({
    queryKey: ['arena', typeFilter, statusFilter],
    queryFn: async () => {
      try {
        const data = await apiGet(`/api/scoring/arena?type=${typeFilter.toLowerCase()}&status=${statusFilter.toLowerCase()}`);
        if (data?.stacks) return data;
        return null;
      } catch {
        return null;
      }
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const data = arenaQuery.data;

  if (!data && !arenaQuery.isLoading) {
    return (
      <UnavailablePlaceholder
        title="SEES Arena"
        message="The arena scoring endpoint returned no data. The scoring pipeline may need to run first."
        action="View Live Ordering Stack"
        actionUrl="/scoring/live-ordering-stack"
      />
    );
  }

  if (arenaQuery.isLoading) {
    return <div className="sa-page"><h1>SEES Arena</h1><p className="sa-loading">Loading arena data…</p></div>;
  }

  if (!data || !data.stacks?.length) {
    return (
      <div className="sa-page">
        <h1>SEES Arena</h1>
        <p className="sa-empty">No strategies active — build one in Strategy Builder.</p>
      </div>
    );
  }

  // Update URL when filters change
  useEffect(() => {
    const params = {};
    if (typeFilter !== 'All') params.type = typeFilter;
    if (statusFilter !== 'All') params.status = statusFilter;
    setSearchParams(params, { replace: true });
  }, [typeFilter, statusFilter, setSearchParams]);

  // Keyboard nav
  useEffect(() => {
    function onKey(e) {
      if (!scrollRef.current) return;
      if (e.ctrlKey && e.key === 'ArrowRight') scrollRef.current.scrollBy({ left: 340, behavior: 'smooth' });
      if (e.ctrlKey && e.key === 'ArrowLeft') scrollRef.current.scrollBy({ left: -340, behavior: 'smooth' });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function scroll(direction) {
    if (scrollRef.current) scrollRef.current.scrollBy({ left: direction * 340, behavior: 'smooth' });
  }

  return (
    <div className="sa-page">
      <h1>SEES Arena</h1>

      {/* Filter Bar */}
      <div className="sa-filters">
        <div className="sa-filter-group">
          {TYPE_OPTIONS.map((t) => (
            <button key={t} type="button" className={typeFilter === t ? 'sa-filter-active' : ''} onClick={() => setTypeFilter(t)}>{t}</button>
          ))}
        </div>
        <div className="sa-filter-group">
          {STATUS_OPTIONS.map((s) => (
            <button key={s} type="button" className={statusFilter === s ? 'sa-filter-active' : ''} onClick={() => setStatusFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      {/* Scrolling Stacks */}
      <div className="sa-scroll-wrap">
        <button type="button" className="sa-scroll-btn sa-scroll-left" onClick={() => scroll(-1)} aria-label="Scroll left">‹</button>
        <div className="sa-stacks" ref={scrollRef}>
          {data.stacks.map((stack) => (
            <StackCard key={stack.strategyId} stack={stack} />
          ))}
          {data.stacks.length === 0 && (
            <p className="sa-empty">No strategies active — build one in Strategy Builder</p>
          )}
        </div>
        <button type="button" className="sa-scroll-btn sa-scroll-right" onClick={() => scroll(1)} aria-label="Scroll right">›</button>
      </div>

      {/* Unified Ranking */}
      <div className="sa-ranking">
        <h2>Unified Ranking</h2>
        <div className="sa-ranking-list">
          {data.unifiedRanking.map((r) => (
            <div key={`${r.rank}-${r.symbol}-${r.strategy}`} className="sa-rank-row">
              <span className="sa-rank-num">#{r.rank}</span>
              <strong>{r.symbol}</strong>
              <span className={`sa-rank-sig sa-sig-${r.signal}`}>{r.signal.toUpperCase()}</span>
              <span className="sa-rank-score">{r.score}</span>
              <span className="sa-rank-strat">{r.strategy}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
