/**
 * Strategies List — Canonical Strategy Index
 * ===========================================
 * Replaces the scattered strategy list views. Single source of truth
 * for "what strategies exist and what are they doing right now."
 *
 * Data: GET /api/trading/strategies + portfolio cross-reference
 *
 * @created 2026-07-29 — #504 strategy page consolidation
 */

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import ToggleSwitch from '../components/ToggleSwitch';
import './strategies-list.css';

const API = '/api/trading/strategies';

// ── Helpers ──────────────────────────────────────────────

const STATUS_COLORS = {
  active: '#22c55e', enabled: '#3b82f6',
  paused: '#f59e0b', disabled: '#64748b', stopped: '#64748b',
};

function formatPnl(v) {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${Number(v).toFixed(2)}`;
}

export default function StrategiesListPage() {
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState('all'); // all | active | trading | scoring

  // ── Strategies ──
  const { data: strategies = [], isLoading, isError } = useQuery({
    queryKey: ['strategies-list'],
    queryFn: async () => {
      const res = await apiGet(API).catch(() => []);
      return Array.isArray(res) ? res : (res?.strategies || res?.viable || []);
    },
    refetchInterval: 15_000,
  });

  // ── Portfolio cross-ref ──
  const { data: positions = [] } = useQuery({
    queryKey: ['strategies-list-positions'],
    queryFn: () => apiGet('/api/portfolio?source=mt5').catch(() => ({ positions: [] })),
    refetchInterval: 60_000,
  });

  const posBySymbol = useMemo(() => {
    const map = {};
    for (const p of (positions?.positions || positions || [])) {
      const sym = (p.symbol || p.ticker || '').toUpperCase();
      map[sym] = (map[sym] || 0) + 1;
    }
    return map;
  }, [positions]);

  // ── Filter ──
  const filtered = useMemo(() => {
    if (filter === 'all') return strategies;
    if (filter === 'active') return strategies.filter(s => s.active !== false);
    if (filter === 'trading') return strategies.filter(s => s.mode === 'trade' || s.symbol);
    if (filter === 'scoring') return strategies.filter(s => s.mode === 'score' || s.watchlistName);
    return strategies;
  }, [strategies, filter]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return strategies.find(s => s.id === selectedId) || null;
  }, [selectedId, strategies]);

  const handleToggle = async (id) => {
    try {
      const res = await fetch(`${API}/${id}/toggle`, { method: 'POST' });
      if (res.ok) {
        const updated = await res.json();
        // TanStack Query will refetch on next interval
      }
    } catch { /* ok */ }
  };

  // ── Render ─────────────────────────────────────────────

  if (isLoading) return <div className="sl-page"><LoadingSkeleton variant="card" count={3} /></div>;

  return (
    <div className="sl-page">
      <motion.header className="sl-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Strategies</h1>
          <p className="sl-subtitle">
            {strategies.length} strategies — trading, scoring, and monitoring
          </p>
        </div>
        <div className="sl-filter-bar">
          {['all', 'active', 'trading', 'scoring'].map(f => (
            <button
              key={f}
              className={`sl-filter-chip ${filter === f ? 'sl-filter-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </motion.header>

      {isError && <EmptyState icon="⚠️" title="Unable to load strategies" description="Is the NestJS backend running?" />}
      {!isLoading && filtered.length === 0 && (
        <EmptyState icon="🎯" title="No strategies" description="Create one to start trading or scoring." />
      )}

      <div className="sl-grid">
        {filtered.map((s, i) => {
          const isActive = s.active !== false;
          const isTrading = Boolean(s.symbol);
          const isScoring = Boolean(s.watchlistName);
          const typeLabel = isTrading ? 'Trading' : isScoring ? 'Scoring' : 'Strategy';
          const typeColor = isTrading ? '#3b82f6' : isScoring ? '#8b5cf6' : '#94a3b8';
          const posCount = posBySymbol[s.symbol?.toUpperCase()] || 0;

          return (
            <motion.div
              key={s.id}
              className={`sl-card ${selectedId === s.id ? 'sl-card-selected' : ''}`}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => setSelectedId(selectedId === s.id ? null : s.id)}
            >
              <div className="sl-card-top">
                <span className="sl-card-dot" style={{ background: isActive ? STATUS_COLORS.active : STATUS_COLORS.disabled }} />
                <strong className="sl-card-name">{s.name}</strong>
                <span className="sl-card-type" style={{ background: typeColor + '18', color: typeColor, borderColor: typeColor + '33' }}>
                  {typeLabel}
                </span>
              </div>

              <div className="sl-card-meta">
                {s.symbol && <span className="sl-chip">{s.symbol}</span>}
                {s.watchlistName && <span className="sl-chip sl-chip-wl">{s.watchlistName}</span>}
                <span className="sl-chip sl-chip-proto">{s.protocolId || '—'}</span>
                <span className="sl-chip sl-chip-broker">{s.brokerId || '—'}</span>
              </div>

              {s.lastComposite != null && (
                <div className="sl-card-score">
                  <span className="sl-score-label">Last Score</span>
                  <span className="sl-score-value" style={{ color: s.lastComposite >= 60 ? '#22c55e' : s.lastComposite >= 40 ? '#f59e0b' : '#ef4444' }}>
                    {s.lastComposite}
                  </span>
                </div>
              )}

              {posCount > 0 && (
                <div className="sl-card-positions">
                  {posCount} open position{posCount !== 1 ? 's' : ''}
                </div>
              )}

              {s.dataStatus && s.dataStatus !== 'ready' && (
                <div className="sl-card-warning">
                  {s.dataStatus === 'pending_bars' ? '⏳' : '🚫'} {s.dataStatusReason || s.dataStatus}
                </div>
              )}

              {/* Expanded detail */}
              {selectedId === s.id && (
                <div className="sl-card-detail">
                  {s.description && <p className="sl-detail-desc">{s.description}</p>}
                  <div className="sl-detail-grid">
                    <span>Mode: <strong>{s.mode || '—'}</strong></span>
                    <span>Base Size: <strong>{s.baseSize || '—'}</strong></span>
                    <span>SL: <strong>{s.slPct != null ? s.slPct + '%' : '—'}</strong></span>
                    <span>TP: <strong>{s.tpPct != null ? s.tpPct + '%' : '—'}</strong></span>
                    <span>Min Composite: <strong>{s.minComposite || '—'}</strong></span>
                    <span>Timeframe: <strong>{s.timeframe || '—'}</strong></span>
                  </div>
                  <label className="sl-toggle-row" onClick={e => e.stopPropagation()}>
                    <span>Active</span>
                    <ToggleSwitch checked={isActive} onChange={() => handleToggle(s.id)} />
                  </label>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
