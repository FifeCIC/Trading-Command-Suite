/**
 * Create Protocols Page — DB-driven Protocol Builder
 * ====================================================
 * Build scoring protocols that persist to the Protocol DB model.
 * Each protocol has directive groups (Technical, Sentiment, Risk) with
 * configurable weights, risk gate settings, and directive selections.
 *
 * POST /api/scoring/protocols — creates/updates a protocol with its groups.
 */

import { useState, useEffect, useMemo } from 'react';
import { apiGet, apiPost } from '../core/api/client';
import '../core/forms.css';
import './create-protocols.css';
import PageInfoPopover from '../components/PageInfoPopover';
import NoticeBlock from '../components/NoticeBlock';
// `notice()` comes from the registry and `noticeFromError()` from the adapter — the adapter does not
// re-export it. (Passing an object literal to noticeFromError would fabricate an Error shape.)
import { notice } from '../core/notices/registry.js';
import { noticeFromError } from '../core/notices/from-error.js';

// ── Constants ──
const DIRECTION_MODES = [
  { value: 'LONG_ONLY', label: 'Long Only', desc: 'Buy signals only — no short trades' },
  { value: 'SHORT_ONLY', label: 'Short Only', desc: 'Sell signals only — no long trades' },
  { value: 'BOTH', label: 'Both', desc: 'Bidirectional — compares LONG vs SHORT per tick' },
];
const TRADING_STYLES = [
  { value: 'scalp', label: 'Scalp', desc: 'Seconds to minutes' },
  { value: 'speed', label: 'Speed', desc: '15s–5m sub-minute speed trading' },
  { value: 'day-trade', label: 'Day Trade', desc: 'Intraday, close by EOD' },
  { value: 'swing', label: 'Swing', desc: 'Days to weeks' },
  { value: 'position', label: 'Position', desc: 'Weeks to months' },
];

const DEFAULT_GROUPS = [
  { groupId: 'technical', name: 'Technical Analysis', weight: 10, isRiskGate: false, minMultiplier: 0.5, maxMultiplier: 1.5, directiveIds: [] },
  { groupId: 'sentiment', name: 'Sentiment & Fundamentals', weight: 8, isRiskGate: false, minMultiplier: 0.5, maxMultiplier: 1.5, directiveIds: [] },
  { groupId: 'risk', name: 'Risk Gating', weight: 5, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.0, directiveIds: [] },
];

