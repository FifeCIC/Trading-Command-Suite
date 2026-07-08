import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './directives-status.css';

const CATEGORY_COLORS = {
  'Technical Analysis':       { color: '#3b82f6', bg: '#3b82f618' },
  'Market Context':           { color: '#8b5cf6', bg: '#8b5cf618' },
  'Sentiment & Fundamentals': { color: '#f59e0b', bg: '#f59e0b18' },
  'Risk & Structural':        { color: '#ef4444', bg: '#ef444418' },
  'Exit Signals':             { color: '#ec4899', bg: '#ec489918' },
  'Strategy Composites':      { color: '#10b981', bg: '#10b98118' },
  'Other':                    { color: '#64748b', bg: '#64748b18' },
};

const COMPLEXITY_COLORS = {
  'Basic':    '#94a3b8',
  'Simple':   '#22c55e',
  'Moderate': '#3b82f6',
  'Complex':  '#f59e0b',
  'Advanced': '#ef4444',
  'Expert':   '#8b5cf6',
};

function ProgressBar({ pct }) {
  return (
    <div className="ds-progress-wrap">
      <div className="ds-progress-track">
        <div
          className="ds-progress-fill"
          style={{ width: `${pct}%`, background: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444' }}
        />
      </div>
      <span className="ds-progress-pct">{pct}%</span>
    </div>
  );
}

function CategoryBadge({ category }) {
  const c = CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;
  return (
    <span className="ds-cat-badge" style={{ color: c.color, background: c.bg }}>
      {category}
    </span>
  );
}

function DirectiveRow({ d, stats, isEven, index }) {
  const st = stats?.get(d.id);
  const cxColor = COMPLEXITY_COLORS[d.complexity?.label] || '#94a3b8';

  return (
    <motion.tr
      className={`ds-row ${isEven ? 'ds-row--even' : ''}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.01, 0.3) }}
    >
      <td className="ds-cell ds-cell--name">
        <span className="ds-name">{d.name}</span>
        <span className="ds-id">{d.id}</span>
      </td>
      <td className="ds-cell"><CategoryBadge category={d.category} /></td>
      <td className="ds-cell">
        <span className={`ds-status-pill ${d.active ? 'ds-active' : 'ds-inactive'}`}>
          {d.active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="ds-cell" style={{ color: cxColor }}>
        <span className="ds-complexity" style={{ borderColor: cxColor }}>
          {d.complexity?.label || 'Basic'}
        </span>
      </td>
      <td className="ds-cell ds-cell--num">{d.priority ?? 50}</td>
      <td className="ds-cell ds-cell--num">{d.protocolCount ?? 0}</td>
      <td className="ds-cell ds-cell--num">
        {st?.avgScore != null ? (
          <span style={{ color: st.avgScore > 60 ? '#22c55e' : st.avgScore < 40 ? '#ef4444' : 'var(--ink)' }}>
            {st.avgScore}
          </span>
        ) : '—'}
      </td>
      <td className="ds-cell ds-cell--num">{st?.count ?? '—'}</td>
      <td className="ds-cell">
        {st?.directionalBias && st.directionalBias !== 'no-data' ? (
          <span className={`ds-bias ds-bias--${st.directionalBias}`}>
            {st.directionalBias} {st.biasPct}%
          </span>
        ) : '—'}
      </td>
    </motion.tr>
  );
}

export default function DirectivesStatusPage() {
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('priority');
  const [sortDir, setSortDir] = useState('desc');
  const [showInactiveOnly, setShowInactiveOnly] = useState(false);

  const { data: dirData, isLoading: dirLoading, error: dirError } = useQuery({
    queryKey: ['directives-list'],
    queryFn: () => apiGet('/api/directives'),
    refetchInterval: 60_000,
  });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['directives-stats'],
    queryFn: () => apiGet('/api/directives/stats'),
    refetchInterval: 60_000,
  });

  const statsMap = useMemo(() => {
    if (!statsData?.stats) return null;
    const m = new Map();
    for (const s of statsData.stats) m.set(s.id, s);
    return m;
  }, [statsData]);

  const categories = useMemo(() => {
    if (!dirData) return ['All'];
    const cats = new Set(dirData.map(d => d.category).filter(Boolean));
    return ['All', ...[...cats].sort()];
  }, [dirData]);

  const filtered = useMemo(() => {
    if (!dirData) return [];
    let list = [...dirData];
    if (categoryFilter !== 'All') list = list.filter(d => d.category === categoryFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(d => d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q));
    }
    if (showInactiveOnly) list = list.filter(d => !d.active);

    list.sort((a, b) => {
      let va, vb;
      switch (sortKey) {
        case 'name': va = a.name; vb = b.name; break;
        case 'category': va = a.category; vb = b.category; break;
        case 'complexity': va = a.complexity?.level ?? 1; vb = b.complexity?.level ?? 1; break;
        case 'priority': va = a.priority ?? 50; vb = b.priority ?? 50; break;
        case 'protocols': va = a.protocolCount ?? 0; vb = b.protocolCount ?? 0; break;
        case 'avgScore': {
          const sa = statsMap?.get(a.id); const sb = statsMap?.get(b.id);
          va = sa?.avgScore ?? -1; vb = sb?.avgScore ?? -1;
          break;
        }
        case 'count': {
          const sa = statsMap?.get(a.id); const sb = statsMap?.get(b.id);
          va = sa?.count ?? 0; vb = sb?.count ?? 0;
          break;
        }
        default: va = a.priority ?? 50; vb = b.priority ?? 50;
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? (va - vb) : (vb - va);
    });
    return list;
  }, [dirData, categoryFilter, search, showInactiveOnly, sortKey, sortDir, statsMap]);

  const totals = useMemo(() => {
    if (!dirData) return { total: 0, active: 0, inactive: 0 };
    const active = dirData.filter(d => d.active).length;
    return { total: dirData.length, active, inactive: dirData.length - active };
  }, [dirData]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortArrow = ({ col }) => {
    if (sortKey !== col) return <span className="ds-sort-arrow">↕</span>;
    return <span className="ds-sort-arrow ds-sort-active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  if (dirLoading || statsLoading) return <LoadingSkeleton lines={10} />;
  if (dirError) return <ApiOfflineBanner error={dirError} />;
  if (!dirData || dirData.length === 0) {
    return (
      <main className="directives-status-page">
        <h1>Directive Status</h1>
        <EmptyState
          icon="📋"
          title="No Directives Registered"
          description="The NestJS directive registry is empty. Ensure the backend is running."
        />
      </main>
    );
  }

  const activePct = totals.total > 0 ? Math.round((totals.active / totals.total) * 100) : 0;
  const catCounts = {};
  for (const d of dirData) {
    const cat = d.category || 'Other';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }

  return (
    <div className="ds-page">
      <header className="ds-header">
        <h1 className="ds-title">📋 Directive Development Status</h1>
        <p className="ds-subtitle">
          {totals.active} of {totals.total} directives active · {categories.length - 1} categories
        </p>
      </header>

      {/* ── Stat Pills ── */}
      <div className="ds-stat-row">
        <div className="ds-stat-pill">
          <span className="ds-stat-num">{totals.total}</span>
          <span className="ds-stat-lbl">Total</span>
        </div>
        <div className="ds-stat-pill ds-stat-pill--active">
          <span className="ds-stat-num">{totals.active}</span>
          <span className="ds-stat-lbl">Active</span>
        </div>
        <div className="ds-stat-pill ds-stat-pill--inactive">
          <span className="ds-stat-num">{totals.inactive}</span>
          <span className="ds-stat-lbl">Inactive</span>
        </div>
      </div>

      {/* ── Implementation Progress ── */}
      <div className="ds-progress-section">
        <div className="ds-progress-header">
          <span className="ds-progress-title">Implementation Progress</span>
          <span className="ds-progress-pct-badge">{activePct}%</span>
        </div>
        <ProgressBar pct={activePct} />
        <div className="ds-category-cloud">
          {Object.entries(catCounts).map(([cat, n]) => (
            <span key={cat} className="ds-cat-tag" style={{ color: CATEGORY_COLORS[cat]?.color || '#64748b', borderColor: CATEGORY_COLORS[cat]?.color || '#64748b' }}>
              {cat} <strong>{n}</strong>
            </span>
          ))}
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="ds-toolbar">
        <div className="ds-cat-filters">
          {categories.map(cat => (
            <button
              key={cat}
              className={`ds-cat-btn ${categoryFilter === cat ? 'ds-cat-btn--active' : ''}`}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="ds-toolbar-right">
          <label className="ds-toggle">
            <input type="checkbox" checked={showInactiveOnly} onChange={e => setShowInactiveOnly(e.target.checked)} />
            <span>Inactive only</span>
          </label>
          <input
            className="ds-search"
            type="text"
            placeholder="Search directives…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="ds-table-wrap">
        <table className="ds-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('name')}><SortArrow col="name" /> Directive</th>
              <th onClick={() => handleSort('category')}><SortArrow col="category" /> Category</th>
              <th>Status</th>
              <th onClick={() => handleSort('complexity')}><SortArrow col="complexity" /> Complexity</th>
              <th onClick={() => handleSort('priority')}><SortArrow col="priority" /> Priority</th>
              <th onClick={() => handleSort('protocols')}><SortArrow col="protocols" /> Protocols</th>
              <th onClick={() => handleSort('avgScore')}><SortArrow col="avgScore" /> Avg Score</th>
              <th onClick={() => handleSort('count')}><SortArrow col="count" /> Runs</th>
              <th>Bias</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="ds-empty">No directives match filters.</td></tr>
            ) : (
              filtered.map((d, i) => (
                <DirectiveRow key={d.id} d={d} stats={statsMap} isEven={i % 2 === 0} index={i} />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="ds-footer">
        Showing {filtered.length} of {totals.total} directives
      </div>
    </div>
  );
}
