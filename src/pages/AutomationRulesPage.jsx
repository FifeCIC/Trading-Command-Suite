import { useState } from 'react';

// ── Global Safety Rules ────────────────────────────────────
// These are hard limits — no strategy can bypass them.

const DEFAULT_RULES = [
  {
    id: 'max-spread',
    name: 'Maximum Spread Limit',
    description: 'Block any trade where the bid-ask spread exceeds X% of the symbol price. Protects against trading during high-volatility illiquid periods.',
    config: { threshold: 0.5, unit: '%' },
    enabled: true,
  },
  {
    id: 'max-position-size',
    name: 'Maximum Position Size',
    description: 'Hard limit on position size per symbol as a percentage of total portfolio. Prevents over-concentration in any single position.',
    config: { threshold: 15, unit: '% of portfolio' },
    enabled: true,
  },
  {
    id: 'min-sees-score',
    name: 'Minimum SEES Score',
    description: 'Require a minimum aggregate SEES score before any BUY signal can execute. Score threshold applies globally across all strategies.',
    config: { threshold: 60, unit: 'score (0-100)' },
    enabled: false,
  },
];

export default function AutomationRulesPage() {
  const [rules, setRules] = useState(() => {
    try {
      const saved = localStorage.getItem('tcs:automation-rules');
      return saved ? JSON.parse(saved) : DEFAULT_RULES;
    } catch {
      return DEFAULT_RULES;
    }
  });

  function toggleRule(id) {
    setRules((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
      localStorage.setItem('tcs:automation-rules', JSON.stringify(next));
      return next;
    });
  }

  return (
    <div className="pf-page">
      <div className="pf-header">
        <div>
          <h1>Automation Rules</h1>
          <p className="pf-hint" style={{ margin: 0 }}>
            Global safety rails — these are hard limits that no strategy can bypass.
          </p>
        </div>
      </div>

      <div className="pf-section">
        {rules.map((rule) => (
          <div key={rule.id} className="pf-account-detail" style={{ marginBottom: '0.75rem', padding: '0.75rem 1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem' }}>{rule.name}</h3>
                <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                  {rule.description}
                </p>
                <div className="pf-hint">
                  Threshold: <strong>{rule.config.threshold}{rule.config.unit}</strong>
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => toggleRule(rule.id)}
                />
                <span style={{ fontSize: '0.82rem', color: rule.enabled ? '#22c55e' : 'var(--ink-soft)' }}>
                  {rule.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="pf-section">
        <h2>How Rules Work</h2>
        <ul style={{ color: 'var(--ink-soft)', fontSize: '0.85rem', paddingLeft: '1.25rem', lineHeight: 1.6 }}>
          <li>Rules are evaluated <strong>before</strong> any trade order is sent</li>
          <li>If any enabled rule blocks the trade, the order is rejected with a reason</li>
          <li>Rules apply globally — they cannot be overridden by individual strategies</li>
          <li>Strategy-specific parameters (stop-loss, take-profit, entry thresholds) belong in Strategy Configuration, not here</li>
          <li>New rule types can be added as the system matures (e.g., max daily loss, max correlation exposure)</li>
        </ul>
      </div>
    </div>
  );
}
