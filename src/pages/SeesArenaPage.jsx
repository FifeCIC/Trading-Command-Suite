import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { useSearchParams } from 'react-router-dom';

// ── Mock strategy/stack data ───────────────────────────────
const MOCK_ARENA = {
  stacks: [
    { strategy: 'Forex Momentum', id: 'forex-momentum', color: '#00a63e', winRate: 0.62, symbols: [
      { symbol: 'EURUSD', score: 92, signal: 'buy', prevScore: 88 },
      { symbol: 'GBPUSD', score: 85, signal: 'buy', prevScore: 82 },
      { symbol: 'USDJPY', score: 78, signal: 'buy', prevScore: 80 },
      { symbol: 'AUDUSD', score: 71, signal: 'hold', prevScore: 69 },
      { symbol: 'USDCAD', score: 65, signal: 'sell', prevScore: 70 },
    ]},
    { strategy: 'Tech Breakout', id: 'tech-breakout', color: '#0ea5a6', winRate: 0.58, symbols: [
      { symbol: 'NVDA', score: 88, signal: 'buy', prevScore: 90 },
      { symbol: 'MSFT', score: 72, signal: 'buy', prevScore: 68 },
      { symbol: 'AAPL', score: 68, signal: 'hold', prevScore: 65 },
      { symbol: 'GOOGL', score: 62, signal: 'hold', prevScore: 60 },
      { symbol: 'META', score: 55, signal: 'sell', prevScore: 58 },
    ]},
    { strategy: 'Crypto Scalp', id: 'crypto-scalp', color: '#8f7dff', winRate: 0.45, symbols: [
      { symbol: 'BTC-USD', score: 75, signal: 'sell', prevScore: 80 },
      { symbol: 'ETH-USD', score: 70, signal: 'sell', prevScore: 72 },
      { symbol: 'SOL-USD', score: 62, signal: 'hold', prevScore: 60 },
      { symbol: 'DOGE-USD', score: 48, signal: 'sell', prevScore: 52 },
      { symbol: 'XRP-USD', score: 40, signal: 'sell', prevScore: 38 },
    ]},
    { strategy: 'Mean Reversion', id: 'mean-reversion', color: '#ffb347', winRate: 0.55, symbols: [
      { symbol: 'EURUSD', score: 81, signal: 'buy', prevScore: 78 },
      { symbol: 'GBPUSD', score: 79, signal: 'buy', prevScore: 76 },
      { symbol: 'SPY', score: 73, signal: 'buy', prevScore: 70 },
      { symbol: 'QQQ', score: 66, signal: 'hold', prevScore: 64 },
      { symbol: 'IWM', score: 58, signal: 'sell', prevScore: 60 },
    ]},
  ],
  unifiedRanking: [
    { rank: 1, symbol: 'EURUSD', score: 92, strategy: 'Forex Momentum', signal: 'buy' },
    { rank: 2, symbol: 'NVDA', score: 88, strategy: 'Tech Breakout', signal: 'buy' },
    { rank: 3, symbol: 'GBPUSD', score: 85, strategy: 'Forex Momentum', signal: 'buy' },
    { rank: 4, symbol: 'EURUSD', score: 81, strategy: 'Mean Reversion', signal: 'buy' },
    { rank: 5, symbol: 'USDJPY', score: 78, strategy: 'Forex Momentum', signal: 'buy' },
  ],
};

const TYPE_OPTIONS = ['All', 'CFD', 'Forex', 'Stocks', 'Crypto', 'Indices'];
const STATUS_OPTIONS = ['All', 'Active', 'Draft'];

// ── Stack Card ─────────────────────────────────────────────
function StackCard({ stack }) {
  return (
    <div className="sa-stack-card">
      <div className="sa-stack-header" style={{ borderTopColor: stack.color }}>
        <strong>{stack.strategy}</strong>
        <span className="sa-winrate" style={{ color: stack.color }}>
          {(stack.winRate * 100).toFixed(0)}% WR
        </span>
      </div>
      <div className="sa-stack-symbols">
        {stack.symbols.map((s) => (
          <div key={s.symbol} className={`sa-symbol-row ${s.score > s.prevScore ? 'sa-flash-up' : s.score < s.prevScore ? 'sa-flash-down' : ''}`}>
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
      } catch {}
      return MOCK_ARENA;
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const data = arenaQuery.data || MOCK_ARENA;

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
            <StackCard key={stack.id} stack={stack} />
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
