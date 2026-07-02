import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { usePreferences } from '../core/hooks/usePreferences';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './risk-controls.css';

function Gauge({ value, max, label, color, icon }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="rc-gauge">
      <div className="rc-gauge-ring" style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, var(--line) ${pct * 3.6}deg)` }}>
        <span className="rc-gauge-icon">{icon}</span>
      </div>
      <span className="rc-gauge-value" style={{ color }}>{typeof value === 'number' ? value.toFixed(1) : value}{label === 'Drawdown' || label === 'Exposure' ? '%' : ''}</span>
      <span className="rc-gauge-label">{label}</span>
    </div>
  );
}

function GateCard({ title, config, icon, color }) {
  const entries = Object.entries(config).filter(([, v]) => typeof v !== 'boolean' && !Array.isArray(v) && typeof v !== 'object');
  const arrays = Object.entries(config).filter(([, v]) => Array.isArray(v));
  return (
    <div className="rc-gate-card" style={{ borderTopColor: color }}>
      <h3 className="rc-gate-title">{icon} {title}</h3>
      <div className="rc-gate-grid">
        {entries.map(([k, v]) => (
          <div key={k} className="rc-gate-kv">
            <span className="rc-gate-key">{k.replace(/([A-Z])/g, ' $1').trim()}</span>
            <span className="rc-gate-val">{typeof v === 'number' ? (v < 1 ? (v * 100).toFixed(0) + '%' : v.toLocaleString()) : String(v)}</span>
          </div>
        ))}
      </div>
      {arrays.map(([k, arr]) => arr.length > 0 && (
        <div key={k} className="rc-gate-tags">
          <span className="rc-tag-label">{k}:</span>
          {arr.map((item, i) => <span key={i} className="rc-tag">{item}</span>)}
        </div>
      ))}
    </div>
  );
}

export default function RiskControlsPage() {
  const { prefs } = usePreferences();
  const overviewQuery = useQuery({
    queryKey: ['risk-overview'],
    queryFn: () => apiGet('/api/risk/overview'),
    refetchInterval: 30000,
  });

  const data = overviewQuery.data || {};
  const health = data.portfolioHealth || {};
  const limits = data.riskLimits || {};
  const gateConfig = data.gateConfig || { thresholds: {}, scope: {}, positions: {} };
  const gateStatus = data.gateStatus || { gates: { threshold: {}, scope: {}, position: {} } };
  const circuit = data.circuitBreaker || { state: 'READY', triggers: [] };

  // Merge API limits with user preferences
  const effectiveLimits = useMemo(() => ({
    maxPortfolioRisk: limits.maxPortfolioRisk ?? prefs.riskMaxDrawdown / 100,
    maxPerTradeRisk: limits.maxPerTradeRisk ?? prefs.riskMaxPerTrade / 100,
    maxPerSymbol: limits.maxPerSymbol ?? prefs.riskMaxPerSymbol / 100,
    maxPositions: limits.maxPositions ?? prefs.riskMaxPositions,
    maxDrawdown: limits.maxDrawdown ?? prefs.riskMaxDrawdown / 100,
    trailingStopAtProfit: limits.trailingStopAtProfit ?? 0.03,
  }), [limits, prefs]);

  const drawdownColor = health.drawdown > prefs.circuitBreakerDrawdownTrigger ? '#ef4444' : health.drawdown > prefs.circuitBreakerDrawdownTrigger * 0.6 ? '#f59e0b' : '#22c55e';
  const circuitColor = circuit.state === 'TRIPPED' ? '#ef4444' : '#22c55e';

  if (overviewQuery.isLoading) return <div className="rc-page"><LoadingSkeleton variant="card" count={4} /></div>;

  return (
    <div className="rc-page">
      <motion.header className="rc-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Risk Controls</h1>
          <p className="rc-subtitle">Central guardrails — exposure caps, drawdown limits, circuit breakers, kill switch.</p>
        </div>
        <span className="rc-clock">{data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : '—'}</span>
      </motion.header>

      {overviewQuery.isError && <ApiOfflineBanner />}

      {/* ── Top Gauges ── */}
      <motion.div className="rc-gauges" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <Gauge value={health.drawdown || 0} max={prefs.riskMaxDrawdown} label="Drawdown" color={drawdownColor} icon="📉" />
        <Gauge value={health.totalExposure || 0} max={prefs.riskMaxPositions} label="Exposure" color={health.totalExposure > prefs.riskMaxPositions ? '#ef4444' : '#22c55e'} icon="📊" />
        <Gauge value={health.dailyPnl || 0} max={1000} label="Daily P&L" color={health.dailyPnl >= 0 ? '#22c55e' : '#ef4444'} icon="💵" />

        {/* Circuit Breaker */}
        <motion.div
          className={`rc-circuit ${circuit.state === 'TRIPPED' ? 'rc-tripped' : 'rc-ready'}`}
          whileHover={{ scale: 1.03 }}
        >
          <div className="rc-circuit-icon">{circuit.state === 'TRIPPED' ? '⛔' : '✅'}</div>
          <span className="rc-circuit-state" style={{ color: circuitColor }}>{circuit.state}</span>
          <span className="rc-circuit-label">Circuit Breaker</span>
          {circuit.triggers?.length > 0 && (
            <div className="rc-circuit-triggers">
              {circuit.triggers.map((t, i) => <span key={i} className="rc-trigger-tag">{t}</span>)}
            </div>
          )}
        </motion.div>
      </motion.div>

      {/* ── Portfolio Health ── */}
      <motion.section className="rc-section" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        <h2>Portfolio Health</h2>
        <div className="rc-health-grid">
          <div className="rc-health-card">
            <span className="rc-health-val">{health.positionCount || 0}</span>
            <span className="rc-health-lbl">Positions</span>
          </div>
          <div className="rc-health-card">
            <span className="rc-health-val" style={{ color: (health.totalPositionPnl || 0) >= 0 ? '#22c55e' : '#ef4444' }}>
              {(health.totalPositionPnl || 0) >= 0 ? '+' : ''}{(health.totalPositionPnl || 0).toFixed(0)}
            </span>
            <span className="rc-health-lbl">Position P&L</span>
          </div>
          <div className="rc-health-card">
            <span className="rc-health-val" style={{ color: (health.tradeTotalPnl || 0) >= 0 ? '#22c55e' : '#ef4444' }}>
              {(health.tradeTotalPnl || 0) >= 0 ? '+' : ''}{(health.tradeTotalPnl || 0).toFixed(0)}
            </span>
            <span className="rc-health-lbl">Trade P&L</span>
          </div>
          <div className="rc-health-card">
            <span className="rc-health-val" style={{ color: drawdownColor }}>{health.drawdown || 0}%</span>
            <span className="rc-health-lbl">Max Drawdown</span>
          </div>
        </div>
        {health.riskWarnings?.length > 0 && (
          <div className="rc-warnings">
            {health.riskWarnings.map((w, i) => (
              <div key={i} className="rc-warning-row">{w.startsWith('Drawdown') ? '🔴' : '⚠️'} {w}</div>
            ))}
          </div>
        )}
      </motion.section>

      {/* ── Risk Limits ── */}
      <motion.section className="rc-section" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h2>Risk Limits</h2>
        <div className="rc-limits-grid">
          {Object.entries(effectiveLimits).map(([k, v]) => (
            <div key={k} className="rc-limit-row">
              <span className="rc-limit-key">{k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</span>
              <span className="rc-limit-val">{typeof v === 'number' && v < 1 ? (v * 100).toFixed(0) + '%' : v}</span>
            </div>
          ))}
        </div>
      </motion.section>

      {/* ── Trading Gates ── */}
      <motion.section className="rc-section" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <h2>Trading Gates {gateConfig.enabled ? <span className="rc-badge-on">ACTIVE</span> : <span className="rc-badge-off">DISABLED</span>}</h2>
        <div className="rc-gates-grid">
          <GateCard title="Threshold Gate" config={gateStatus.gates?.threshold || gateConfig.thresholds || {}} icon="🎯" color="#22c55e" />
          <GateCard title="Scope Gate" config={gateStatus.gates?.scope || gateConfig.scope || {}} icon="🔍" color="#3b82f6" />
          <GateCard title="Position Gate" config={gateStatus.gates?.position || gateConfig.positions || {}} icon="📋" color="#8b5cf6" />
        </div>
      </motion.section>

      {/* ── Kill Switch Log ── */}
      <motion.section className="rc-section" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
        <h2>Kill Switch Log</h2>
        {circuit.state === 'READY' ? (
          <p className="rc-empty">No kill switch events. Circuit breaker is armed and monitoring.</p>
        ) : (
          <div className="rc-kill-log">
            <div className="rc-kill-event">
              <span className="rc-kill-time">{new Date().toLocaleTimeString()}</span>
              <span className="rc-kill-reason">Circuit breaker tripped — manual review required before trading resumes.</span>
            </div>
          </div>
        )}
      </motion.section>
    </div>
  );
}
