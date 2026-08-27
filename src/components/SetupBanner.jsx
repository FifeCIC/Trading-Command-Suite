/**
 * SetupBanner — first-run onboarding prompt.
 * ===========================================
 * Shows a modern setup card on the dashboard when the backend reports
 * that the app hasn't been fully configured (no protocols, strategies,
 * watchlists, or providers).
 *
 * Auto-hides when all checks pass. Dismissible by the user.
 *
 * Data: GET /api/health/setup
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { motion, AnimatePresence } from 'motion/react';
import './setup-banner.css';

const STEPS = [
  {
    id: 'hasProviders',
    icon: '🔌',
    label: 'Connect a provider',
    desc: 'Add MT5 or Trading212 API keys to .env',
    href: '/settings',
  },
  {
    id: 'hasWatchlists',
    icon: '📋',
    label: 'Create a watchlist',
    desc: 'Define which symbols to monitor',
    href: '/watchlists/user-watchlists',
  },
  {
    id: 'hasProtocols',
    icon: '🧩',
    label: 'Build a protocol',
    desc: 'Choose directives and scoring rules',
    href: '/scoring/protocol-builder',
  },
  {
    id: 'hasStrategies',
    icon: '⚙',
    label: 'Create Trading Strategy',
    desc: 'Bind a protocol to a symbol with thresholds and sizing',
    href: '/trading/strategy-create',
  },
];

export default function SetupBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => apiGet('/api/health/setup').catch(() => ({ ready: true, checks: {} })),
    staleTime: 30_000,
    refetchInterval: 15_000,
  });

  if (isLoading || dismissed || !data || data.ready) return null;

  const remaining = STEPS.filter(s => !data.checks[s.id]);

  return (
    <AnimatePresence>
      <motion.div
        className="sb-banner"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
      >
        <div className="sb-content">
          <div className="sb-header">
            <span className="sb-icon">🚀</span>
            <div>
              <h2 className="sb-title">Welcome to Trading Command Suite</h2>
              <p className="sb-subtitle">
                {remaining.length === 4
                  ? "Let's get you set up in a few steps."
                  : `${remaining.length} step${remaining.length !== 1 ? 's' : ''} remaining — almost there.`}
              </p>
            </div>
          </div>

          <div className="sb-steps">
            {STEPS.map((step, i) => {
              const done = data.checks[step.id];
              return (
                <a
                  key={step.id}
                  href={step.href}
                  className={`sb-step ${done ? 'sb-step-done' : ''}`}
                  style={{ animationDelay: `${i * 0.1}s` }}
                >
                  <span className="sb-step-icon">{done ? '✓' : step.icon}</span>
                  <span className="sb-step-label">{step.label}</span>
                  <span className="sb-step-desc">{step.desc}</span>
                </a>
              );
            })}
          </div>

          <button className="sb-dismiss" onClick={() => setDismissed(true)} title="Dismiss setup guide">
            Dismiss
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
