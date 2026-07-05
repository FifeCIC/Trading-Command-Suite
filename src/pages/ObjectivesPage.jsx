import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './objectives.css';

/** Lightweight markdown-to-HTML for trusted notes content */
function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Arrows
  html = html.replace(/→/g, '<span class="ob-arrow">→</span>');
  // Newlines → <br>
  html = html.replace(/\n/g, '<br/>');
  return html;
}

const CATEGORY_LABELS = {
  'active-trading': '🎯 Active Trading',
  'account-growth': '📈 Account Growth',
  'portfolio-recovery': '🔄 Portfolio Recovery',
  'long-term': '🏔️ Long Term',
  'custom': '✏️ Custom',
};

const STATUS_COLORS = {
  active: '#22c55e',
  achieved: '#3b82f6',
  abandoned: '#6b7280',
};

export default function ObjectivesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [seeded, setSeeded] = useState(false);
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

  const items = objectives || [];
  const activeCount = items.filter((o) => o.status === 'active').length;
  const achievedCount = items.filter((o) => o.status === 'achieved').length;

  const grouped = items.reduce((acc, obj) => {
    const cat = obj.category || 'custom';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(obj);
    return acc;
  }, {});

  return (
    <div className="ob-page">
      <motion.header className="ob-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>🎯 Objectives</h1>
        <p className="ob-subtitle">
          Set trading goals — from active MT5 trading to long-term capital targets.
          {activeCount > 0 && <span className="ob-count"> {activeCount} active{achievedCount > 0 ? `, ${achievedCount} achieved` : ''}</span>}
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
            <input className="ob-input" placeholder="Title (e.g. Grow Xtrend to £500)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <select className="ob-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="active-trading">Active Trading</option>
              <option value="account-growth">Account Growth</option>
              <option value="portfolio-recovery">Portfolio Recovery</option>
              <option value="long-term">Long Term</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="ob-form-row">
            <input className="ob-input ob-input-sm" type="number" step="0.01" placeholder="Target £" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} />
            <input className="ob-input ob-input-sm" type="number" step="0.01" placeholder="Current £" value={form.currentAmount} onChange={(e) => setForm({ ...form, currentAmount: e.target.value })} />
            <input className="ob-input ob-input-sm" type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
          </div>
          <textarea className="ob-textarea" placeholder="Description or notes" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
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
              {catObjs.map((obj, i) => (
                <motion.div
                  key={obj.id}
                  className={`ob-card ob-status-${obj.status}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <div className="ob-card-header">
                    <span className="ob-card-title">{obj.isBuiltIn && '📌 '}{obj.title}</span>
                    <span className="ob-status-badge" style={{ background: (STATUS_COLORS[obj.status] || '#6b7280') + '20', color: STATUS_COLORS[obj.status] }}>
                      {obj.status}
                    </span>
                  </div>

                  {obj.description && <p className="ob-card-desc">{obj.description}</p>}

                  {(obj.targetAmount != null || obj.currentAmount > 0) && (
                    <div className="ob-progress-section">
                      <div className="ob-progress-bar">
                        <div
                          className="ob-progress-fill"
                          style={{ width: `${Math.min(100, obj.progressPct || 0)}%`, background: STATUS_COLORS[obj.status] || 'var(--accent)' }}
                        />
                      </div>
                      <div className="ob-progress-label">
                        {obj.currentAmount > 0 && <span>£{obj.currentAmount.toFixed(0)}</span>}
                        {obj.targetAmount != null && <span> / £{obj.targetAmount.toFixed(0)}</span>}
                        <span className="ob-pct"> ({obj.progressPct || 0}%)</span>
                      </div>
                    </div>
                  )}

                  <div className="ob-card-meta">
                    {obj.linkedStrategy && <span className="ob-tag">Strategy: {obj.linkedStrategy}</span>}
                    {obj.linkedAccount && <span className="ob-tag">Account: {obj.linkedAccount}</span>}
                    {obj.targetDate && <span className="ob-tag">By: {new Date(obj.targetDate).toLocaleDateString()}</span>}
                  </div>

                  {obj.notes && (
                    <div className="ob-card-notes" dangerouslySetInnerHTML={{ __html: renderMarkdown(obj.notes) }} />
                  )}

                  <div className="ob-card-actions">
                    {obj.status === 'active' && (
                      <>
                        <button className="ob-action-btn ob-achieve" onClick={() => statusMutation.mutate({ id: obj.id, status: 'achieved' })}>✓ Mark Achieved</button>
                        <button className="ob-action-btn ob-abandon" onClick={() => statusMutation.mutate({ id: obj.id, status: 'abandoned' })}>Abandon</button>
                      </>
                    )}
                    {obj.status === 'abandoned' && (
                      <button className="ob-action-btn ob-reactivate" onClick={() => statusMutation.mutate({ id: obj.id, status: 'active' })}>↻ Reactivate</button>
                    )}
                    {!obj.isBuiltIn && (
                      <button className="ob-delete-btn" onClick={() => deleteMutation.mutate(obj.id)} title="Delete">×</button>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="ob-future-note">
        <p>💡 Future: objectives will influence decision-making — e.g. "grow Xtrend to £500" could adjust risk parameters, position sizing, and strategy selection. Agentic AI could suggest actions aligned with objectives. A GitHub issue has been created to explore this.</p>
      </div>
    </div>
  );
}
