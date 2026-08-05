import { useState, useEffect, useMemo } from 'react';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import '../core/forms.css';
import './create-protocols.css';
import PageInfoPopover from '../components/PageInfoPopover';

export default function StrategyBuilderPage() {
  const [protocols, setProtocols] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedProtocolId, setSelectedProtocolId] = useState('');
  const [strategyName, setStrategyName] = useState('');
  const [gateConfigs, setGateConfigs] = useState({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiGet('/api/scoring/protocols').catch(() => ({ protocols: [] }));
        if (!cancelled) setProtocols(res.protocols || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const selectedProtocol = useMemo(
    () => protocols.find(p => p.id === selectedProtocolId),
    [protocols, selectedProtocolId],
  );

  useEffect(() => {
    if (!selectedProtocol?.groups?.length) { setGateConfigs({}); return; }
    const configs = {};
    for (const g of selectedProtocol.groups) {
      configs[g.id] = {
        enabled: g.isRiskGate || false,
        threshold: 60,
      };
    }
    setGateConfigs(configs);
  }, [selectedProtocolId, selectedProtocol]);

  const groups = selectedProtocol?.groups || [];

  function toggleGate(groupId) {
    setGateConfigs(prev => ({
      ...prev,
      [groupId]: { ...prev[groupId], enabled: !prev[groupId]?.enabled },
    }));
  }

  function setThreshold(groupId, value) {
    setGateConfigs(prev => ({
      ...prev,
      [groupId]: { ...prev[groupId], threshold: Number(value) },
    }));
  }

  async function handleSave() {
    if (!selectedProtocolId || !strategyName) {
      setSaveError('Strategy name and protocol are required.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const gates = Object.entries(gateConfigs)
        .filter(([, cfg]) => cfg.enabled)
        .map(([groupId, cfg]) => ({ groupId, threshold: cfg.threshold }));
      await apiPost('/api/scoring/strategies', {
        name: strategyName,
        protocolId: selectedProtocolId,
        gates,
      });
      setSavedMsg('Scoring strategy saved!');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (e) {
      setSaveError(e.message || 'Save failed.');
    }
    setSaving(false);
  }

  if (loading) return <div className="cp-page"><LoadingSkeleton variant="text" lines={8} /></div>;
  if (error) return <div className="cp-page"><div className="cp-error"><h2>Failed to load</h2><p>{error}</p></div></div>;

  return (
    <div className="cp-page">
      <header className="cp-header">
        <h1>Strategy Builder
          <PageInfoPopover>
            Configure a scoring strategy from an existing protocol. Choose which directive
            groups act as scoring gates — a group must meet its threshold percentage for the
            strategy to produce a signal.
          </PageInfoPopover>
        </h1>
      </header>

      <section className="cp-section">
        <h2 className="cp-section-title">Strategy Details</h2>

        <div className="ff-row-2">
          <label className="ff-field">
            <span className="ff-label">Strategy Name *</span>
            <input type="text" value={strategyName} onChange={e => setStrategyName(e.target.value)}
              placeholder="e.g., Gold Day-Trade Auto" className="ff-input" />
          </label>
          <label className="ff-field">
            <span className="ff-label">Protocol *</span>
            <select value={selectedProtocolId} onChange={e => setSelectedProtocolId(e.target.value)} className="ff-select">
              <option value="">— Select a protocol —</option>
              {protocols.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.directiveCount} directives)</option>
              ))}
            </select>
          </label>
        </div>

        {selectedProtocol && (
          <div className="ff-field" style={{ marginTop: '0.5rem' }}>
            <span className="ff-hint">
              {selectedProtocol.description || 'No description.'}
              {' '}· {selectedProtocol.directionMode || 'BOTH'} · {selectedProtocol.tradingStyle || 'day-trade'}
            </span>
          </div>
        )}
      </section>

      {groups.length > 0 && (
        <section className="cp-section">
          <h2 className="cp-section-title">Gate Configuration</h2>
          <p className="ff-hint" style={{ marginBottom: '0.75rem' }}>
            Enable gating on a group to require its composite score to meet a minimum threshold
            before the strategy produces a signal. Disabled groups contribute to the overall score
            but don't block signals.
          </p>

          <div className="cp-groups-list">
            {groups.map((g) => {
              const cfg = gateConfigs[g.id] || { enabled: false, threshold: 60 };
              const directiveCount = g.directives?.length || g.directiveIds?.length || 0;
              return (
                <div key={g.id} className={"cp-group-card" + (cfg.enabled ? ' cp-group-gated' : '')}>
                  <div className="cp-group-header">
                    <div className="cp-group-info">
                      <strong className="cp-group-name">{g.name}</strong>
                      <span className="cp-group-meta">
                        {directiveCount} directive{directiveCount !== 1 ? 's' : ''} · Weight: {g.weight ?? '—'}
                      </span>
                    </div>
                    <button type="button"
                      className={"cp-gate-toggle" + (cfg.enabled ? ' active' : '')}
                      onClick={() => toggleGate(g.id)}
                      title={cfg.enabled ? 'Gate enabled' : 'Gate disabled'}>
                      {cfg.enabled ? '🔒 GATE ON' : '🔓 GATE OFF'}
                    </button>
                  </div>
                  {cfg.enabled && (
                    <div className="cp-gate-config">
                      <label className="cp-threshold-label">
                        Threshold: {cfg.threshold}%
                        <input type="range" min={10} max={95} step={5} value={cfg.threshold}
                          onChange={e => setThreshold(g.id, e.target.value)} className="cp-threshold-slider" />
                      </label>
                      <span className="cp-threshold-hint">
                        Group must score ≥ {cfg.threshold}% for signal to pass
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="cp-section">
        {savedMsg && <div className="cp-saved-msg">{savedMsg}</div>}
        {saveError && <div className="cp-save-error">{saveError}</div>}
        <button className="cp-save-btn" onClick={handleSave}
          disabled={saving || !selectedProtocolId || !strategyName}>
          {saving ? 'Saving…' : 'Save Scoring Strategy'}
        </button>
      </section>
    </div>
  );
}