export default function CreateProtocolsPage() {
  // ── Data ──
  const [directives, setDirectives] = useState([]);
  const [existingProtocols, setExistingProtocols] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Protocol metadata ──
  const [protocolName, setProtocolName] = useState('');
  const [protocolSlug, setProtocolSlug] = useState('');
  const [description, setDescription] = useState('');
  const [directionMode, setDirectionMode] = useState('BOTH');
  const [tradingStyle, setTradingStyle] = useState('day-trade');
  const [loadExisting, setLoadExisting] = useState('');

  // ── Groups ──
  const [groups, setGroups] = useState(DEFAULT_GROUPS.map(g => ({ ...g, directiveIds: [] })));
  const [activeGroupIdx, setActiveGroupIdx] = useState(0); // which group receives clicked directives

  // ── Save state ──
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [saveError, setSaveError] = useState('');
  // Failures get their own state. `saveError` also carries VALIDATION text ("Protocol name and slug
  // are required."), which is legitimate prose for a form; mixing the two is what forced a network
  // failure into the same string shape and lost its code.
  const [saveNotice, setSaveNotice] = useState(null);

  // ── Load directives + existing protocols ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [dirs, protos] = await Promise.all([
          apiGet('/api/directives').catch(() => []),
          apiGet('/api/scoring/protocols').catch(() => ({ protocols: [] })),
        ]);
        if (cancelled) return;
        setDirectives(Array.isArray(dirs) ? dirs : []);
        setExistingProtocols(Array.isArray(protos.protocols) ? protos.protocols : []);
      } catch (e) {
        if (!cancelled) setError(noticeFromError(e, 'TCS-SYS-007', { operation: 'load the protocols' }));
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Derive slug from name ──
  useEffect(() => {
    if (!protocolSlug || protocolSlug === slugify(protocolName) || protocolSlug === '') {
      setProtocolSlug(slugify(protocolName));
    }
  }, [protocolName]);

  // ── Load existing protocol into form ──
  useEffect(() => {
    if (!loadExisting) return;
    const proto = existingProtocols.find(p => p.id === loadExisting || p.slug === loadExisting);
    if (!proto) return;
    setProtocolName(proto.name || '');
    setProtocolSlug(proto.slug || proto.id || '');
    setDescription(proto.description || '');
    setDirectionMode(proto.directionMode || 'BOTH');
    setTradingStyle(proto.tradingStyle || 'day-trade');
    if (proto.directiveGroups?.length) {
      setGroups(proto.directiveGroups.map(g => ({
        groupId: g.groupId || g.name.toLowerCase().replace(/\s+/g, '-'),
        name: g.name,
        weight: g.weight ?? 10,
        isRiskGate: g.isRiskGate ?? false,
        minMultiplier: g.minMultiplier ?? 0.5,
        maxMultiplier: g.maxMultiplier ?? 1.5,
        directiveIds: g.directiveIds ?? g.directives?.map(d => d.directiveId) ?? [],
      })));
    }
  }, [loadExisting, existingProtocols]);

  // ── Directive category grouping ──
  const directiveCategories = useMemo(() => {
    const cats = new Map();
    for (const d of directives) {
      const cat = d.category || 'Uncategorized';
      if (!cats.has(cat)) cats.set(cat, []);
      cats.get(cat).push(d);
    }
    // Sort categories: Technical first, then Sentiment, then Risk, then alphabetically
    const order = ['Technical Analysis', 'Market Context', 'Sentiment & Fundamentals', 'Risk & Structural'];
    return [...cats.entries()].sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [directives]);

  // ── Check which directives are already used in any group ──
  const usedDirectiveIds = useMemo(() => {
    const s = new Set();
    for (const g of groups) {
      for (const id of g.directiveIds) s.add(id);
    }
    return s;
  }, [groups]);

  // ── Group actions ──
  function addGroup() {
    const idx = groups.length + 1;
    setGroups(prev => [...prev, {
      groupId: `group-${idx}`,
      name: `Group ${idx}`,
      weight: 5,
      isRiskGate: false,
      minMultiplier: 0.5,
      maxMultiplier: 1.5,
      directiveIds: [],
    }]);
  }

  function removeGroup(idx) {
    setGroups(prev => prev.filter((_, i) => i !== idx));
  }

  function updateGroup(idx, field, value) {
    setGroups(prev => prev.map((g, i) => i === idx ? { ...g, [field]: value } : g));
  }

  function toggleDirectiveInGroup(groupIdx, directiveId) {
    setGroups(prev => prev.map((g, i) => {
      if (i !== groupIdx) return g;
      const has = g.directiveIds.includes(directiveId);
      return {
        ...g,
        directiveIds: has
          ? g.directiveIds.filter(id => id !== directiveId)
          : [...g.directiveIds, directiveId],
      };
    }));
  }

  // ── Save ──
  async function handleSave() {
    if (!protocolSlug || !protocolName) {
      setSaveError('Protocol name and slug are required.');
      return;
    }
    if (groups.every(g => g.directiveIds.length === 0)) {
      setSaveError('Add at least one directive to a group.');
      return;
    }
    setSaving(true);
    setSaveError('');
    setSavedMsg('');
    try {
      const payload = {
        slug: protocolSlug,
        name: protocolName,
        description: description || null,
        directionMode,
        tradingStyle,
        groups: groups
          .filter(g => g.directiveIds.length > 0)
          .map(g => ({
            groupId: g.groupId,
            name: g.name,
            description: null,
            weight: g.weight,
            isRiskGate: g.isRiskGate,
            minMultiplier: g.minMultiplier,
            maxMultiplier: g.maxMultiplier,
            directiveIds: g.directiveIds,
          })),
      };
      const res = await apiPost('/api/scoring/protocols', payload);
      if (res.success) {
        setSavedMsg(`Protocol "${protocolName}" saved successfully!`);
        // Refresh existing protocols
        const protos = await apiGet('/api/scoring/protocols').catch(() => ({ protocols: [] }));
        setExistingProtocols(Array.isArray(protos.protocols) ? protos.protocols : []);
      } else {
        setSaveError('');
      setSaveNotice(notice('TCS-SYS-007', { operation: 'save the protocol', detail: res.error || 'The API reported a failure with no reason.' }));
      }
    } catch (e) {
      setSaveError('');
      setSaveNotice(noticeFromError(e, 'TCS-SYS-007', { operation: 'save the protocol' }));
    }
    setSaving(false);
  }

  function handleReset() {
    setProtocolName('');
    setProtocolSlug('');
    setDescription('');
    setDirectionMode('BOTH');
    setTradingStyle('day-trade');
    setLoadExisting('');
    setGroups(DEFAULT_GROUPS.map(g => ({ ...g, directiveIds: [] })));
    setSavedMsg('');
    setSaveError('');
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="cp-page">
        <div className="cp-loading">Loading directives…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cp-page">
        <div className="cp-error">
          <h2>Failed to load</h2>
          <NoticeBlock notice={error} />
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="cp-page">
      <header className="cp-header">
        <h1>Protocol Builder
          <PageInfoPopover>
            Build a scoring protocol from directive groups. Protocols define WHAT to score —
          individual directives within each group contribute evidence toward a composite score.
          Risk groups gate Technical + Sentiment groups multiplicatively.
          </PageInfoPopover>
        </h1>
      </header>

      {/* ── Protocol Metadata ── */}
      <section className="cp-section">
        <h2 className="cp-section-title">Protocol Details</h2>

        {/* Load existing */}
        {existingProtocols.length > 0 && (
          <div className="ff-field" style={{ marginBottom: '1rem' }}>
            <span className="ff-label">Load Existing Protocol</span>
            <select
              value={loadExisting}
              onChange={e => setLoadExisting(e.target.value)}
              className="ff-select"
            >
              <option value="">— Create new —</option>
              {existingProtocols.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.directiveCount} directives)</option>
              ))}
            </select>
          </div>
        )}

        <div className="ff-row-2">
          <label className="ff-field">
            <span className="ff-label">Protocol Name *</span>
            <input
              type="text"
              value={protocolName}
              onChange={e => setProtocolName(e.target.value)}
              placeholder="e.g., BTC Speed Scalp V2"
              className="ff-input"
            />
          </label>
          <label className="ff-field">
            <span className="ff-label">Slug * (auto-generated)</span>
            <input
              type="text"
              value={protocolSlug}
              onChange={e => setProtocolSlug(e.target.value)}
              placeholder="btc-speed-v2"
              className="ff-input"
            />
            <span className="ff-hint">Unique ID used in URLs and API calls. Use lowercase, hyphens.</span>
          </label>
        </div>

        <label className="ff-field">
          <span className="ff-label">Description</span>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What this protocol targets and when to use it…"
            className="ff-textarea"
            rows={2}
          />
        </label>

        <div className="ff-row-2">
          <label className="ff-field">
            <span className="ff-label">Direction Mode</span>
            <select value={directionMode} onChange={e => setDirectionMode(e.target.value)} className="ff-select">
              {DIRECTION_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>
              ))}
            </select>
          </label>
          <label className="ff-field">
            <span className="ff-label">Trading Style</span>
            <select value={tradingStyle} onChange={e => setTradingStyle(e.target.value)} className="ff-select">
              {TRADING_STYLES.map(s => (
                <option key={s.value} value={s.value}>{s.label} — {s.desc}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* ── Directive Groups ── */}
      <section className="cp-section">
        <div className="cp-section-header">
          <h2 className="cp-section-title">Directive Groups</h2>
          <button type="button" className="ff-btn ff-btn--sm" onClick={addGroup}>+ Add Group</button>
        </div>
        <p className="cp-hint">
          Each group bundles related directives and has a weight. Risk gates use multiplicative scoring
          (not additive) — their cumulative multiplier caps at maxMultiplier, floors at minMultiplier.
          Non-risk groups are additive within the group, then weighted against other groups.
        </p>

        {groups.map((group, idx) => (
          <div key={group.groupId} className={`cp-group-card ${group.isRiskGate ? 'cp-group-card--risk' : ''}`}>
            <div className="cp-group-header">
              <div className="ff-row-2" style={{ flex: 1 }}>
                <label className="ff-field">
                  <span className="ff-label">Group Name</span>
                  <input
                    type="text"
                    value={group.name}
                    onChange={e => updateGroup(idx, 'name', e.target.value)}
                    className="ff-input ff-input--sm"
                  />
                </label>
                <label className="ff-field">
                  <span className="ff-label">Group ID</span>
                  <input
                    type="text"
                    value={group.groupId}
                    onChange={e => updateGroup(idx, 'groupId', e.target.value)}
                    className="ff-input ff-input--sm"
                  />
                </label>
              </div>
              {groups.length > 1 && (
                <button
                  type="button"
                  className="cp-group-remove"
                  onClick={() => removeGroup(idx)}
                  title="Remove group"
                >✕</button>
              )}
            </div>

            <div className="ff-row-3">
              <label className="ff-field">
                <span className="ff-label">Weight</span>
                <input
                  type="number"
                  value={group.weight}
                  onChange={e => updateGroup(idx, 'weight', Number(e.target.value))}
                  min={1} max={20} step={0.5}
                  className="ff-input ff-input--sm"
                />
                <span className="ff-hint">Stored for display only — NOT applied by the scorer (#919)</span>
              </label>
              <label className="ff-field">
                <span className="ff-label">Min Multiplier</span>
                <input
                  type="number"
                  value={group.minMultiplier}
                  onChange={e => updateGroup(idx, 'minMultiplier', Number(e.target.value))}
                  min={0} max={1} step={0.1}
                  className="ff-input ff-input--sm"
                />
                <span className="ff-hint">Floor for risk gate (0–1)</span>
              </label>
              <label className="ff-field">
                <span className="ff-label">Max Multiplier</span>
                <input
                  type="number"
                  value={group.maxMultiplier}
                  onChange={e => updateGroup(idx, 'maxMultiplier', Number(e.target.value))}
                  min={1} max={2} step={0.1}
                  className="ff-input ff-input--sm"
                />
                <span className="ff-hint">Ceiling for risk gate (1–2)</span>
              </label>
            </div>

            <label className="ff-field cp-risk-toggle">
              <span className="ff-label">Risk Gate</span>
              <label className="cp-toggle">
                <input
                  type="checkbox"
                  checked={group.isRiskGate}
                  onChange={e => updateGroup(idx, 'isRiskGate', e.target.checked)}
                />
                <span className="cp-toggle-label">
                  {group.isRiskGate ? 'Multiplicative risk gating' : 'Additive scoring group'}
                </span>
              </label>
              <span className="ff-hint">
                Risk gates multiply the score from non-risk groups. Non-risk groups are added together.
              </span>
            </label>

            {/* Directives in this group */}
            <div className="cp-group-directives">
              <span className="cp-group-directives-label">
                Directives ({group.directiveIds.length})
              </span>
              {group.directiveIds.length === 0 ? (
                <p className="cp-empty-hint">Click directives in the palette below to add them to this group.</p>
              ) : (
                <div className="cp-chip-list">
                  {group.directiveIds.map(did => {
                    const dir = directives.find(d => d.id === did);
                    return (
                      <span key={did} className="cp-chip" title={dir?.description || did}>
                        {dir?.name || did}
                        <button
                          type="button"
                          className="cp-chip-remove"
                          onClick={() => toggleDirectiveInGroup(idx, did)}
                        >✕</button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* ── Directive Palette ── */}
      <section className="cp-section">
        <h2 className="cp-section-title">Directive Palette</h2>
        <p className="cp-hint">
          Click a directive to add it to the currently selected group. Directives already assigned
          to a group are dimmed. Hover for description and maxScore.
        </p>

        {directiveCategories.map(([cat, catDirectives]) => (
          <details key={cat} className="cp-category" open={cat === 'Technical Analysis'}>
            <summary className="cp-category-summary">
              {cat} ({catDirectives.length})
            </summary>
            <div className="cp-directive-grid">
              {catDirectives.map(d => {
                const usedBy = groups.find(g => g.directiveIds.includes(d.id));
                const isUsed = !!usedBy;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`cp-directive-btn ${isUsed ? 'cp-directive-btn--used' : ''}`}
                    title={`${d.description || d.name}\nMax Score: ${d.maxScore ?? 'N/A'}\n${isUsed ? `In group: ${usedBy.name}` : 'Click to add to a group'}`}
                    onClick={() => {
                      if (isUsed) {
                        // Remove from its current group
                        const gIdx = groups.indexOf(usedBy);
                        toggleDirectiveInGroup(gIdx, d.id);
                      } else {
                        // Add to the active (selected) group
                        toggleDirectiveInGroup(activeGroupIdx, d.id);
                      }
                    }}
                    disabled={false}
                  >
                    <span className="cp-directive-name">{d.name}</span>
                    <span className="cp-directive-meta">
                      {d.maxScore ? `↑${d.maxScore}` : ''}
                      {isUsed && <span className="cp-directive-used-mark" title={`In: ${usedBy.name}`}>✓ {usedBy.name}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </details>
        ))}

        {/* ── Target group selector ── */}
        <div className="cp-quick-add">
          <span className="cp-quick-add-label">Adding directives to:</span>
          <div className="cp-quick-add-groups">
            {groups.map((g, idx) => (
              <button
                key={g.groupId}
                type="button"
                className={`cp-quick-add-btn ${activeGroupIdx === idx ? 'cp-quick-add-btn--active' : ''} ${g.isRiskGate ? 'cp-quick-add-btn--risk' : ''}`}
                onClick={() => setActiveGroupIdx(idx)}
              >
                {activeGroupIdx === idx ? '▶ ' : ''}{g.name} ({g.directiveIds.length})
              </button>
            ))}
          </div>
          <span className="ff-hint">Select a target group, then click directives in the palette to assign them.</span>
        </div>
      </section>

      {/* ── Actions ── */}
      <div className="cp-actions">
        {saveError && <div className="cp-msg cp-msg--error">{saveError}</div>}
      {saveNotice && <NoticeBlock notice={saveNotice} compact />}
        {savedMsg && <div className="cp-msg cp-msg--success">{savedMsg}</div>}
        <button type="button" className="ff-btn ff-btn--primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Protocol'}
        </button>
        <button type="button" className="ff-btn" onClick={handleReset} disabled={saving}>
          Reset
        </button>
      </div>
    </div>
  );
}

// ── Helpers ──
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
