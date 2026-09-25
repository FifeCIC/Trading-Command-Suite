import { useState, useEffect } from 'react';
import './trading-plans-page.css';

const API = 'http://localhost:3201/api/plans';

export default function TradingPlansPage() {
  const [plans, setPlans] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'plan', notes: '', content: '' });

  useEffect(() => { fetchPlans(); }, []);

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const res = await fetch(API);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setPlans(list);
      if (list.length > 0 && !selected) setSelected(list[0]);
    } catch (e) {
      console.error('Failed to load plans', e);
      setPlans([]);
    }
    setLoading(false);
  };

  const createPlan = async () => {
    try {
      let content;
      try {
        content = JSON.parse(form.content);
      } catch {
        content = { text: form.content };
      }
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          type: form.type,
          content,
          notes: form.notes || null,
          status: 'draft',
        }),
      });
      const data = await res.json();
      setPlans([data, ...plans]);
      setSelected(data);
      setCreating(false);
      setForm({ title: '', type: 'plan', notes: '', content: '' });
    } catch (e) {
      console.error('Failed to create plan', e);
    }
  };

  const updateStatus = async (id, status) => {
    await fetch(`${API}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    fetchPlans();
  };

  const deletePlan = async (id) => {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    if (selected?.id === id) setSelected(null);
    fetchPlans();
  };

  const statusColors = { draft: '#ffaa00', active: '#00cc66', executed: '#4488ff', archived: '#888888' };
  const typeLabels = { signal: 'Signal', plan: 'Plan', triage: 'Triage', averaging: 'Averaging', 'weekend-defense': 'Weekend Defense', entry: 'Entry', exit: 'Exit' };

  return (
    <div className="trading-plans-page">
      <div className="plans-sidebar">
        <div className="plans-header">
          <h2>Trading Plans</h2>
          <button className="btn-new-plan" onClick={() => setCreating(true)}>+ New Plan</button>
        </div>
        {loading && <div className="plans-loading">Loading...</div>}
        <div className="plans-list">
          {plans.map((p) => (
            <div
              key={p.id}
              className={`plan-item ${selected?.id === p.id ? 'selected' : ''}`}
              onClick={() => setSelected(p)}
            >
              <div className="plan-item-title">{p.title}</div>
              <div className="plan-item-meta">
                <span className="plan-type">{typeLabels[p.type] || p.type}</span>
                <span className="plan-status" style={{ color: statusColors[p.status] }}>
                  {p.status}
                </span>
                <span className="plan-date">{new Date(p.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
          {plans.length === 0 && !loading && (
            <div className="plans-empty">No plans yet. Create your first trading plan.</div>
          )}
        </div>
      </div>

      <div className="plans-detail">
        {creating ? (
          <div className="plan-form">
            <h3>New Trading Plan</h3>
            <input
              placeholder="Plan title (e.g. Mon Jun 22 Triage)"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <textarea
              placeholder="Plan content (JSON or markdown)"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={12}
            />
            <input
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            <div className="form-actions">
              <button className="btn-cancel" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn-save" onClick={createPlan} disabled={!form.title || !form.content}>
                Save Plan
              </button>
            </div>
          </div>
        ) : selected ? (
          <div className="plan-detail-content">
            <div className="plan-detail-header">
              <h3>{selected.title}</h3>
              <div className="plan-actions">
                <select
                  value={selected.status}
                  onChange={(e) => updateStatus(selected.id, e.target.value)}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="executed">Executed</option>
                  <option value="archived">Archived</option>
                </select>
                <button className="btn-delete" onClick={() => deletePlan(selected.id)}>Delete</button>
              </div>
            </div>
            <div className="plan-meta-row">
              <span className="plan-type-badge">{typeLabels[selected.type] || selected.type}</span>
              <span className="plan-status-badge" style={{ background: statusColors[selected.status] }}>
                {selected.status}
              </span>
              <span>{new Date(selected.createdAt).toLocaleString()}</span>
            </div>
            {selected.notes && <div className="plan-notes">{selected.notes}</div>}
            {selected.content?.source === 'signals' && (
              <div className="plan-signal-context">
                <div className="plan-signal-head">
                  <span className={`plan-signal-dir plan-signal-dir--${String(selected.content.direction).toLowerCase()}`}>
                    {selected.content.direction}
                  </span>
                  <strong>{selected.content.symbol}</strong>
                  <span className="plan-signal-proto">{selected.content.protocolName || selected.content.protocolId}</span>
                </div>
                {/* ⚠️ §9.14 / D5=A — the free edition shows no score-derived numbers. The row goes as a
                    UNIT rather than field by field: all four values arrive in the same scoring
                    payload, so stripping the two obvious percentages and keeping `combinedStrength`
                    and `confidence` would leave the row looking intact while still carrying scores.
                    Which fields LOOK like scores is not a safe test — the payload is the test. */}
                {import.meta.env.VITE_EDITION !== 'free' && (
                  <div className="plan-signal-metrics">
                    <span><em>Combined</em> <strong>{selected.content.combinedStrength ?? '—'}</strong></span>
                    <span><em>Signal</em> <strong>{selected.content.signalPct != null ? `${selected.content.signalPct}%` : '—'}</strong></span>
                    <span><em>Opportunity</em> <strong>{selected.content.opportunityPct != null ? `${selected.content.opportunityPct}%` : '—'}</strong></span>
                    <span><em>Confidence</em> <strong>{selected.content.confidence ?? '—'}</strong></span>
                  </div>
                )}
                {(selected.content.topDirectives || []).length > 0 && (
                  <div className="plan-signal-drivers">
                    {(selected.content.topDirectives || []).slice(0, 3).map((d, i) => (
                      <span key={i} className="plan-signal-chip" title={d.reason || d.name}>{d.name}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="plan-content">
              <h4>Plan</h4>
              <pre>{JSON.stringify(selected.content, null, 2)}</pre>
            </div>
          </div>
        ) : (
          <div className="plans-no-selection">
            Select a plan or create a new one.
          </div>
        )}
      </div>
    </div>
  );
}
