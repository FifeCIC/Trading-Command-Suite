import { useState } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './personal-finances.css';
import PageInfoPopover from '../components/PageInfoPopover';

const CURRENCY_SYMBOL = '£';

export default function PersonalFinancesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', currency: 'GBP', source: 'earnings', notes: '' });

  const { data: allocations, isLoading, isError } = useQuery({
    queryKey: ['planner', 'allocations'],
    queryFn: () => apiGet('/api/planner/allocations'),
    refetchInterval: 60000,
  });

  const createMutation = useMutation({
    mutationFn: (body) => apiPost('/api/planner/allocations', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['planner', 'allocations'] }); setShowForm(false); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => apiDelete(`/api/planner/allocations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['planner', 'allocations'] }),
  });

  const resetForm = () => setForm({ name: '', amount: '', currency: 'GBP', source: 'earnings', notes: '' });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.amount) return;
    createMutation.mutate({
      name: form.name.trim(),
      amount: parseFloat(form.amount),
      currency: form.currency,
      source: form.source,
      notes: form.notes || null,
    });
  };

  const totalAllocated = (allocations || []).reduce((sum, a) => sum + (a.amount || 0), 0);
  const items = allocations || [];

  return (
    <div className="pf-page">
      <motion.header className="pf-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Personal Finances
          <PageInfoPopover>
            Plan fund allocation across trading accounts and strategies. Visual planning only — no automatic transfers.
          </PageInfoPopover>
        </h1>
      </motion.header>

      {isError && <ApiOfflineBanner />}
      {isLoading && <LoadingSkeleton variant="text" lines={4} />}

      <div className="pf-summary-bar">
        <div className="pf-summary-item">
          <span className="pf-summary-label">Total Allocated</span>
          <span className="pf-summary-value">{CURRENCY_SYMBOL}{totalAllocated.toFixed(2)}</span>
        </div>
        <div className="pf-summary-item">
          <span className="pf-summary-label">Plans</span>
          <span className="pf-summary-value">{items.length}</span>
        </div>
        <button className="pf-add-btn" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New Allocation'}
        </button>
      </div>

      {showForm && (
        <motion.form className="pf-form" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} onSubmit={handleSubmit}>
          <div className="pf-form-row">
            <input className="pf-input" placeholder="Plan name (e.g. January Salary Split)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="pf-input pf-input-sm" type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            <select className="pf-select" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              <option value="earnings">Earnings</option>
              <option value="bonus">Bonus</option>
              <option value="savings">Savings Transfer</option>
              <option value="dividends">Dividends</option>
              <option value="other">Other</option>
            </select>
          </div>
          <textarea className="pf-textarea" placeholder="Notes (optional) — e.g. which accounts/strategies to split across" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <button className="pf-submit-btn" type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Saving...' : 'Save Allocation Plan'}
          </button>
        </motion.form>
      )}

      {!isLoading && items.length === 0 && (
        <div className="pf-empty">
          <p>No allocation plans yet.</p>
          <p className="pf-hint">Add a plan to start tracking how you intend to split funds across accounts and strategies.</p>
        </div>
      )}

      <div className="pf-list">
        {items.map((item, i) => (
          <motion.div key={item.id} className="pf-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            <div className="pf-card-header">
              <span className="pf-card-name">{item.name}</span>
              <span className="pf-card-amount">{CURRENCY_SYMBOL}{item.amount.toFixed(2)}</span>
              <button className="pf-delete-btn" onClick={() => deleteMutation.mutate(item.id)} title="Delete">×</button>
            </div>
            <div className="pf-card-meta">
              <span className="pf-tag">{item.source}</span>
              <span className="pf-tag">{item.currency}</span>
              <span className="pf-date">{new Date(item.createdAt).toLocaleDateString()}</span>
            </div>
            {item.notes && <p className="pf-card-notes">{item.notes}</p>}
            {item.allocations && item.allocations.length > 0 && (
              <div className="pf-allocations">
                {item.allocations.map((a, ai) => (
                  <div key={ai} className="pf-allocation-chip">
                    {a.account || a.strategy || 'Unassigned'}: {a.percentage || Math.round((a.amount / item.amount) * 100)}%
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        ))}
      </div>

      <div className="pf-future-note">
        <p>💡 Future: automatic fund transfers, strategy-linked allocation suggestions, and pie-level distribution tracking.</p>
      </div>
    </div>
  );
}
