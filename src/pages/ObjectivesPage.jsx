import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './objectives.css';

const CRITERIA_STORAGE_KEY = 'tcs:objectives-criteria';

const CATEGORY_LABELS = {
  'active-trading': 'Active Trading',
  'account-growth': 'Account Growth',
  'portfolio-recovery': 'Portfolio Recovery',
  'long-term': 'Long Term',
  'instrument-trading': 'Instrument Trading',
  'custom': 'Custom',
};

const STATUS_COLORS = {
  active: '#22c55e',
  achieved: '#3b82f6',
  abandoned: '#6b7280',
};

const PHASE_LABELS = {
  demo: 'Demo',
  live: 'Live',
  planning: 'Planning',
};

/**
 * Parse criteria checklist items from objective notes.
 * Extracts lines starting with "- " or numbered "1. " patterns.
 */
function parseCriteria(notes) {
  if (!notes) return [];
  const lines = notes.split('\n');
  const criteria = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Match "- item" or "1. item" or "- [ ] item" or "- [x] item"
    const listMatch = trimmed.match(/^[-*]\s+(?:\[([ x])\]\s*)?(.+)$/);
    const numMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (listMatch) {
      const text = listMatch[2].replace(/\*\*/g, '').trim();
      if (text.length > 3 && !text.startsWith('#')) {
        criteria.push({ text, done: listMatch[1] === 'x' });
      }
    } else if (numMatch) {
      const text = numMatch[1].replace(/\*\*/g, '').trim();
      if (text.length > 3) {
        criteria.push({ text, done: false });
      }
    }
  }
  return criteria;
}

