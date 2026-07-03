/**
 * PreferenceLab — Lab-area standalone preferences viewer/editor.
 * Surfaces ALL preferences from usePreferences() in one view.
 * Route: /lab/preference-lab
 */
import { usePreferences } from '../core/hooks/usePreferences';
import './preference-lab.css';

const SECTIONS = {
  trading: {
    label: 'Trading Defaults',
    keys: ['defaultSignalSymbols', 'defaultProtocol'],
  },
  risk: {
    label: 'Risk Limits',
    keys: [
      'riskMaxDrawdown', 'riskMaxPositions', 'riskMaxPerSymbol',
      'riskMaxPerTrade', 'circuitBreakerDrawdownTrigger', 'circuitBreakerExposureTrigger',
    ],
  },
  refresh: {
    label: 'Refresh Intervals',
    keys: ['signalsRefreshInterval', 'researchRefreshInterval', 'signalsAutoRefresh'],
  },
  display: {
    label: 'Display',
    keys: ['defaultTimeframe', 'decimalPlaces', 'compactMode'],
  },
  performance: {
    label: 'Performance',
    keys: ['pollingInterval', 'chartAnimation'],
  },
  degradation: {
    label: 'Provider Degradation',
    keys: [
      'degradationNotify', 'degradationPauseAutomation',
      'degradationCloseProfitable', 'degradationAdjustStops',
      'degradationMinProviderHealth',
    ],
  },
};

const LABELS = {
  defaultSignalSymbols: 'Default Signal Symbols',
  defaultProtocol: 'Default Protocol',
  riskMaxDrawdown: 'Max Drawdown (%)',
  riskMaxPositions: 'Max Positions',
  riskMaxPerSymbol: 'Max Per Symbol (%)',
  riskMaxPerTrade: 'Max Per Trade Risk (%)',
  circuitBreakerDrawdownTrigger: 'CB Drawdown Trigger (%)',
  circuitBreakerExposureTrigger: 'CB Exposure Trigger (%)',
  signalsRefreshInterval: 'Signals Refresh (ms)',
  researchRefreshInterval: 'Research Refresh (ms)',
  signalsAutoRefresh: 'Signals Auto-Refresh',
  defaultTimeframe: 'Default Timeframe',
  decimalPlaces: 'Decimal Places',
  compactMode: 'Compact Mode',
  pollingInterval: 'Polling Interval (s)',
  chartAnimation: 'Chart Animation',
  degradationNotify: 'Notify on Degradation',
  degradationPauseAutomation: 'Pause Automation When Degraded',
  degradationCloseProfitable: 'Close Profitable on Degradation',
  degradationAdjustStops: 'Adjust Stops on Degradation',
  degradationMinProviderHealth: 'Min Provider Health (%)',
};

function formatVal(key, val) {
  if (key === 'signalsRefreshInterval' || key === 'researchRefreshInterval') return `${Math.round(val / 1000)}s`;
  if (key === 'compactMode' || key === 'signalsAutoRefresh' || key === 'chartAnimation'
    || key === 'degradationNotify' || key === 'degradationPauseAutomation'
    || key === 'degradationCloseProfitable' || key === 'degradationAdjustStops') return val ? '✅ On' : '❌ Off';
  if (key === 'riskMaxPerTrade') return val.toFixed(1);
  return String(val);
}

export default function PreferenceLab() {
  const { prefs, set, reset, defaults } = usePreferences();

  return (
    <div className="plab-page">
      <header className="plab-header">
        <h1>Preference Lab</h1>
        <p className="plab-subtitle">All user preferences in one view. Stored in localStorage under <code>tcs:preferences</code>.</p>
      </header>

      <div className="plab-grid">
        {Object.entries(SECTIONS).map(([sectionId, section]) => (
          <section key={sectionId} className="plab-card">
            <h2 className="plab-card-title">{section.label}</h2>
            <table className="plab-table">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Current</th>
                  <th>Default</th>
                </tr>
              </thead>
              <tbody>
                {section.keys.map((key) => (
                  <tr key={key}>
                    <td className="plab-key">{LABELS[key] || key}</td>
                    <td className={`plab-val ${prefs[key] !== defaults[key] ? 'plab-custom' : ''}`}>
                      {formatVal(key, prefs[key])}
                    </td>
                    <td className="plab-default">{formatVal(key, defaults[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <div className="plab-footer">
        <button className="plab-btn" onClick={() => { if (window.confirm('Reset all preferences to defaults?')) reset(); }}>
          ↺ Reset All to Defaults
        </button>
        <span className="plab-hint">Changes take effect immediately and persist across sessions.</span>
      </div>
    </div>
  );
}
