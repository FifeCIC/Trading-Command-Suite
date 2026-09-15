import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUiStore } from '../stores/useUiStore';
import { usePreferences } from '../core/hooks/usePreferences';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '../core/api/client';
import { ALL_SECTIONS } from '../components/MarketTape';
import './settings.css'

/**
 * MarketTapeSection — the ONE place tape sections are configured.
 *
 * It renders from `ALL_SECTIONS`, exported by MarketTape itself, so the settings list
 * and the tape's own render list cannot drift apart. A second hand-maintained list here
 * would be a section the user can see but never switch on.
 */
function MarketTapeSection() {
  const { prefs, set } = usePreferences();
  const on = ALL_SECTIONS.filter((s) => prefs[s.key]);
  return (
    <>
      {ALL_SECTIONS.map((s) => (
        <SettingRow key={s.key} label={s.label}>
          <div className="inline-actions">
            <button type="button" className={prefs[s.key] ? 'cta' : ''} onClick={() => set(s.key, true)}>On</button>
            <button type="button" className={!prefs[s.key] ? 'cta' : ''} onClick={() => set(s.key, false)}>Off</button>
          </div>
        </SettingRow>
      ))}
      <SettingRow
        label="Scroll speed"
        hint="Seconds for the ticker to travel one full pass. Lower is faster (2 = brisk, 30 = leisurely). This is the strip's SPEED."
      >
        <input
          type="number" min="2" max="120" step="1"
          className="settings-input settings-input-sm"
          value={prefs.tapeScrollSecPerCopy}
          onChange={(e) => set('tapeScrollSecPerCopy', Math.min(120, Math.max(2, parseInt(e.target.value, 10) || 12)))}
        />
      </SettingRow>
      <SettingRow
        label="Headline rotation"
        hint="Seconds between swapping the GLOBAL and SYMBOL news headlines. Only affects which news item is shown — it does NOT change how fast the strip moves (that is Scroll speed, above)."
      >
        <input
          type="number" min="5" max="300" step="5"
          className="settings-input settings-input-sm"
          value={prefs.newsTapeRotateSec}
          onChange={(e) => set('newsTapeRotateSec', Math.max(5, parseInt(e.target.value, 10) || 30))}
        />
      </SettingRow>
      {on.length === 0 && (
        <p className="settings-section-desc">
          Nothing is currently shown — the tape will display a hint pointing back here.
        </p>
      )}
    </>
  );
}

