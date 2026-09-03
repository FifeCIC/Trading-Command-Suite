/**
 * Protocols Registry — Page B (A/B variant)
 * ===========================================
 * Theme-synced redesign of ProtocolsPage. Changes vs Page A:
 * - Dropdown menu filter instead of chip buttons
 * - PageInfoPopover in header
 * - Prominent toggle button in header area
 * - Uses CSS variables from theme lab (--panel, --line, --ink, --accent)
 *
 * A/B toggle via ?variant=B in URL. Page A is ProtocolsPage.jsx.
 */
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiDelete } from '../core/api/client';
import PageInfoPopover from '../components/PageInfoPopover';
import { getProtocolType } from '../core/protocol-utils';
import { timeAgo, formatDateTime } from '../core/format-utils';
import './protocols-page-b.css';

export default function ProtocolsPageB({ initialProtocolId }) {
  const [selected, setSelected] = useState(null);
  const [styleFilter, setStyleFilter] = useState('All');
  const [directionFilter, setDirectionFilter] = useState('All');
  const [sortOrder, setSortOrder] = useState('active-first');
  const [searchQuery, setSearchQuery] = useState('');
  const [usageFilter, setUsageFilter] = useState('all');
  const [hideInactive, setHideInactive] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [editingDirective, setEditingDirective] = useState(null);
  const [editValue, setEditValue] = useState('');
  const queryClient = useQueryClient();

  const protocolsQuery = useQuery({
    queryKey: ['protocols-b'],
    queryFn: () => apiGet('/api/scoring/gated/protocols'),
    staleTime: 30_000,
  });

  // Config health (#716 follow-up) — static validation of group/directive wiring.
  const healthQuery = useQuery({
    queryKey: ['protocols-health'],
    queryFn: () => apiGet('/api/scoring/gated/protocols/health').catch(() => ({ issues: [] })),
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
  const healthIssues = healthQuery.data?.issues || [];
  const issuesByProtocol = useMemo(() => {
    const m = new Map();
    for (const i of healthIssues) {
      if (!m.has(i.protocolId)) m.set(i.protocolId, []);
      m.get(i.protocolId).push(i);
    }
    return m;
  }, [healthIssues]);

  const protocols = useMemo(() => {
    const raw = Array.isArray(protocolsQuery.data?.protocols) ? protocolsQuery.data.protocols : [];
    const seen = new Set();
    return raw.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  }, [protocolsQuery.data]);

  useEffect(() => {
    if (protocols.length > 0 && !selected) {
      const target = initialProtocolId ? protocols.find(p => p.id === initialProtocolId) : null;
      if (target) { setSelected(target); return; }
      // Default to the first protocol in the sidebar list (active-first order),
      // not the raw API order — the raw array can lead with an inactive protocol
      // (e.g. btc-speed-v1) that isn't at the top of the registry sidebar.
      const firstVisible = [...protocols]
        .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0))[0];
      setSelected(firstVisible || protocols[0]);
    }
  }, [protocols, selected, initialProtocolId]);

  const selectedProto = protocols.find(p => p.id === selected?.id) || protocols[0];
  const selectedIssues = issuesByProtocol.get(selectedProto?.id) || [];

  // ── Latest score for selected protocol ──
  const latestScoreQuery = useQuery({
    queryKey: ['protocol-latest-score', selectedProto?.id],
    queryFn: () => apiGet(`/api/scoring/protocols/${selectedProto?.id}/latest-score`),
    enabled: !!selectedProto?.id,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const latestScore = latestScoreQuery.data;

  // ── Per-protocol directive weights (#609) ──
  const directiveConfigQuery = useQuery({
    queryKey: ['protocol-directive-config', selectedProto?.id],
    queryFn: () => apiGet(`/api/scoring/protocols/${selectedProto?.id}/directive-config`),
    enabled: !!selectedProto?.id,
    staleTime: 10_000,
  });
  const directiveConfig = directiveConfigQuery.data;

  async function handleSaveOverride(directiveId, maxScore) {
    if (!selectedProto || !Number.isFinite(maxScore)) return;
    try {
      await apiPatch(`/api/scoring/protocols/${selectedProto.id}/directive-config`, {
        directiveId,
        config: { maxScore },
      });
      setEditingDirective(null);
      queryClient.invalidateQueries({ queryKey: ['protocol-directive-config', selectedProto.id] });
    } catch (err) {
      console.error('Failed to save directive override', err);
    }
  }

  async function handleResetOverride(directiveId) {
    if (!selectedProto) return;
    try {
      await apiDelete(`/api/scoring/protocols/${selectedProto.id}/directive-config/${directiveId}`);
      queryClient.invalidateQueries({ queryKey: ['protocol-directive-config', selectedProto.id] });
    } catch (err) {
      console.error('Failed to reset directive override', err);
    }
  }

  const styles = ['All', ...new Set(protocols.map(p => p.tradingStyle).filter(Boolean))];
  const filteredProtocols = useMemo(() => {
    let list = styleFilter === 'All' ? [...protocols] : protocols.filter(p => p.tradingStyle === styleFilter);
    // Direction filter — SHORT_ONLY protocols on one side, everything that can
    // emit BUY (LONG_ONLY + BOTH) on the other.
    if (directionFilter === 'Short') {
      list = list.filter(p => (p.directionMode || 'LONG_ONLY') === 'SHORT_ONLY');
    } else if (directionFilter === 'Long') {
      list = list.filter(p => (p.directionMode || 'LONG_ONLY') !== 'SHORT_ONLY');
    }
    // Search filter — match against name and id
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.id || '').toLowerCase().includes(q)
      );
    }
    // Usage filter — in use by trading strategies or not
    if (usageFilter === 'in-use') {
      list = list.filter(p => (p.connectionCount ?? 0) > 0);
    } else if (usageFilter === 'unused') {
      list = list.filter(p => (p.connectionCount ?? 0) === 0);
    }
    // Hide inactive
    if (hideInactive) list = list.filter(p => p.active !== false);
    // Sort
    if (sortOrder === 'active-first') {
      list.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
    } else if (sortOrder === 'inactive-first') {
      list.sort((a, b) => (a.active ? 1 : 0) - (b.active ? 1 : 0));
    } else if (sortOrder === 'az') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortOrder === 'za') {
      list.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    }
    return list;
  }, [protocols, styleFilter, directionFilter, sortOrder, searchQuery, usageFilter, hideInactive]);

  async function handleToggle() {
    if (!selectedProto) return;
    setToggling(true);
    const newActive = !selectedProto.active;
    // Optimistic update for instant UI feedback — update both selected and list
    setSelected(prev => ({ ...prev, active: newActive }));
    queryClient.setQueryData(['protocols-b'], (old) => {
      if (!old?.protocols) return old;
      return {
        ...old,
        protocols: old.protocols.map((p) =>
          p.id === selectedProto.id ? { ...p, active: newActive } : p
        ),
      };
    });
    try {
      const res = await fetch(`/api/scoring/gated/protocols/${selectedProto.id}/toggle`, { method: 'PATCH' });
      if (!res.ok) {
        // Revert on failure — both selected and list
        setSelected(prev => ({ ...prev, active: !newActive }));
        queryClient.invalidateQueries({ queryKey: ['protocols-b'] });
      }
    } catch {
      setSelected(prev => ({ ...prev, active: !newActive }));
      queryClient.invalidateQueries({ queryKey: ['protocols-b'] });
    }
    setToggling(false);
  }

  if (protocolsQuery.isLoading) {
    return <div className="prb-page"><div className="prb-loading">Loading protocols…</div></div>;
  }

  return (
    <div className="prb-page">
      {/* Header with A/B switcher */}
      <header className="prb-header">
        <div className="prb-header-left">
          <h1>Protocols Registry
            <PageInfoPopover>
              Complete registry of all scoring protocols. Enable/disable, view configuration, and see META.Stack connections. Page B — redesigned variant with theme-synced styling.
            </PageInfoPopover>
          </h1>
        </div>
      </header>

      {/* Toolbar: search + style filter + sort */}
      <div className="prb-toolbar">
        <input
          className="prb-search"
          type="text"
          placeholder="Search protocols…"
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setSelected(null); }}
        />
        <label className="prb-filter-label">
          Style:
          <select className="prb-filter-select" value={styleFilter} onChange={e => setStyleFilter(e.target.value)}>
            {styles.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="prb-filter-label">
          Direction:
          <select className="prb-filter-select" value={directionFilter} onChange={e => setDirectionFilter(e.target.value)}>
            <option value="All">All</option>
            <option value="Long">Long</option>
            <option value="Short">Short</option>
          </select>
        </label>
        <label className="prb-filter-label">
          Order:
          <select className="prb-filter-select" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
            <option value="active-first">Active first</option>
            <option value="inactive-first">Inactive first</option>
            <option value="az">A → Z</option>
            <option value="za">Z → A</option>
          </select>
        </label>
        <label className="prb-filter-label">
          Stacked:
          <select className="prb-filter-select" value={usageFilter} onChange={e => setUsageFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="in-use">Yes</option>
            <option value="unused">No</option>
          </select>
        </label>
        <label className="prb-filter-label">
          <input type="checkbox" checked={hideInactive} onChange={e => setHideInactive(e.target.checked)} />
          <span>Hide inactive</span>
        </label>
        <span className="prb-count">{filteredProtocols.length} of {protocols.length}</span>
      </div>

      <div className="prb-layout">
        {/* Sidebar list */}
        <div className="prb-sidebar">
          {filteredProtocols.map(p => (
            <div
              key={p.id}
              className={`prb-item ${selectedProto?.id === p.id ? 'prb-selected' : ''}`}
              onClick={() => setSelected(p)}
            >
              <div className="prb-item-name">
                {p.name}
                <span className={`prb-active-dot ${p.active ? 'on' : 'off'}`} title={p.active ? 'Protocol enabled' : 'Protocol disabled'} />
                {(issuesByProtocol.get(p.id) || []).length > 0 && (
                  <span
                    className="prb-health-chip"
                    title={(issuesByProtocol.get(p.id) || []).map(i => i.message).join('\n')}
                  >
                    ⚠ {(issuesByProtocol.get(p.id) || []).length}
                  </span>
                )}
              </div>
              <div className="prb-item-meta">
                <span className="prb-item-style" style={{ color: getProtocolType(p).color }}>{p.tradingStyle || '—'}</span>
                <span>{p.directiveCount} directives</span>
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div className="prb-detail">
          {selectedProto && (
            <>
              <div className="prb-detail-head">
                <div className="prb-detail-title">
                  <h2>{selectedProto.name}</h2>
                  <code className="prb-detail-id">{selectedProto.id}</code>
                </div>
                <button
                  className={`prb-status-btn ${selectedProto.active ? 'active' : 'inactive'}`}
                  onClick={handleToggle}
                  disabled={toggling}
                  title={`Click to ${selectedProto.active ? 'disable' : 'enable'} this protocol`}
                >
                  {toggling ? '…' : selectedProto.active ? 'Active' : 'Inactive'}
                </button>
              </div>

              <p className="prb-description">{selectedProto.description}</p>

              {/* Config health (#716 follow-up) — why a protocol may score oddly */}
              {selectedIssues.length > 0 && (
                <div className="prb-health">
                  <h3>Config issues</h3>
                  {selectedIssues.map((i, idx) => (
                    <p key={idx} className={`prb-health-line prb-health-${i.severity}`}>
                      {i.severity === 'error' ? '🚫' : '⚠'} {i.message}
                    </p>
                  ))}
                </div>
              )}

              {/* Theory (#689) — written intent, distinct from description */}
              {selectedProto.theory && (
                <div className="prb-theory">
                  <h3>Theory</h3>
                  <p className="prb-theory-text">{selectedProto.theory}</p>
                </div>
              )}

              {/* Stats */}
              <div className="prb-stats">
                {selectedProto.tradingStyle && <div className="prb-stat"><span className="prb-stat-val">{selectedProto.tradingStyle}</span><span className="prb-stat-lbl">Style</span></div>}
                <div className="prb-stat"><span className="prb-stat-val">{selectedProto.directionMode || 'LONG'}</span><span className="prb-stat-lbl">Direction</span></div>
                {selectedProto.recommendedTimeframe && <div className="prb-stat"><span className="prb-stat-val">{selectedProto.recommendedTimeframe}</span><span className="prb-stat-lbl">Timeframe</span></div>}
                <div className="prb-stat"><span className="prb-stat-val">{selectedProto.directiveCount}</span><span className="prb-stat-lbl">Directives</span></div>
                <div className="prb-stat"><span className="prb-stat-val">{directiveConfig?.totalWeight != null ? directiveConfig.totalWeight.toLocaleString() : (selectedProto.maxScore?.toLocaleString() ?? 'N/A')}</span><span className="prb-stat-lbl">Total Weight</span></div>
              </div>

              {/* Directive Weights (per-protocol config — #609) */}
              <div className="prb-weights">
                <h3>Directive Weights</h3>
                {directiveConfigQuery.isLoading ? (
                  <span className="prb-recent-loading">Loading…</span>
                ) : directiveConfig?.directives?.length ? (
                  <div className="prb-weights-list">
                    {directiveConfig.directives.map(d => (
                      <div key={d.id} className="prb-weight-row">
                        <span className="prb-weight-name" title={d.id}>{d.name || d.id}</span>
                        {editingDirective === d.id ? (
                          <div className="prb-weight-editor">
                            <input
                              className="prb-weight-input"
                              type="number"
                              min="0"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              autoFocus
                            />
                            <button
                              className="prb-weight-btn save"
                              disabled={!editValue || isNaN(parseInt(editValue, 10))}
                              onClick={() => handleSaveOverride(d.id, parseInt(editValue, 10))}
                            >Save</button>
                            <button className="prb-weight-btn" onClick={() => setEditingDirective(null)}>Cancel</button>
                          </div>
                        ) : (
                          <>
                            <span className="prb-weight-value">
                              <b>{d.effectiveMaxScore}</b>
                              <em className={`prb-weight-badge ${d.source}`}>{d.source}</em>
                            </span>
                            <span className="prb-weight-actions">
                              <button
                                className="prb-weight-btn"
                                onClick={() => { setEditingDirective(d.id); setEditValue(String(d.effectiveMaxScore)); }}
                              >Edit</button>
                              {d.source === 'override' && (
                                <button className="prb-weight-btn" onClick={() => handleResetOverride(d.id)}>Reset</button>
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                    <div className="prb-weights-total">
                      <span>Total Weight</span>
                      <b>{directiveConfig.totalWeight?.toLocaleString() ?? 0}</b>
                    </div>
                  </div>
                ) : (
                  <span className="prb-recent-none">No directives</span>
                )}
              </div>

              {/* Recent Scoring */}
              <div className="prb-recent-score">
                <h3>Most Recent Scores</h3>
                {latestScoreQuery.isLoading ? (
                  <span className="prb-recent-loading">Loading…</span>
                ) : latestScore ? (
                  <div className="prb-recent-body">
                    <div className="prb-recent-rows">
                      <div className="prb-recent-row">
                        <span className="prb-recent-label" title="Directional conviction — which way and how strongly, right now. Drives the BUY/HOLD/SELL signal.">Signal</span>
                        <span className="prb-recent-value">
                          <span className="prb-recent-num">{latestScore.value?.toFixed(0) ?? '—'}</span>
                          <span className="prb-recent-max">/ {latestScore.maxScore ?? selectedProto.maxScore ?? 100}</span>
                        </span>
                      </div>
                      <div className="prb-recent-row">
                        <span className="prb-recent-label" title="Additive 'everything counts' score — direction + conditions + forecasts. Used to rank attractiveness across symbols.">Opportunity</span>
                        <span className="prb-recent-value">
                          <span className="prb-recent-num prb-recent-num-opp">{latestScore.opportunityScore?.toFixed(0) ?? '—'}</span>
                          <span className="prb-recent-max">/ {latestScore.opportunityMax ?? selectedProto.maxScore ?? 100}</span>
                        </span>
                      </div>
                    </div>
                    <div className="prb-recent-meta">
                      <span className="prb-recent-symbol">{latestScore.symbolTicker}</span>
                      <span className="prb-recent-time" title={formatDateTime(latestScore.timestamp)}>{timeAgo(latestScore.timestamp)}</span>
                    </div>
                  </div>
                ) : (
                  <span className="prb-recent-none">No scores yet — run a scoring cycle</span>
                )}
              </div>

              {/* Connections */}
              <div className="prb-connections">
                <h3>META.Stack Connections</h3>
                <div className="prb-conn-row">
                  <span className="prb-conn-label">Watchlists</span>
                  <span className="prb-conn-val">
                    {selectedProto.linkedWatchlists?.length > 0
                      ? selectedProto.linkedWatchlists.map((w, i) => <span key={i} className="prb-conn-chip">👁 {w}</span>)
                      : selectedProto.linkedStrategies?.length > 0
                        ? <span className="prb-conn-none">None linked</span>
                        : <span className="prb-conn-na">Not required — protocol is self-scoped</span>}
                  </span>
                </div>
                <div className="prb-conn-row">
                  <span className="prb-conn-label">Strategies</span>
                  <span className="prb-conn-val">
                    {selectedProto.linkedStrategies?.length > 0
                      ? selectedProto.linkedStrategies.map((s, i) => <span key={i} className="prb-conn-chip">{s.trading ? '⚡' : '📋'} {s.name}</span>)
                      : <span className="prb-conn-none">None linked</span>}
                  </span>
                </div>
              </div>

              {/* Directive Groups */}
              {selectedProto.groups?.length > 0 && (
                <div className="prb-groups">
                  <h3>Directive Groups</h3>
                  {selectedProto.groups.map(g => (
                    <div key={g.id} className="prb-group">
                      <div className="prb-group-head">
                        <span className="prb-group-name">{g.name}</span>
                        <span className="prb-group-meta">Weight: {g.weight}{g.isRiskGate ? ' · Risk Gate' : ''}</span>
                      </div>
                      <div className="prb-group-dirs">
                        {g.directives?.map(d => (
                          <span key={d.id} className="prb-dir-chip">{d.name || d.id}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
