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
// The signal thresholds are SERVER-OWNED (`ENTRY_THRESHOLD` / `STRONG_PCT`). A hand-copied 6/13
// here would silently describe a scale the scorer no longer uses — the same reason the Signal bar
// reads them over HTTP.
import { fetchScoringThresholds } from '../core/api/signals';
import '../core/forms.css';
import './create-protocols.css';
import PageInfoPopover from '../components/PageInfoPopover';
import NoticeBlock from '../components/NoticeBlock';
import ProtocolSymbolsPanel from '../components/ProtocolSymbolsPanel';
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
  // Live classification thresholds (percent of CONFIGURED directional capacity). Read, never copied.
  const [thresholds, setThresholds] = useState(null);
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
        // ⚠️ NO `.catch()` PER-REQUEST (#782 / INV-NO-EMPTY-SWALLOW). The `try/catch` around this
        // already renders a notice on failure — the per-request catches ran FIRST and converted the
        // failure into empty lists, so that notice could never fire and the form silently showed "no
        // directives" / "no protocols" as though the registry were empty.
        const [dirs, protos] = await Promise.all([
          apiGet('/api/directives'),
          apiGet('/api/scoring/protocols'),
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

  // ── Thresholds — loaded SEPARATELY and without blocking the form ──────────────────────────────
  //
  // ⚠️ Measured 2026-11-07: `/api/scoring/gated/thresholds` answers in **6,206 ms** — it computes
  // `protocolCeilings` over a 7-day window for every protocol. Putting it in the `Promise.all` above
  // held the whole form at "Loading directives…" for six seconds, which is a regression, not a
  // trade-off. So the form renders from the two fast calls and this arrives afterwards; the capacity
  // panel already copes with `null` (it says "thresholds unavailable" rather than guessing a band).
  useEffect(() => {
    let cancelled = false;
    fetchScoringThresholds()
      .then(t => { if (!cancelled) setThresholds(t ?? null); })
      .catch(() => { if (!cancelled) setThresholds(null); });
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

  // ── Signal capacity — the number this form never showed ──────────────────────────────────────
  //
  // ⚠️ WHY THIS EXISTS (owner, 2026-11-07). `NEUTRAL_ONLY_DIRECTIVES` was referenced in exactly two
  // places repo-wide: a comment, and a reporting-only accumulation. Nothing at save time warned that
  // a directive CANNOT emit a direction — and the arithmetic consequence is brutal, because a
  // direction-incapable directive still occupies the signal denominator while contributing exactly 0
  // to the numerator (#1122). Measured 2026-11-07: 43 of 53 protocols contain at least one, and
  // 10,135 of 38,760 configured points (26.1%) are direction-incapable. `ftse/dax/cac-speed-v1-long`
  // each carried ~815 such points around a single 80-point directional directive, so their all-time
  // maximum composite was 31 against a min of 65 — **0 clearances ever** (#760).
  //
  // So the form now answers, live: how much capacity is selected, how much of it can EVER contribute,
  // and whether the resulting ceiling can reach the server's own entry/strong thresholds.
  //
  // ⚠️ `direction` is the DERIVED capability (source literals), not `directionBias` (a declaration —
  // ten directives declare a bias their code does not do). `unknown` is treated as CAPABLE here:
  // "cannot judge" must never be read as "neutral".
  const signalCapacity = useMemo(() => {
    const scoringGroups = groups.filter(g => !g.isRiskGate);
    let total = 0;
    let directional = 0;
    const blocked = [];
    for (const g of scoringGroups) {
      for (const id of g.directiveIds) {
        const d = directives.find(x => x.id === id);
        const pts = Number(d?.maxScore) || 0;
        total += pts;
        const dir = d?.direction ?? 'unknown';
        const usable =
          dir === 'both' ||
          dir === 'unknown' ||
          (dir === 'bullish-only' && directionMode !== 'SHORT_ONLY') ||
          (dir === 'bearish-only' && directionMode !== 'LONG_ONLY');
        if (usable) directional += pts;
        else blocked.push({ id, name: d?.name || id, pts, dir });
      }
    }
    const ceilingPct = total > 0 ? Math.round((directional / total) * 100) : null;
    return { total, directional, unearnable: total - directional, ceilingPct, blocked };
  }, [groups, directives, directionMode]);

  // ── Check which directives are already used in any group ──
  // (`usedDirectiveIds` used to live here — a Set nothing read. Removed 2026-11-07: the palette
  // resolves its own `usedBy` per directive, so the Set was dead and only ever produced a lint
  // error, which is exactly the kind of noise that hides a real one.)

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
    // ── The impossibility, refused rather than saved ─────────────────────────────────────────────
    // Zero direction-capable capacity is not a weak protocol, it is one that can never produce a
    // signal: every selected directive occupies the signal denominator and contributes exactly 0 to
    // the numerator (#1122). `ftse/dax/cac-speed-v1-long` shipped in exactly this state and cleared
    // their gate 0 times across their whole history (#760). The panel explains WHY; this stops it.
    if (signalCapacity.total > 0 && signalCapacity.directional === 0) {
      setSaveError(
        'Every selected directive is direction-incapable, so this protocol could never produce a BUY or SELL. '
        + 'Add at least one directive that can emit a direction, or remove the context directives.',
      );
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
      // ── #1124 RESOLVED 2026-10-16 ────────────────────────────────────────────────────────────
      // This form composed a protocol but could not give it any SYMBOLS. Before the fix no
      // controller wrote `symbol_protocol_assignment` at all — the only writes were side-effects
      // inside `protocol-db.service.ts` (L590 copying assignments when a protocol is DUPLICATED,
      // L709 deleting them). So a COPIED protocol worked and a COMPOSED one could never be wired.
      // With no assignment, `resolveSymbols()` fell through to a NAME-GUESSING fallback (#761/#763)
      // or resolved nothing — neither of which reported an error.
      // NOW: `ProtocolSymbolsPanel` below manages assignments through
      // `POST/DELETE /api/scoring/gated/protocols/:id/symbols`, and shows the resolution label so
      // a GUESSED list (`derived`) is distinguishable from a wired one (`db:assignment`).
      const res = await apiPost('/api/scoring/protocols', payload);
      if (res.success) {
        setSavedMsg(`Protocol "${protocolName}" saved successfully!`);
        // Refresh existing protocols.
        // ⚠️ The SAVE succeeded, so a failed refresh must not be reported as a failed save (#782).
        // It gets its own notice naming the actual gap.
        try {
          const protos = await apiGet('/api/scoring/protocols');
          setExistingProtocols(Array.isArray(protos.protocols) ? protos.protocols : []);
        } catch (refreshErr) {
          setSaveNotice(noticeFromError(refreshErr, 'TCS-SYS-007', {
            operation: 'refresh the protocol list after saving',
            detail: 'the protocol WAS saved — this list below is stale, not empty',
          }));
        }
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
                // A direction-incapable directive is marked IN THE PALETTE, where the choice is made.
                // The tooltip says what it costs rather than only labelling it.
                const noSignal = d.direction === 'none';
                const oneSide = d.direction === 'bullish-only' || d.direction === 'bearish-only';
                const dirNote = noSignal
                  ? 'CANNOT emit a direction — it scores, but adds 0 to the signal while still counting in the divisor (dilution).'
                  : oneSide
                    ? `Can only read ONE side (${d.direction}) — unearnable capacity in an opposite-direction protocol.`
                    : '';
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`cp-directive-btn ${isUsed ? 'cp-directive-btn--used' : ''} ${noSignal ? 'cp-directive-btn--nosignal' : ''}`}
                    title={`${d.description || d.name}\nMax Score: ${d.maxScore ?? 'N/A'}${dirNote ? `\n\n${dirNote}` : ''}\n${isUsed ? `In group: ${usedBy.name}` : 'Click to add to a group'}`}
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
                      {noSignal && <span className="cp-directive-nosignal-mark" title="Cannot emit a direction — adds 0 to the signal">no signal</span>}
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

      {/* ── Signal capacity — what the selected directives can actually produce ────────────────
          Sits directly above Save, because that is the point of commitment. Every number here is
          derived from the selection; the thresholds are read from the server, not copied. */}
      {signalCapacity.total > 0 && (() => {
        const entry = thresholds?.classification?.entry ?? null;
        const strong = thresholds?.classification?.strong ?? null;
        const ceiling = signalCapacity.ceilingPct;
        // ⚠️ A ceiling of 0 is an impossibility that needs no threshold: every selected directive is
        // direction-incapable, so no reading can ever move BUY/SELL. Checked BEFORE the band
        // comparison — otherwise a 0% ceiling renders as "not all of it can contribute", which
        // understates it, and while the thresholds are still in flight the band comparison cannot
        // run at all, so it must fall back to an honest "pending" rather than a verdict.
        const nothingEarns = ceiling === 0;
        const belowStrong = strong != null && ceiling != null && ceiling < strong;
        const belowEntry = entry != null && ceiling != null && ceiling < entry;
        const tone = nothingEarns || belowEntry || belowStrong
          ? 'danger'
          : signalCapacity.unearnable > 0 ? 'warn' : 'ok';
        return (
          <section className={`cp-capacity cp-capacity--${tone}`} aria-live="polite">
            <div className="cp-capacity-head">
              <h2 className="cp-section-title">Signal capacity</h2>
              <span className="cp-capacity-verdict">
                {nothingEarns
                  ? 'No selected directive can emit a direction — this protocol can never signal'
                  : belowEntry
                    ? 'This protocol can NEVER produce a BUY or SELL'
                    : belowStrong
                      ? 'This protocol can never read STRONG'
                      : entry == null || strong == null
                        ? 'Thresholds still loading — ceiling so far'
                        : signalCapacity.unearnable > 0
                          ? 'Direction-capable, but not all of it'
                          : 'Every point can contribute to the signal'}
              </span>
            </div>

            <div className="cp-capacity-grid">
              <div>
                <span className="cp-capacity-label">Selected capacity</span>
                <span className="cp-capacity-value">{signalCapacity.total} pts</span>
                <span className="cp-capacity-note">non-risk-gate groups only</span>
              </div>
              <div>
                <span className="cp-capacity-label">Can emit a direction</span>
                <span className="cp-capacity-value">{signalCapacity.directional} pts</span>
                <span className="cp-capacity-note">the only points the signal can earn</span>
              </div>
              <div>
                <span className="cp-capacity-label">Never earnt</span>
                <span className="cp-capacity-value">
                  {signalCapacity.unearnable} pts
                  {signalCapacity.unearnable > 0 && ` · ${100 - ceiling}%`}
                </span>
                <span className="cp-capacity-note">counts in the divisor, adds 0 to the numerator</span>
              </div>
              <div>
                <span className="cp-capacity-label">Signal ceiling</span>
                <span className="cp-capacity-value">
                  {ceiling == null ? '—' : `${ceiling}%`}
                </span>
                <span className="cp-capacity-note">
                  {entry != null && strong != null
                    ? `entry ${entry}% · strong ${strong}%`
                    : 'thresholds unavailable'}
                </span>
              </div>
            </div>

            {signalCapacity.blocked.length > 0 && (
              <div className="cp-capacity-blocked">
                <p className="cp-capacity-blocked-title">
                  {signalCapacity.blocked.length} selected directive
                  {signalCapacity.blocked.length === 1 ? '' : 's'} can never emit a direction
                  {directionMode !== 'BOTH' ? ` in ${directionMode}` : ''}:
                </p>
                <ul className="cp-capacity-blocked-list">
                  {signalCapacity.blocked.map(b => (
                    <li key={b.id}>
                      <strong>{b.name}</strong> — {b.pts} pts
                      {b.dir !== 'none' ? ` (${b.dir} only)` : ''}
                    </li>
                  ))}
                </ul>
                <p className="cp-capacity-hint">
                  These are context directives: their score is real and they are ranked on in
                  <em> opportunity</em>, but they cannot move BUY/SELL. Removing them raises the
                  ceiling; keeping many of them makes every signal this protocol produces weaker.
                  {belowStrong && strong != null && ` With the current set it can never reach ${strong}%.`}
                </p>
              </div>
            )}
          </section>
        );
      })()}

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

      {/* ── #1124 — the symbols this protocol scores ─────────────────────────────────────────
          Mounted HERE because composing a protocol and wiring it to symbols are two halves of one
          job, and only the first half had a control. Without an assignment, `resolveSymbols()`
          falls through to a NAME-GUESSING fallback (#761/#763) or resolves nothing — and neither
          failure reports an error. Keyed on the slug so loading another protocol refetches rather
          than showing the previous protocol's symbols. */}
      <ProtocolSymbolsPanel protocolSlug={protocolSlug} />
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
