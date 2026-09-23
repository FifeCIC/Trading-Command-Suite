/**
 * Protocols Registry — the New design
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
import { getProtocolType, getProtocolTiming } from '../core/protocol-utils';
import { timeAgo, formatDateTime } from '../core/format-utils';
import './protocols-page-b.css';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "in 2d 14h" / "in 3h 12m" / "now" — from an ISO instant. */
function untilLabel(iso) {
  if (!iso) return 'at an unknown time';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 'at an unknown time';
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

/**
 * The instant rendered in the READER's timezone — the whole point of the section.
 * `nextOpen`/`nextClose` are exact instants from the calendar, so this conversion
 * (and DST) is `Intl`'s job, never a hand-rolled offset.
 */
function localTimeLabel(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString([], {
      weekday: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

/** First 8 symbols, then "+N more" — the leverage watchlists reach 79 entries. */
function symbolList(symbols) {
  if (!symbols?.length) return '';
  const head = symbols.slice(0, 8).join(', ');
  return symbols.length > 8 ? `${head} +${symbols.length - 8} more` : head;
}

/**
 * The three run states the registry shows — computed from the SAME inputs for the
 * sidebar dot and the header button, so they can never disagree.
 *
 * `standby` is the honest label for an ENABLED protocol whose market is shut: it
 * cannot be an active part of the loop until the venue reopens, whatever its flag
 * says. Green = genuinely able to act now; orange = enabled, waiting; grey = off.
 */
function protocolRunState(proto, timing, venueStatus) {
  if (!proto?.active) return { key: 'off', title: 'Inactive — not part of the automation loop' };
  const venueGroups = timing.groups.filter(g => g.venue);
  const hasCrypto = timing.groups.some(g => g.alwaysOpen);
  const statuses = venueGroups.map(g => venueStatus[g.venue]);
  if (venueGroups.length > 0 && statuses.some(s => !s) && !hasCrypto) {
    return { key: 'unknown', title: 'Checking market hours…' };
  }
  if (hasCrypto || statuses.some(s => s?.isOpen)) {
    return { key: 'on', title: 'Active — market open; in the automation loop now' };
  }
  if (venueGroups.length === 0) {
    return { key: 'standby', title: 'Active — market hours are not modelled for these instruments' };
  }
  return { key: 'standby', title: `Standby — ${venueGroups.map(g => g.label).join('; ')} closed; cannot act right now` };
}

export default function ProtocolsPageB({ initialProtocolId }) {
  const [selected, setSelected] = useState(null);
  const [styleFilter, setStyleFilter] = useState('All');
  const [directionFilter, setDirectionFilter] = useState('All');
  const [sortOrder, setSortOrder] = useState('active-first');
  const [searchQuery, setSearchQuery] = useState('');
  const [usageFilter, setUsageFilter] = useState('all');
  const [hideInactive, setHideInactive] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [adaptiveBusy, setAdaptiveBusy] = useState(false);
  const [adaptiveError, setAdaptiveError] = useState(null);
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

  // ── Venue status — the calendar's own answer to "is this market open NOW?" ──
  // Fetched once per venue and shared by every row (the sidebar dot needs it for
  // all 45 protocols). The session payload is fetched ALONGSIDE so the "regular
  // window" line prints what the calendar actually holds rather than a copy
  // pasted into the UI. `nextOpen`/`nextClose` are exact instants — the display
  // converts them to the reader's timezone with Intl, never with arithmetic.
  const venueQueries = {
    US: useQuery({
      queryKey: ['venue-status', 'US'],
      queryFn: async () => ({
        status: await apiGet('/api/calendar/market-status?exchange=US'),
        session: await apiGet('/api/calendar/sessions?exchange=US'),
      }),
      staleTime: 30_000,
      refetchInterval: 60_000,
    }),
    FX: useQuery({
      queryKey: ['venue-status', 'FX'],
      queryFn: async () => ({
        status: await apiGet('/api/calendar/market-status?exchange=FX'),
        session: await apiGet('/api/calendar/sessions?exchange=FX'),
      }),
      staleTime: 30_000,
      refetchInterval: 60_000,
    }),
  };
  const venueStatus = {
    US: venueQueries.US.data?.status ?? null,
    FX: venueQueries.FX.data?.status ?? null,
  };
  const venueSessionFor = (venue) => venueQueries[venue]?.data?.session ?? null;

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
  const selectedTiming = getProtocolTiming(selectedProto?.resolvedSymbols);
  const selectedRun = selectedProto ? protocolRunState(selectedProto, selectedTiming, venueStatus) : null;

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

  // ── Adaptive Target (2026-09-10) — OFF by default ──
  // The server owns the decision (it refuses to enable below the sample floor), so this
  // query is the source of truth for both the button state and the explanation copy.
  const adaptiveTargetQuery = useQuery({
    queryKey: ['adaptive-target', selectedProto?.id],
    queryFn: () => apiGet(`/api/scoring/protocols/${selectedProto?.id}/adaptive-target`),
    enabled: !!selectedProto?.id,
    staleTime: 10_000,
  });
  const adaptiveTarget = adaptiveTargetQuery.data;

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

  /**
   * Toggle the Adaptive Target for the selected protocol (2026-09-10).
   *
   * OFF by default, and deliberately not optimistic: the server REFUSES to enable it when
   * the protocol has too few observations, and the operator needs to see that reason rather
   * than a button that flips and silently does nothing.
   */
  async function handleAdaptiveToggle() {
    if (!selectedProto || adaptiveBusy) return;
    const next = !(adaptiveTarget?.enabled);
    setAdaptiveBusy(true);
    setAdaptiveError(null);
    try {
      const res = await fetch(
        `/api/scoring/protocols/${encodeURIComponent(selectedProto.id)}/adaptive-target`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setAdaptiveError(body?.message || `Could not change Adaptive Target (${res.status}).`);
      } else {
        queryClient.setQueryData(['adaptive-target', selectedProto.id], body);
      }
    } catch (err) {
      setAdaptiveError(err?.message || 'Could not reach the API.');
    }
    setAdaptiveBusy(false);
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
          {filteredProtocols.map(p => {
            const issues = issuesByProtocol.get(p.id) || [];
            const timing = getProtocolTiming(p.resolvedSymbols);
            const run = protocolRunState(p, timing, venueStatus);
            const allSymbols = timing.groups.flatMap(g => g.symbols);
            const extra = Math.max(0, allSymbols.length - 1);
            return (
            <div
              key={p.id}
              className={`prb-item ${selectedProto?.id === p.id ? 'prb-selected' : ''}`}
              onClick={() => { setSelected(p); setAdaptiveError(null); }}
            >
              {/* The dot is position-absolute (top-right) so a long name can never
                  push it around; the chips sit in their own bottom-right corner so
                  the title row reads as ONE line of text. */}
              <div className="prb-item-name">{p.name}</div>
              <span className={`prb-active-dot ${run.key}`} title={run.title} aria-hidden="true" />
              {(extra > 0 || issues.length > 0) && (
                <div className="prb-item-corner">
                  {extra > 0 && (
                    <span className="prb-sym-chip" title={`All resolved symbols: ${allSymbols.join(', ')}`}>+{extra}</span>
                  )}
                  {issues.length > 0 && (
                    <span className="prb-health-chip" title={issues.map(i => i.message).join('\n')}>
                      ⚠ {issues.length}
                    </span>
                  )}
                </div>
              )}
              <div className="prb-item-meta">
                <span className="prb-item-style" style={{ color: getProtocolType(p).color }}>{p.tradingStyle || '—'}</span>
                <span>{p.directiveCount} directives</span>
              </div>
            </div>
            );
          })}
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
                <div className="prb-head-actions">
                  {/* The label states what the protocol IS DOING, not just the flag: an
                      enabled protocol whose market is closed cannot act, and calling that
                      "Active" invited exactly the misreading this registry now removes.
                      The sidebar dot uses the same three states. */}
                  <button
                    className={`prb-status-btn ${selectedRun?.key === 'off' ? 'inactive' : selectedRun?.key === 'standby' ? 'standby' : 'active'}`}
                    onClick={handleToggle}
                    disabled={toggling}
                    title={`${selectedRun?.title || ''} — click to ${selectedProto.active ? 'disable' : 'enable'} this protocol`}
                  >
                    {toggling ? '…' : selectedRun?.key === 'off' ? 'Inactive' : selectedRun?.key === 'standby' ? 'Standby' : 'Active'}
                  </button>
                  {/* Adaptive Target toggle (2026-09-10) — off by default, and visually
                      distinct from Active/Inactive so the two are never confused: this
                      changes the SCALE a score is measured against, not whether the
                      protocol runs. "On" is amber, not green, because enabling it is a
                      deliberate departure from the configured-capacity baseline. */}
                  <button
                    className={`prb-status-btn prb-target-btn ${
                      adaptiveTarget?.enabled ? 'target-on' : 'target-off'
                    }`}
                    onClick={handleAdaptiveToggle}
                    disabled={adaptiveBusy || adaptiveTargetQuery.isLoading}
                    title={
                      adaptiveTarget
                        ? `${adaptiveTarget.reasonText}${
                            adaptiveTarget.enabled
                              ? ''
                              : ` Enabling measures scores against this protocol's own observed peak instead of its full configured capacity, which raises every percentage for it.`
                          }`
                        : 'Loading Adaptive Target state…'
                    }
                  >
                    {adaptiveBusy
                      ? '…'
                      : adaptiveTarget?.enabled
                        ? 'Target: On'
                        : 'Target: Off'}
                  </button>
                </div>
              </div>

              {/* Adaptive Target detail — shown whenever it's ON, and whenever the
                  operator tried to enable it and was refused. The point is that a reader
                  can always tell WHICH scale the protocol's scores are on. */}
              {(adaptiveTarget?.enabled || adaptiveError) && (
                <div className={`prb-target-note ${adaptiveError ? 'prb-target-note--error' : ''}`}>
                  {adaptiveError ? (
                    <p>🚫 {adaptiveError}</p>
                  ) : (
                    <>
                      <p>
                        <strong>Adaptive Target is on.</strong> Percentages divide by this
                        protocol&apos;s observed peak ({Math.round(adaptiveTarget.adaptiveMax ?? adaptiveTarget.peak ?? 0)})
                        rather than its configured capacity ({Math.round(adaptiveTarget.configuredMax ?? 0)}).
                        The peak only ever rises — it is never lowered by a quiet period.
                      </p>
                      <p className="prb-target-sub">
                        Based on {adaptiveTarget.samples} reading
                        {adaptiveTarget.samples === 1 ? '' : 's'}
                        {adaptiveTarget.since
                          ? `, peak set ${new Date(adaptiveTarget.since).toLocaleDateString()}`
                          : ''}
                        . {adaptiveTarget.reasonText}
                      </p>
                    </>
                  )}
                </div>
              )}

              <p className="prb-description">{selectedProto.description}</p>

              {/* ── Market & hours — WHICH market this protocol acts in, WHEN it can
                  act (rendered in the reader's own timezone), and how long until the
                  next change. `nextOpen`/`nextClose` are exact instants from the
                  calendar, so DST is the calendar's problem and never this UI's. ── */}
              {selectedTiming.groups.length > 0 && (
                <div className="prb-market">
                  <h3>Market &amp; hours</h3>
                  {selectedTiming.groups.map(g => {
                    const st = g.venue ? venueStatus[g.venue] : null;
                    const sess = g.venue ? venueSessionFor(g.venue) : null;
                    const stateText = g.alwaysOpen
                      ? 'Always open'
                      : !g.venue
                        ? 'Hours unmodelled'
                        : !st
                          ? 'Checking…'
                          : st.isOpen
                            ? 'Open now'
                            : `Closed${st.holidayName ? ` — ${st.holidayName}` : ''}`;
                    const stateKey = g.alwaysOpen ? 'open' : !g.venue ? 'unmodelled' : !st ? 'checking' : st.isOpen ? 'open' : 'closed';
                    const windowText = g.alwaysOpen
                      ? 'Trades continuously — no open or close to wait for.'
                      : !g.venue
                        ? ''
                        : sess?.weekly
                          ? `Weekly: ${DAY_SHORT[sess.weekly.openDay]} ${sess.weekly.openTime} → ${DAY_SHORT[sess.weekly.closeDay]} ${sess.weekly.closeTime} (${sess.timezone})`
                          : sess
                            ? `Session: ${sess.regularOpen}–${sess.regularClose} (${sess.timezone})`
                            : '';
                    const timingText = g.alwaysOpen
                      ? ''
                      : !g.venue
                        ? 'The gate falls back to data freshness for these instruments.'
                        : !st
                          ? 'Checking market hours…'
                          : st.isOpen
                            ? `Closes ${localTimeLabel(st.nextClose)} — ${untilLabel(st.nextClose)}.`
                            : `Opens ${localTimeLabel(st.nextOpen)} — ${untilLabel(st.nextOpen)}.`;
                    return (
                      <div key={g.key} className="prb-market-row">
                        <div className="prb-market-head">
                          <span className="prb-market-label">{g.label}</span>
                          <span className={`prb-market-state ${stateKey}`}>{stateText}</span>
                        </div>
                        <div className="prb-market-syms" title={g.symbols.join(', ')}>{symbolList(g.symbols)}</div>
                        {(windowText || timingText) && (
                          <div className="prb-market-times">
                            {windowText && <span>{windowText}</span>}
                            {timingText && <span>{timingText}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

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