export default function ObjectivesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [criteriaState, setCriteriaState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CRITERIA_STORAGE_KEY) || '{}'); }
    catch { return {}; }
  });
  const [form, setForm] = useState({
    title: '', description: '', category: 'custom',
    targetAmount: '', currentAmount: '', currency: 'GBP',
    targetDate: '', linkedStrategy: '', linkedAccount: '', notes: '',
  });

  const { data: objectives, isLoading, isError } = useQuery({
    queryKey: ['planner', 'objectives'],
    queryFn: () => apiGet('/api/planner/objectives'),
    refetchInterval: 60000,
  });

  const seedMutation = useMutation({
    mutationFn: () => apiPost('/api/planner/objectives/seed'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['planner', 'objectives'] }); setSeeded(true); },
  });

  const createMutation = useMutation({
    mutationFn: (body) => apiPost('/api/planner/objectives', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['planner', 'objectives'] }); setShowForm(false); resetForm(); },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => apiPatch(`/api/planner/objectives/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['planner', 'objectives'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => apiDelete(`/api/planner/objectives/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['planner', 'objectives'] }),
  });

  const resetForm = () => setForm({
    title: '', description: '', category: 'custom',
    targetAmount: '', currentAmount: '', currency: 'GBP',
    targetDate: '', linkedStrategy: '', linkedAccount: '', notes: '',
  });

  useEffect(() => {
    if (objectives && objectives.length === 0 && !seeded) {
      seedMutation.mutate();
    }
  }, [objectives]);

  // Persist criteria state
  useEffect(() => {
    localStorage.setItem(CRITERIA_STORAGE_KEY, JSON.stringify(criteriaState));
  }, [criteriaState]);

  const toggleCriteria = useCallback((objId, idx) => {
    setCriteriaState(prev => {
      const key = objId + ':' + idx;
      const next = { ...prev };
      next[key] = !prev[key];
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    createMutation.mutate({
      title: form.title.trim(),
      description: form.description || null,
      category: form.category,
      targetAmount: form.targetAmount ? parseFloat(form.targetAmount) : null,
      currentAmount: form.currentAmount ? parseFloat(form.currentAmount) : 0,
      currency: form.currency,
      targetDate: form.targetDate || null,
      linkedStrategy: form.linkedStrategy || null,
      linkedAccount: form.linkedAccount || null,
      notes: form.notes || null,
    });
  };

  const items = (objectives || []).slice().sort((a, b) => {
    // Priority first, then status (active before achieved/abandoned)
    if (a.priority !== b.priority) return (a.priority || 99) - (b.priority || 99);
    const statusOrder = { active: 0, achieved: 1, abandoned: 2 };
    return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
  });

  const activeCount = items.filter((o) => o.status === 'active').length;
  const achievedCount = items.filter((o) => o.status === 'achieved').length;

  // Group by category for display
  const grouped = items.reduce((acc, obj) => {
    const cat = obj.category || 'custom';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(obj);
    return acc;
  }, {});

  return (
    <div className="ob-page">
      <motion.header className="ob-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Objectives</h1>
        <p className="ob-subtitle">
          Systematic trading goals with measurable criteria.
          {activeCount > 0 && <span className="ob-count"> {activeCount} active{achievedCount > 0 ? ', ' + achievedCount + ' achieved' : ''}</span>}
        </p>
      </motion.header>

      {isError && <ApiOfflineBanner />}
      {isLoading && <LoadingSkeleton variant="text" lines={4} />}

      <div className="ob-actions">
        <button className="ob-add-btn" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New Objective'}
        </button>
        {items.length === 0 && !seedMutation.isPending && (
          <button className="ob-seed-btn" onClick={() => seedMutation.mutate()}>Load Built-in Examples</button>
        )}
      </div>

      {seedMutation.isPending && <LoadingSkeleton variant="text" lines={3} />}

      {showForm && (
        <motion.form className="ob-form" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} onSubmit={handleSubmit}>
          <div className="ob-form-row">
            <input className="ob-input" placeholder="Title (e.g. Grow Xtrend to 500 GBP)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <select className="ob-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="active-trading">Active Trading</option>
              <option value="account-growth">Account Growth</option>
              <option value="instrument-trading">Instrument Trading</option>
              <option value="portfolio-recovery">Portfolio Recovery</option>
              <option value="long-term">Long Term</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="ob-form-row">
            <input className="ob-input ob-input-sm" type="number" step="0.01" placeholder="Target GBP" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} />
            <input className="ob-input ob-input-sm" type="number" step="0.01" placeholder="Current GBP" value={form.currentAmount} onChange={(e) => setForm({ ...form, currentAmount: e.target.value })} />
            <input className="ob-input ob-input-sm" type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
          </div>
          <textarea className="ob-textarea" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <div className="ob-form-row">
            <input className="ob-input" placeholder="Linked strategy (optional)" value={form.linkedStrategy} onChange={(e) => setForm({ ...form, linkedStrategy: e.target.value })} />
            <input className="ob-input" placeholder="Linked account (optional)" value={form.linkedAccount} onChange={(e) => setForm({ ...form, linkedAccount: e.target.value })} />
          </div>
          <button className="ob-submit-btn" type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Saving...' : 'Create Objective'}
          </button>
        </motion.form>
      )}

      <div className="ob-grid">
        {Object.entries(grouped).map(([category, catObjs]) => (
          <div key={category} className="ob-category">
            <h3 className="ob-cat-label">{CATEGORY_LABELS[category] || category}</h3>
            <div className="ob-cat-items">
              {catObjs.map((obj, i) => {
                const criteria = parseCriteria(obj.notes);
                const totalCriteria = criteria.length;
                const criteriaKey = obj.id;
                const doneCount = criteria.filter((_, ci) => criteriaState[criteriaKey + ':' + ci]).length;
                const criteriaPct = totalCriteria > 0 ? Math.round((doneCount / totalCriteria) * 100) : 0;
                const isExpanded = expandedIds.has(obj.id);

                return (
                  <motion.div
                    key={obj.id}
                    className={'ob-card ob-status-' + obj.status + (isExpanded ? ' ob-expanded' : '')}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    {/* Header row — always visible */}
                    <button
                      className="ob-card-toggle"
                      onClick={() => toggleExpand(obj.id)}
                      aria-expanded={isExpanded}
                    >
                      <span className="ob-accordion-arrow">{isExpanded ? '▾' : '▸'}</span>
                      <span className="ob-card-title">
                        {obj.priority > 0 && <span className="ob-priority-badge">P{obj.priority}</span>}
                        {obj.title}
                      </span>
                      <div className="ob-card-badges">
                        {obj.phase && obj.phase !== 'planning' && (
                          <span className={'ob-phase-badge ob-phase--' + obj.phase}>
                            {PHASE_LABELS[obj.phase] || obj.phase}
                          </span>
                        )}
                        <span
                          className="ob-status-badge"
                          style={{ background: (STATUS_COLORS[obj.status] || '#6b7280') + '20', color: STATUS_COLORS[obj.status] }}
                        >
                          {obj.status}
                        </span>
                      </div>
                    </button>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="ob-card-body">
                        {obj.description && <p className="ob-card-desc">{obj.description}</p>}

                        {/* Financial progress bar */}
                        {(obj.targetAmount != null || obj.currentAmount > 0) && (
                          <div className="ob-progress-section">
                            <div className="ob-progress-bar">
                              <div
                                className="ob-progress-fill"
                                style={{ width: Math.min(100, obj.progressPct || 0) + '%', background: STATUS_COLORS[obj.status] || 'var(--accent)' }}
                              />
                            </div>
                            <div className="ob-progress-label">
                              {obj.currentAmount > 0 && <span>GBP {obj.currentAmount.toFixed(0)}</span>}
                              {obj.targetAmount != null && <span> / GBP {obj.targetAmount.toFixed(0)}</span>}
                              <span className="ob-pct"> ({obj.progressPct || 0}%)</span>
                            </div>
                          </div>
                        )}

                        {/* Criteria checklist */}
                        {totalCriteria > 0 && (
                          <div className="ob-criteria-section">
                            <div className="ob-criteria-header">
                              <span className="ob-criteria-title">Criteria</span>
                              <span className="ob-criteria-count">{doneCount}/{totalCriteria} done</span>
                            </div>
                            <div className="ob-criteria-progress">
                              <div className="ob-criteria-fill" style={{ width: criteriaPct + '%' }} />
                            </div>
                            <div className="ob-criteria-list">
                              {criteria.map((c, ci) => {
                                const checked = criteriaState[criteriaKey + ':' + ci] || c.done;
                                return (
                                  <label key={ci} className={'ob-criteria-item' + (checked ? ' ob-criteria-done' : '')}>
                                    <input
                                      type="checkbox"
                                      className="ob-criteria-check"
                                      checked={checked}
                                      onChange={() => toggleCriteria(criteriaKey, ci)}
                                    />
                                    <span className="ob-criteria-text">{c.text}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Meta tags */}
                        <div className="ob-card-meta">
                          {obj.linkedStrategy && <span className="ob-tag">Strategy: {obj.linkedStrategy}</span>}
                          {obj.linkedAccount && <span className="ob-tag">Account: {obj.linkedAccount}</span>}
                          {obj.targetDate && <span className="ob-tag">By: {new Date(obj.targetDate).toLocaleDateString()}</span>}
                        </div>

                        {/* Status actions */}
                        <div className="ob-card-actions">
                          {obj.status === 'active' && (
                            <>
                              <button className="ob-action-btn ob-achieve" onClick={() => statusMutation.mutate({ id: obj.id, status: 'achieved' })}>Mark Achieved</button>
                              <button className="ob-action-btn ob-abandon" onClick={() => statusMutation.mutate({ id: obj.id, status: 'abandoned' })}>Abandon</button>
                            </>
                          )}
                          {obj.status === 'abandoned' && (
                            <button className="ob-action-btn ob-reactivate" onClick={() => statusMutation.mutate({ id: obj.id, status: 'active' })}>Reactivate</button>
                          )}
                          {!obj.isBuiltIn && (
                            <button className="ob-delete-btn" onClick={() => deleteMutation.mutate(obj.id)} title="Delete">Delete</button>
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