function SettingRow({ label, children, hint }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <strong>{label}</strong>
        {hint && <p>{hint}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

/**
 * TradeThresholdsSection — every trade threshold, with the ceiling it is compared against.
 *
 * ⚠️ WHY THIS EXISTS (2026-09-15)
 * ------------------------------
 * The app stopped trading completely on 2026-09-10 and nobody could see why. ADR-011
 * changed the percentage DENOMINATOR from the observed directional sum (~130) to the
 * configured capacity (~725-815) — about 6.3x larger — so every percentage divided by
 * that factor. Every threshold stayed on the old scale, `ENTRY_THRESHOLD = 40` classified
 * every tick as HOLD, and no trade executed for five days.
 *
 * The diagnosis had been written in code comments **three separate times**. Nobody could
 * SEE the numbers. This section is the fix for that, not for the numbers themselves: an
 * invisible threshold is one that cannot be questioned.
 *
 * The key cell is `achieved` vs `bar`. A bar above its achieved ceiling is a bot that can
 * never fire, and that should be obvious at a glance rather than inferable from a hand-run
 * SQL query.
 *
 * `no-data` is deliberately distinct from `cannot-fire`: the first means unmeasured, the
 * second means structurally blocked. Conflating them would make a merely-unmeasured bot
 * look broken — and vice versa.
 */
function TradeThresholdsSection() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['scoring-thresholds'],
    queryFn: () => apiGet('/api/scoring/gated/thresholds'),
    staleTime: 60_000,
    retry: 1,
  });

  if (isLoading) return <p className="settings-section-desc">Loading thresholds…</p>;
  if (isError || !data) {
    return (
      <p className="settings-section-desc">
        Could not load thresholds from the API. They are reported by
        <code> GET /api/scoring/gated/thresholds</code>.
      </p>
    );
  }

  const { classification, preTradeGate, bots, summary, windowDays } = data;
  const active = bots.filter((b) => b.active);

  const verdict = (c) =>
    c === 'yes' ? { text: 'clears', cls: 'threshold-ok' }
      : c === 'no' ? { text: 'CANNOT FIRE', cls: 'threshold-bad' }
        : { text: 'no data', cls: 'threshold-unknown' };

  return (
    <>
      <SettingRow
        label="Entry threshold"
        hint={`A reading is BUY/SELL at or above this, HOLD below it. Was 40 before the 2026-09-15 rescale — at which point nothing could ever clear it, so no signal was ever queued.`}
      >
        <code>{classification.entry}%</code>
      </SettingRow>
      <SettingRow
        label="Strong threshold"
        hint="A reading is STRONG_BUY / STRONG_SELL at or above this.">
        <code>{classification.strong}%</code>
      </SettingRow>
      <SettingRow
        label="What the percentages are measured against"
        hint="This is the scale that matters. When the denominator changed, every threshold below silently became unreachable.">
        <code>{classification.scale}</code>
      </SettingRow>
      <SettingRow
        label="Pre-trade gate"
        hint={`Blocks a signal whose strength is below this. Resolved as: per-protocol override → trading style → default (${preTradeGate.default}).`}>
        <code>{Object.entries(preTradeGate.byStyle).map(([k, v]) => `${k} ${v}`).join(' · ')}</code>
      </SettingRow>
      <SettingRow
        label="Bot bars"
        hint={`Each bot has its own bar (minComposite). ${summary.activeClearing} of ${summary.active} active bots have cleared theirs in the last ${windowDays} days.`}>
        <span className={summary.activeCannotFire > 0 ? 'threshold-bad' : 'threshold-ok'}>
          {summary.activeCannotFire > 0
            ? `${summary.activeCannotFire} active bot(s) CANNOT FIRE`
            : 'No active bot is structurally blocked'}
          {summary.activeNoData > 0 && ` · ${summary.activeNoData} unmeasured`}
        </span>
      </SettingRow>

      <div className="setting-row">
        <div className="setting-info" style={{ maxWidth: '100%', width: '100%' }}>
          <strong>Bot bar vs achieved ceiling</strong>
          <p>
            <code>achieved</code> is the highest composite the bot&apos;s protocol has actually
            produced in {windowDays} days. <strong>A bar above its achieved value can never
            fire.</strong>
          </p>
          <div className="threshold-table-wrap">
            <table className="threshold-table">
              <thead>
                <tr>
                  <th scope="col">Bot</th>
                  <th scope="col">Symbol</th>
                  <th scope="col">Bar</th>
                  <th scope="col">Achieved</th>
                  <th scope="col">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {active.map((b) => {
                  const v = verdict(b.clears);
                  return (
                    <tr key={`${b.name}-${b.symbol}`} className={v.cls}>
                      <td>{b.name}</td>
                      <td>{b.symbol}</td>
                      <td>{b.barPct}%</td>
                      <td>{b.achievedPct == null ? '—' : `${b.achievedPct}%`}</td>
                      <td className={v.cls}>{v.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '0.5rem' }}>
            ⚠️ <strong>A bot clearing its bar is not evidence of profit.</strong> These bars
            admit trades so they can be <em>measured</em>. Directional accuracy has been
            at or below chance — see the edge report before drawing conclusions.
          </p>
        </div>
      </div>
    </>
  );
}

export default function SettingsPage() {
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const themePack = useUiStore((state) => state.themePack);
  const showNavIcons = useUiStore((state) => state.showNavIcons);
  const setShowNavIcons = useUiStore((state) => state.setShowNavIcons);
  const qaChecks = useUiStore((state) => state.qaChecks || {});
  const resetQaChecks = useUiStore((state) => state.resetQaChecks);
  const qaCount = Object.keys(qaChecks).length;

  const { prefs, set, reset: resetPrefs } = usePreferences();

  const riskLimitsQuery = useQuery({
    queryKey: ['trading-risk-limits'],
    queryFn: () => apiGet('/api/trading/strategies/risk-limits').catch(() => null),
    staleTime: 300_000,
    retry: 1,
  });
  const serverLimits = riskLimitsQuery.data;

  // Deep-link support: the market tape's ⚙ button navigates to
  // /settings?section=market-tape. Scroll that section into view on arrival so the
  // button lands the user ON the control rather than at the top of a long page.
  const [searchParams] = useSearchParams();
  const wantSection = searchParams.get('section');
  useEffect(() => {
    if (!wantSection) return;
    const el = document.getElementById(wantSection);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [wantSection]);

  return (
    <div className="settings-page">
      <header className="settings-header">
        <p>Application configuration. More options will appear as features are built.</p>
      </header>

      <section className="settings-section">
        <h2>API Connection</h2>
        <SettingRow label="Backend URL" hint="The NestJS API endpoint the frontend calls.">
          <code>http://localhost:3201</code>
        </SettingRow>
        <SettingRow label="Auto-refresh" hint="How often live data panels refresh (seconds).">
          <code>30</code>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>Database</h2>
        <SettingRow label="Engine" hint="Currently using MySQL via Prisma 5.">
          <code>MySQL 9.1 (WAMP)</code>
        </SettingRow>
        <SettingRow label="Database" hint="Database name and host.">
          <code>tradingcs@localhost:3306</code>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>Queue</h2>
        <SettingRow label="Queue Mode" hint="Set QUEUE_MODE in nest/.env. Off means no background processing.">
          <code>off</code>
        </SettingRow>
      </section>

      {/* Placed high deliberately: on 2026-09-10 the app stopped trading because
          these numbers were invisible and unreachable. See the component docstring. */}
      <section className="settings-section" id="trade-thresholds">
        <h2>Trade Thresholds</h2>
        <p className="settings-section-desc">
          Every bar that decides whether a signal becomes a trade, with the highest score
          the protocol has actually produced. A bar above its achieved value is a bot that
          can never fire.
        </p>
        <TradeThresholdsSection />
      </section>

      <section className="settings-section">
        <h2>Theme</h2>
        <SettingRow label="Mode" hint="Light, dark, or pure black background.">
          <div className="inline-actions">
            <button
              type="button"
              className={themeMode === 'light' ? 'cta' : ''}
              onClick={() => setThemeMode('light')}
            >
              ☀ Light
            </button>
            <button
              type="button"
              className={themeMode === 'dark' ? 'cta' : ''}
              onClick={() => setThemeMode('dark')}
            >
              🌙 Dark
            </button>
            <button
              type="button"
              className={themeMode === 'black' ? 'cta' : ''}
              onClick={() => setThemeMode('black')}
            >
              ⬛ Black
            </button>
          </div>
        </SettingRow>
        <SettingRow label="Pack" hint="Active theme pack ID.">
          <code>{themePack}</code>
        </SettingRow>
        <SettingRow label="Navigation Icons" hint="Show category icons on the right side of sidebar menu items.">
          <div className="inline-actions">
            <button
              type="button"
              className={showNavIcons ? 'cta' : ''}
              onClick={() => setShowNavIcons(true)}
            >
              ◉ Show
            </button>
            <button
              type="button"
              className={!showNavIcons ? 'cta' : ''}
              onClick={() => setShowNavIcons(false)}
            >
              ✕ Hide
            </button>
          </div>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>QA Testing</h2>
        <SettingRow label="QA Checks" hint={`${qaCount} page${qaCount !== 1 ? 's' : ''} marked as QA tested on the Capability Map.`}>
          <button
            type="button"
            className="cta"
            onClick={() => { if (qaCount === 0 || window.confirm(`Reset ${qaCount} QA check${qaCount !== 1 ? 's' : ''}?`)) resetQaChecks(); }}
            disabled={qaCount === 0}
            style={qaCount === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
          >
            ↺ Reset QA Checks
          </button>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>User Preferences</h2>
        <p className="settings-section-desc">Customize defaults for the new Signals, Risk, and Research features.</p>

        <SettingRow label="Default Signal Symbols" hint="Comma-separated tickers pre-filled in Scoring Workbench.">
          <input
            type="text"
            className="settings-input"
            value={prefs.defaultSignalSymbols}
            onChange={e => set('defaultSignalSymbols', e.target.value)}
            placeholder="AAPL, NVDA, MSFT"
          />
        </SettingRow>

        <SettingRow label="Default Protocol" hint="Pre-selected protocol in Scoring Workbench and SEES pages.">
          <input
            type="text"
            className="settings-input"
            value={prefs.defaultProtocol}
            onChange={e => set('defaultProtocol', e.target.value)}
            placeholder="btc-speed-v1"
          />
        </SettingRow>

        <SettingRow label="Signals Auto-Refresh" hint="Auto-refresh the signal ladder at the interval below.">
          <div className="inline-actions">
            <button type="button" className={prefs.signalsAutoRefresh ? 'cta' : ''} onClick={() => set('signalsAutoRefresh', true)}>On</button>
            <button type="button" className={!prefs.signalsAutoRefresh ? 'cta' : ''} onClick={() => set('signalsAutoRefresh', false)}>Off</button>
          </div>
        </SettingRow>

        <SettingRow label="Signals Refresh (s)" hint="Auto-refresh interval for signal ladder.">
          <input
            type="number" min="10" max="300" step="5"
            className="settings-input settings-input-sm"
            value={Math.round(prefs.signalsRefreshInterval / 1000)}
            onChange={e => set('signalsRefreshInterval', Math.max(10000, parseInt(e.target.value, 10) * 1000))}
          />
        </SettingRow>

        <SettingRow label="Research Refresh (s)" hint="Auto-refresh interval for Research Overview dashboard.">
          <input
            type="number" min="10" max="300" step="5"
            className="settings-input settings-input-sm"
            value={Math.round(prefs.researchRefreshInterval / 1000)}
            onChange={e => set('researchRefreshInterval', Math.max(10000, parseInt(e.target.value, 10) * 1000))}
          />
        </SettingRow>

        <h3 className="settings-subheading">Risk Limits</h3>

        <SettingRow label="Max Drawdown (%)" hint="Circuit breaker trips when drawdown exceeds this.">
          <input
            type="number" min="5" max="50" step="1"
            className="settings-input settings-input-sm"
            value={prefs.riskMaxDrawdown}
            onChange={e => set('riskMaxDrawdown', parseInt(e.target.value, 10) || 25)}
          />
        </SettingRow>

        <SettingRow label="Max Positions" hint="Maximum number of concurrent open positions.">
          <input
            type="number" min="1" max="20" step="1"
            className="settings-input settings-input-sm"
            value={prefs.riskMaxPositions}
            onChange={e => set('riskMaxPositions', parseInt(e.target.value, 10) || 5)}
          />
        </SettingRow>

        <SettingRow label="Max Per Symbol (%)" hint="Maximum portfolio allocation to a single symbol.">
          <input
            type="number" min="5" max="100" step="5"
            className="settings-input settings-input-sm"
            value={prefs.riskMaxPerSymbol}
            onChange={e => set('riskMaxPerSymbol', parseInt(e.target.value, 10) || 25)}
          />
        </SettingRow>

        <SettingRow label="Max Per Trade Risk (%)" hint="Maximum portfolio risk per individual trade.">
          <input
            type="number" min="1" max="10" step="0.5"
            className="settings-input settings-input-sm"
            value={prefs.riskMaxPerTrade}
            onChange={e => set('riskMaxPerTrade', parseFloat(e.target.value) || 2)}
          />
        </SettingRow>

        <SettingRow label="CB Drawdown Trigger (%)" hint="Circuit breaker trips at this drawdown level.">
          <input
            type="number" min="5" max="40" step="1"
            className="settings-input settings-input-sm"
            value={prefs.circuitBreakerDrawdownTrigger}
            onChange={e => set('circuitBreakerDrawdownTrigger', parseInt(e.target.value, 10) || 20)}
          />
        </SettingRow>

        <SettingRow label="CB Exposure Trigger (%)" hint="Circuit breaker trips when total exposure exceeds this.">
          <input
            type="number" min="20" max="100" step="5"
            className="settings-input settings-input-sm"
            value={prefs.circuitBreakerExposureTrigger}
            onChange={e => set('circuitBreakerExposureTrigger', parseInt(e.target.value, 10) || 80)}
          />
        </SettingRow>

        {serverLimits && (
          <>
            <h3 className="settings-subheading">Server-Enforced Hard Limits</h3>
            <p className="settings-hint-text">
              These are set in <code>nest/.env</code> and require a server restart to change.
              Strategies and UI settings cannot override them.
            </p>
            <SettingRow label="Max Position Size (lots)" hint="Hard cap on any single position volume.">
              <code className="settings-limit-value">{serverLimits.maxPositionSize}</code>
            </SettingRow>
            <SettingRow label="Max Daily Loss ($)" hint="Trading halts if today's P&L drops below this.">
              <code className="settings-limit-value settings-limit-danger">${serverLimits.maxDailyLoss}</code>
            </SettingRow>
            <SettingRow label="Max Open Positions" hint="Absolute cap on concurrent positions across all strategies.">
              <code className="settings-limit-value">{serverLimits.maxOpenPositions}</code>
            </SettingRow>
            {serverLimits.note && (
              <p className="settings-note">
                ℹ️ {serverLimits.note}
              </p>
            )}
          </>
        )}

        <SettingRow label="Reset Preferences" hint="Restore all preferences to their default values.">
          <button type="button" className="cta" onClick={() => { if (window.confirm('Reset all preferences to defaults?')) resetPrefs(); }}>
            ↺ Reset to Defaults
          </button>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>Display</h2>
        <SettingRow label="Default Timeframe" hint="Default chart timeframe for Speed Charts and scanners.">
          <select className="settings-select" value={prefs.defaultTimeframe} onChange={e => set('defaultTimeframe', e.target.value)}>
            {['1m','5m','15m','30m','1h','4h','1d','1w'].map(tf => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </SettingRow>
        <SettingRow label="Decimal Places" hint="Number of decimal places for price display.">
          <input type="number" min="0" max="6" step="1" className="settings-input settings-input-sm"
            value={prefs.decimalPlaces} onChange={e => set('decimalPlaces', parseInt(e.target.value, 10) || 2)} />
        </SettingRow>
        <SettingRow label="Compact Mode" hint="Reduce padding and font sizes for higher information density.">
          <div className="inline-actions">
            <button type="button" className={prefs.compactMode ? 'cta' : ''} onClick={() => set('compactMode', true)}>On</button>
            <button type="button" className={!prefs.compactMode ? 'cta' : ''} onClick={() => set('compactMode', false)}>Off</button>
          </div>
        </SettingRow>

        <SettingRow label="Experience Level" hint="Controls which views and features are visible. Beginner hides advanced tools. Expert unlocks everything.">
          <select
            className="settings-select"
            value={prefs.experienceLevel || 'beginner'}
            onChange={e => set('experienceLevel', e.target.value)}
          >
            <option value="beginner">Beginner — core pages, simplified trading</option>
            <option value="experienced">Experienced — scoring, strategies, research</option>
            <option value="expert">Expert — full access, automation, builder tools</option>
          </select>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>Automation</h2>
        <SettingRow label="Auto-Start on Server Boot" hint="When ON, the automation loop and MT5 trading state are restored automatically when the server starts. When OFF, you must manually start via the Automation Dashboard.">
          <div className="inline-actions">
            <button type="button" className={prefs.autoStartAutomation ? 'cta' : ''} onClick={() => set('autoStartAutomation', true)}>On</button>
            <button type="button" className={!prefs.autoStartAutomation ? 'cta' : ''} onClick={() => set('autoStartAutomation', false)}>Off</button>
          </div>
        </SettingRow>

        <AutomationRulesSection />
        <MetaStackControlSection />
      </section>

      <section className="settings-section" id="market-tape">
        <h2>Market Tape</h2>
        <p className="settings-section-desc">
          Choose which sections appear in the ticker at the top of the app. The ⚙ button on the
          tape links straight here. Everything is off-by-default for new sections so the tape
          never silently grows wider than you asked for.
        </p>
        <MarketTapeSection />
      </section>

      <section className="settings-section">
        <h2>Performance</h2>
        <SettingRow label="Polling Interval" hint="Default polling interval for live data panels (seconds).">
          <input type="number" min="5" max="120" step="5" className="settings-input settings-input-sm"
            value={prefs.pollingInterval} onChange={e => set('pollingInterval', Math.max(5, parseInt(e.target.value, 10) || 30))} />
        </SettingRow>
        <SettingRow label="Chart Animation" hint="Enable animations on chart components.">
          <div className="inline-actions">
            <button type="button" className={prefs.chartAnimation ? 'cta' : ''} onClick={() => set('chartAnimation', true)}>On</button>
            <button type="button" className={!prefs.chartAnimation ? 'cta' : ''} onClick={() => set('chartAnimation', false)}>Off</button>
          </div>
        </SettingRow>
      </section>

      <HealthChecksSection />

      <section className="settings-section">
        <h2>Security</h2>
        <SettingRow label="CORS Origin" hint="Allowed cross-origin request origin.">
          <code>http://localhost:5173</code>
        </SettingRow>
        <SettingRow label="Localhost Only" hint="Restrict API to localhost connections.">
          <code>off</code>
        </SettingRow>
        <SettingRow label="API Key Rotation" hint="Days until API key expiry warning.">
          <code>90</code>
        </SettingRow>
      </section>

      <footer className="settings-footer">
        <p>Settings are read from environment files and app configuration. Changes to backend settings require a restart.</p>
        <p>Documentation: <code>nest/README.md</code> and <code>nest/.env</code></p>
      </footer>
    </div>
  )
}

function HealthChecksSection() {
  const qc = useQueryClient();
  const { data: hc } = useQuery({
    queryKey: ['settings-health-checks'],
    queryFn: () => apiGet('/api/system/settings/health-checks').catch(() => null),
    staleTime: 30_000,
  });

  const toggle = async (key) => {
    if (!hc) return;
    const updated = { ...hc, [key]: !hc[key] };
    await apiPut('/api/system/settings/health-checks', { [key]: !hc[key] });
    qc.setQueryData(['settings-health-checks'], updated);
  };

  const setRefresh = async (sec) => {
    if (!hc) return;
    const updated = { ...hc, autoRefreshSec: sec };
    await apiPut('/api/system/settings/health-checks', { autoRefreshSec: sec });
    qc.setQueryData(['settings-health-checks'], updated);
  };

  const CHECK_LABELS = {
    systemVitals: 'System Vitals', dbDiagnostics: 'DB Table Diagnostics', slowQueries: 'Slow Query Detection',
    apiTrends: 'API Response Trends', providerGrid: 'Provider Health Grid', traceCorrelations: 'Trace Correlations',
    diskInfo: 'Disk Space Monitor', errorRates: 'Error Rate Tracking', cronHeartbeats: 'Cron Heartbeat Monitor',
    portStatus: 'Port Status Check',
  };

  return (
    <section className="settings-section">
      <h2>🩺 Health & Diagnostics</h2>
      <p className="settings-health-desc">
        Enable or disable individual health checks. Disabled checks skip their queries entirely — useful for reducing load or silencing known issues.
      </p>
      {Object.entries(CHECK_LABELS).map(([key, label]) => (
        <SettingRow key={key} label={label} hint={`Run ${label.toLowerCase()} check on the Health Dashboard.`}>
          <div className="inline-actions">
            <button type="button" className={(hc?.[key] !== false) ? 'cta' : ''} onClick={() => toggle(key)}>
              {(hc?.[key] !== false) ? 'On' : 'Off'}
            </button>
          </div>
        </SettingRow>
      ))}
      <SettingRow label="Auto-Refresh" hint="How often the Health Dashboard refreshes (seconds). Min 5, max 120.">
        <input type="number" min="5" max="120" step="5" className="settings-input settings-input-sm"
          value={hc?.autoRefreshSec ?? 15} onChange={e => setRefresh(Math.max(5, parseInt(e.target.value, 10) || 15))} />
      </SettingRow>
      <p className="settings-footnote">
        See <a href="/status/health-check">Health Dashboard</a> for live diagnostics.
      </p>
    </section>
  );
}

/** #615 — META.Stack layer kill switches: Protocols / Trading. */
function MetaStackControlSection() {
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ['automation-layers'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 15_000,
  });
  const layers = status?.layers || { protocolsEnabled: true, tradingEnabled: false };
  const toggle = async (layer, enabled) => {
    await apiPost('/api/automation/layer', { layer, enabled }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['automation-layers'] });
  };
  return (
    <>
      <h3 style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--ink-soft)' }}>META.Stack Control</h3>
      <SettingRow
        label="Protocols / Scoring"
        hint="OFF stops protocol scoring entirely — no scoring, no signals, no trading. ON resumes the pipeline."
      >
        <div className="inline-actions">
          <button type="button" className={layers.protocolsEnabled ? 'cta' : ''} onClick={() => toggle('protocols', true)}>On</button>
          <button type="button" className={!layers.protocolsEnabled ? 'cta' : ''} onClick={() => toggle('protocols', false)}>Off</button>
        </div>
      </SettingRow>
      <SettingRow
        label="Trading"
        hint="OFF keeps scoring and signals but blocks every dispatch. Defaults OFF after every restart — no restart can silently re-enable trading."
      >
        <div className="inline-actions">
          <button type="button" className={layers.tradingEnabled ? 'cta' : ''} onClick={() => toggle('trading', true)}>On</button>
          <button type="button" className={!layers.tradingEnabled ? 'cta' : ''} onClick={() => toggle('trading', false)}>Off</button>
        </div>
      </SettingRow>
    </>
  );
}

function AutomationRulesSection() {  const { data } = useQuery({
    queryKey: ['automation-rules-settings'],
    queryFn: () => apiGet('/api/automation/rules').catch(() => []),
    staleTime: 60_000,
  });
  const rules = Array.isArray(data) ? data : [];
  return (
    <>
      <h3 style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--ink-soft)' }}>Automation Rules</h3>
      {rules.length === 0 ? (
        <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', margin: '0.25rem 0' }}>
          No automation rules configured. Rules are seeded from the database.
        </p>
      ) : (
        rules.map((rule) => (
          <SettingRow key={rule.id} label={rule.name} hint={rule.description}>
            <div className="inline-actions">
              <button type="button" className={rule.enabled ? 'cta' : ''} onClick={() => {
                apiGet(`/api/automation/rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !rule.enabled }) });
              }}>
                {rule.enabled ? 'On' : 'Off'}
              </button>
            </div>
          </SettingRow>
        ))
      )}
    </>
  );
}

