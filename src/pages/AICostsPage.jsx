/**
 * AI Cost Monitoring Page
 * ========================
 * Track DeepSeek API usage, costs, and cost-vs-P&L ratio.
 * When the backend api_usage table and endpoints are ready,
 * this page will auto-populate with real data.
 *
 * Endpoints (pending backend):
 *   GET  /api/ai/usage?period=today|week|month
 *   GET  /api/ai/usage/breakdown
 *   POST /api/ai/usage/settings  (budget caps, feature toggles)
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import Notice from '../components/Notice';
import './ai-costs.css';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

const FEATURES = [
  { id: 'briefing', label: 'Daily Briefing', icon: '📋' },
  { id: 'analysis', label: 'Signal Analysis', icon: '🔍' },
  { id: 'explain', label: 'Trade Explanations', icon: '💡' },
  { id: 'sentiment', label: 'News Sentiment', icon: '📰' },
];

export default function AICostsPage() {
  const [period, setPeriod] = useState('today');
  const [budgetCap, setBudgetCap] = useState(5);
  const [toggles, setToggles] = useState({
    briefing: true, analysis: true, explain: true, sentiment: false,
  });

  // ── Usage data (falls back to empty when backend not ready) ──
  const usageQuery = useQuery({
    queryKey: ['ai-usage', period],
    queryFn: () => apiGet(`/api/ai/usage?period=${period}`).catch(() => null),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const usage = usageQuery.data || {};

  // ── Cost breakdown ──
  const breakdownQuery = useQuery({
    queryKey: ['ai-breakdown', period],
    queryFn: () => apiGet('/api/ai/usage/breakdown').catch(() => null),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const breakdown = breakdownQuery.data || {};

  // ── Portfolio P&L for comparison ──
  const pnlQuery = useQuery({
    queryKey: ['ai-pnl'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    refetchInterval: 60_000,
  });
  const pnl = pnlQuery.data?.balance != null ? (pnlQuery.data.equity - pnlQuery.data.balance) : 0;

  // ── Derived stats (real or zero) ──
  const totalCost = usage.totalCost || 0;
  const totalCalls = usage.totalCalls || 0;
  const totalTokens = usage.totalTokens || 0;
  const avgCostPerCall = totalCalls > 0 ? totalCost / totalCalls : 0;
  const costVsPnl = pnl !== 0 ? (totalCost / Math.abs(pnl)) * 100 : 0;

  const projectedMonthly = totalCost > 0
    ? (totalCost / (period === 'today' ? 1 : period === 'week' ? 7 : 30)) * 30
    : 0;

  // ── Budget alerts ──
  const budgetWarnings = [];
  if (totalCost > budgetCap * 0.8 && totalCost <= budgetCap) {
    budgetWarnings.push(`Approaching daily budget: $${totalCost.toFixed(2)} of $${budgetCap.toFixed(2)}`);
  }
  if (totalCost > budgetCap) {
    budgetWarnings.push(`Budget exceeded: $${totalCost.toFixed(2)} > $${budgetCap.toFixed(2)} cap`);
  }

  const isLoading = usageQuery.isLoading;

  if (isLoading) {
    return (
      <div className="ac-page">
        <header className="ac-header"><h1>AI Cost Monitoring</h1></header>
        <LoadingSkeleton variant="card" count={4} />
      </div>
    );
  }

  return (
    <div className="ac-page">
      <header className="ac-header">
        <div>
          <h1>🤖 AI Cost Monitoring</h1>
          <p className="ac-subtitle">Track DeepSeek API usage, costs, and cost-vs-P&L ratio</p>
        </div>
        <div className="ac-period-tabs">
          {PERIODS.map(p => (
            <button
              key={p.key}
              className={`ac-period-tab ${period === p.key ? 'active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >{p.label}</button>
          ))}
        </div>
      </header>

      {/* Backend not ready notice */}
      {!usageQuery.data && (
        <Notice level="info">AI usage tracking backend not yet available — showing default values. The dashboard will auto-populate when /api/ai/usage is live.</Notice>
      )}

      {budgetWarnings.map((w, i) => (
        <Notice key={i} level={i === 0 && totalCost > budgetCap ? 'critical' : 'warning'}>{w}</Notice>
      ))}

      {/* ── Cost summary cards ── */}
      <div className="ac-summary-grid">
        <div className="ac-summary-card">
          <span className="ac-summary-label">Total Cost</span>
          <span className="ac-summary-value">${totalCost.toFixed(4)}</span>
          <span className="ac-summary-note">{totalCalls} API calls · {totalTokens.toLocaleString()} tokens</span>
        </div>
        <div className="ac-summary-card">
          <span className="ac-summary-label">Avg Cost / Call</span>
          <span className="ac-summary-value">${avgCostPerCall.toFixed(4)}</span>
        </div>
        <div className="ac-summary-card">
          <span className="ac-summary-label">Cost vs P&amp;L</span>
          <span className={`ac-summary-value ${costVsPnl > 10 ? 'ac-danger' : costVsPnl > 3 ? 'ac-warn' : 'ac-ok'}`}>
            {costVsPnl.toFixed(1)}%
          </span>
          <span className="ac-summary-note">AI cost ÷ trading |P&L|</span>
        </div>
        <div className="ac-summary-card">
          <span className="ac-summary-label">Projected Monthly</span>
          <span className={`ac-summary-value ${projectedMonthly > budgetCap * 30 ? 'ac-danger' : ''}`}>
            ${projectedMonthly.toFixed(2)}
          </span>
          <span className="ac-summary-note">Based on current usage rate</span>
        </div>
      </div>

      {/* ── Two-column: Cost Breakdown + Budget Controls ── */}
      <div className="ac-two-col">
        {/* Cost breakdown by feature */}
        <section className="ac-section">
          <h2>📊 Cost by Feature</h2>
          {FEATURES.map(f => {
            const featureData = breakdown[f.id] || { cost: 0, calls: 0, tokens: 0 };
            const pct = totalCost > 0 ? (featureData.cost / totalCost) * 100 : 0;
            return (
              <div key={f.id} className="ac-feature-row">
                <div className="ac-feature-info">
                  <span className="ac-feature-icon">{f.icon}</span>
                  <span className="ac-feature-label">{f.label}</span>
                  <span className="ac-feature-toggle">
                    {toggles[f.id] ? '🟢' : '⏸'}
                  </span>
                </div>
                <div className="ac-feature-bar-wrap">
                  <div
                    className="ac-feature-bar"
                    style={{ width: `${Math.max(pct, 2)}%`, background: f.id === 'briefing' ? '#3b82f6' : f.id === 'analysis' ? '#22c55e' : f.id === 'explain' ? '#f59e0b' : '#a855f7' }}
                  />
                </div>
                <div className="ac-feature-stats">
                  <span className="ac-feature-cost">${(featureData.cost || 0).toFixed(3)}</span>
                  <span className="ac-feature-calls">{(featureData.calls || 0)} calls</span>
                </div>
              </div>
            );
          })}
          {totalCost === 0 && (
            <p className="ac-empty">No usage data for this period.</p>
          )}
        </section>

        {/* Budget controls */}
        <section className="ac-section">
          <h2>⚙️ Cost Controls</h2>
          <div className="ac-control-row">
            <label className="ac-control-label">Daily Budget Cap</label>
            <div className="ac-budget-input">
              <span>$</span>
              <input
                type="number"
                value={budgetCap}
                onChange={e => setBudgetCap(Number(e.target.value) || 0)}
                min={0}
                step={0.5}
                className="ac-input"
              />
              <span>/ day</span>
            </div>
            <div className="ac-budget-bar">
              <div
                className={`ac-budget-fill ${totalCost > budgetCap ? 'ac-over' : totalCost > budgetCap * 0.8 ? 'ac-near' : ''}`}
                style={{ width: `${Math.min(100, (totalCost / (budgetCap || 1)) * 100)}%` }}
              />
            </div>
            <span className="ac-budget-label">
              ${totalCost.toFixed(2)} / ${budgetCap.toFixed(2)}
              {totalCost > budgetCap && ' ⚠️ OVER'}
              {totalCost > budgetCap * 0.8 && totalCost <= budgetCap && ' ⚡ NEAR LIMIT'}
            </span>
          </div>

          <h3 className="ac-subhead">Feature Toggles</h3>
          {FEATURES.map(f => (
            <label key={f.id} className="ac-toggle-row">
              <span>{f.icon} {f.label}</span>
              <input
                type="checkbox"
                checked={toggles[f.id]}
                onChange={e => setToggles(prev => ({ ...prev, [f.id]: e.target.checked }))}
                className="ac-toggle"
              />
            </label>
          ))}

          <div className="ac-control-row" style={{ marginTop: 16 }}>
            <label className="ac-control-label">Max Tokens / Request</label>
            <select className="ac-select" defaultValue="4096">
              <option value="1024">1,024</option>
              <option value="2048">2,048</option>
              <option value="4096">4,096 (default)</option>
              <option value="8192">8,192</option>
            </select>
          </div>

          <div className="ac-control-row">
            <label className="ac-control-label">Cache AI Responses</label>
            <input type="checkbox" defaultChecked className="ac-toggle" />
            <span className="ac-control-hint">Avoids duplicate API calls for identical queries</span>
          </div>
        </section>
      </div>

      <p className="ac-footer">
        Auto-refresh every 60s · DeepSeek pricing: ~$0.14/1M input tokens, ~$0.28/1M output tokens
        {' · '}
        <button type="button" className="ac-refresh-link" onClick={() => usageQuery.refetch()}>
          Refresh now
        </button>
      </p>
    </div>
  );
}
