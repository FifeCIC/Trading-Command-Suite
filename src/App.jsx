import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analytics, trackAppView, trackSupportClick } from './analytics';
import DevOverlay from './components/DevOverlay';
import { apiGet } from './core/api/client';
import { FEATURE_FLAGS } from './core/features/flags';
import { withDevTag } from './dev-runtime/tags';
import { getPerformanceSnapshot, startPerformanceMonitoring } from './performance/monitor';
import ArchitectureFrameworkPage from './pages/ArchitectureFrameworkPage';
import DatabaseTablesPage from './pages/DatabaseTablesPage';
import SeesLiveStackMockPage from './pages/SeesLiveStackMockPage';
import SetupWizardPage from './pages/SetupWizardPage';
import SettingsPage from './pages/SettingsPage';
import SymbolsBrowserPage from './pages/SymbolsBrowserPage';
import SystemStatusPage from './pages/SystemStatusPage';
import ThemePage from './pages/ThemePage';
import { useUiStore } from './stores/useUiStore';
import { useThemeRuntime } from './theme/useThemeRuntime';

const NAV_STRUCTURE = {
  showcase: [
    { id: 'overview', label: 'Overview' },
    { id: 'demos', label: 'Live Demo' },
    { id: 'use-cases', label: 'Use Cases' }
  ],
  builder: [
    { id: 'architecture-framework', label: 'Architecture' },
    { id: 'theme-lab', label: 'Theme Lab' },
    { id: 'component-lab', label: 'Component Lab' },
    { id: 'runtime', label: 'Dev Runtime' }
  ],
  trading: [
    { id: 'sees-live-stack', label: 'SEES Live Stack' },
    { id: 'symbols-browser', label: 'Symbols' }
  ],
  data: [
    { id: 'database-tables', label: 'Tables' }
  ],
  theme: [
    { id: 'theme-packs', label: 'Theme Packs' }
  ],
  ops: [
    { id: 'setup', label: 'Setup' },
    { id: 'status', label: 'System Status' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'security', label: 'Security' }
  ],
  community: [
    { id: 'about', label: 'About' },
    { id: 'settings', label: 'Settings' },
    { id: 'roadmap', label: 'Roadmap' },
    { id: 'support', label: 'Support' }
  ]
};

const THEME_CARDS = [
  { id: 'core', name: 'Core', description: 'Clean, neutral palette.', colors: ['#f4f7fb', '#0ea5a6', '#0f172a'] },
  { id: 'oceanic', name: 'Oceanic', description: 'Deep blue with teal.', colors: ['#0f1b2e', '#00d9ff', '#d6e8ff'] },
  { id: 'scifi', name: 'Sci-Fi', description: 'Dark navy, cyan neon.', colors: ['#0a1428', '#00d9ff', '#c1d0e0'] },
  { id: 'terminal', name: 'Terminal', description: 'Black, neon green.', colors: ['#0a0a0a', '#00ff41', '#e0e0e0'] },
  { id: 'void', name: 'Void', description: 'Black, neon purple.', colors: ['#08080d', '#8a50ff', '#d4d0e8'] },
];

function BadgePill({ label, status = 'neutral' }) {
  return <span className={`badge-pill badge-${status}`}>{label}</span>;
}

function ContentCard({ title, children }) {
  return (
    <article className="content-card">
      <h3>{title}</h3>
      <div>{children}</div>
    </article>
  );
}

export default function App() {
  const [primaryArea, setPrimaryArea] = useState('showcase');
  const [secondaryView, setSecondaryView] = useState('overview');
  const [demoPrompt, setDemoPrompt] = useState('Generate a responsive planning concept for eco garden week.');
  const [demoOutput, setDemoOutput] = useState('');
  const [activityLog, setActivityLog] = useState([]);

  const toggleDevOverlay = useUiStore((state) => state.toggleDevOverlay);
  const themeMode = useUiStore((state) => state.themeMode);
  const themePack = useUiStore((state) => state.themePack);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const setThemePack = useUiStore((state) => state.setThemePack);
  const { adapters, meta } = useThemeRuntime({ mode: themeMode, packId: themePack });
  const availablePacks = Array.isArray(meta?.availablePacks) ? meta.availablePacks : [];
  const availableAdapters = Array.isArray(meta?.availableAdapters) ? meta.availableAdapters : [];
  const diagnostics = Array.isArray(meta?.diagnostics) ? meta.diagnostics : [];
  const policyMeta = meta?.policy || {};
  const [analyticsSnapshot, setAnalyticsSnapshot] = useState(() => analytics.getSnapshot());
  const [performanceSnapshot, setPerformanceSnapshot] = useState(() => getPerformanceSnapshot());

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/api/version')
  });

  const readiness = !healthQuery.data?.version
    ? { level: 'warn', summary: 'API?' }
    : policyMeta.failClosed && !policyMeta.policyEnforced
      ? { level: 'blocked', summary: 'Fail config' }
      : !performanceSnapshot.started
        ? { level: 'warn', summary: 'Vitals' }
        : { level: 'ok', summary: 'OK' };

  function pushActivity(type, details) {
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      details
    };
    setActivityLog((prev) => [item, ...prev].slice(0, 24));
  }

  useEffect(() => {
    trackAppView();
    startPerformanceMonitoring();
    pushActivity('BOOT', 'Shell initialized');

    const timer = window.setInterval(() => {
      setAnalyticsSnapshot(analytics.getSnapshot());
      setPerformanceSnapshot(getPerformanceSnapshot());
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const firstView = NAV_STRUCTURE[primaryArea]?.[0]?.id;
    if (firstView) {
      setSecondaryView(firstView);
      pushActivity('NAV', `Primary changed to ${primaryArea}`);
    }
  }, [primaryArea]);

  function onSupportClick(surface) {
    trackSupportClick(surface);
    pushActivity('SUPPORT', `CTA clicked from ${surface}`);
  }

  async function onDownloadRuntimeReport() {
    const { buildRuntimeReport, exportRuntimeReport } = await import('./runtime/report');
    const runtimeReport = buildRuntimeReport({
      health: healthQuery.data || null,
      analyticsSnapshot,
      performanceSnapshot,
      themePack,
      themeMode,
      availablePacks,
      availableAdapters,
      diagnostics,
      policyMeta,
      activityLog,
      primaryArea,
      secondaryView
    });
    exportRuntimeReport(runtimeReport);
    pushActivity('REPORT', 'Report downloaded');
  }

  function onPrimarySelect(area) {
    setPrimaryArea(area);
  }

  function onSecondarySelect(viewId) {
    setSecondaryView(viewId);
    pushActivity('VIEW', `Opened ${viewId}`);
  }

  function runDemo() {
    const output = `Demo response for "${demoPrompt}":\n- Theme: sci-fi curriculum board\n- Activity flow: intro > collaboration > reflection\n- Evidence capture: photo + annotation + outcome tag\n- Parent digest summary prepared`;
    setDemoOutput(output);
    analytics.track('demo.executed', {
      view: secondaryView,
      promptLength: demoPrompt.length
    });
    pushActivity('DEMO', 'Generated demo output');
  }

  function startPanelDrag(event) {
    const panel = event.currentTarget;
    const target = event.target;

    if (target instanceof HTMLElement && target.closest('a,button,textarea,input')) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;

    const onMouseMove = (moveEvent) => {
      panel.style.left = `${moveEvent.clientX - startX}px`;
      panel.style.top = `${moveEvent.clientY - startY}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function renderMainContent() {
    if (secondaryView === 'overview') {
      return (
        <>
          <section className="intro-panel">
            <h2>Trading Command Suite</h2>
            <p>
              Unified command interface for SEES market analysis and MT5 trading operations with built-in
              developer tooling, analytics, and runtime policy controls.
            </p>
            <div className="intro-badges">
              <BadgePill label="Theme Registry" status="ok" />
              <BadgePill label="Fail-Closed Policy" status="warn" />
              <BadgePill label="Web Vitals" status="ok" />
              <BadgePill label="Dev Runtime Tags" status="ok" />
            </div>
          </section>
          <div className="content-grid">
            <ContentCard title="What It Offers">
              <ul>
                <li>Pluggable theme packs and adapters for scalable UI systems.</li>
                <li>Security-by-default startup policy with allowlist enforcement.</li>
                <li>Built-in analytics foundation for centralized intranet reporting.</li>
              </ul>
            </ContentCard>
            <ContentCard title="Who It Is For">
              <ul>
                <li>Teams moving from concept to production-grade prototypes quickly.</li>
                <li>Organizations needing observable, governed front-end platforms.</li>
                <li>Developers who want reusable app shells with polished demos.</li>
              </ul>
            </ContentCard>
          </div>
        </>
      );
    }

    if (secondaryView === 'demos') {
      return (
        <section className="demo-panel">
          <h2>Interactive Demo</h2>
          <p>Run a sample flow to preview how your future tools can present generated outcomes.</p>
          <textarea value={demoPrompt} onChange={(event) => setDemoPrompt(event.target.value)} rows={5} />
          <div className="inline-actions">
            <button type="button" className="cta" onClick={runDemo}>Run Demo</button>
            <button
              type="button"
              onClick={() => {
                setDemoPrompt('Create a team dashboard card layout with live safety indicators.');
                pushActivity('DEMO', 'Loaded alt prompt');
              }}
            >
              Load Alternate Prompt
            </button>
          </div>
          {demoOutput && <pre className="demo-output">{demoOutput}</pre>}
        </section>
      );
    }

    if (secondaryView === 'use-cases') {
      return (
        <div className="content-grid">
          <ContentCard title="Education Tools">
            <p>Observation capture, planning, and parent communication apps with reusable modules.</p>
          </ContentCard>
          <ContentCard title="Internal Dashboards">
            <p>Operational portals with policy-safe extensions and centralized analytics reporting.</p>
          </ContentCard>
          <ContentCard title="Client Prototypes">
            <p>Fast proof-of-concepts with a credible product shell for demos and screenshots.</p>
          </ContentCard>
        </div>
      );
    }

    if (secondaryView === 'theme-lab') {
      return (
        <section className="demo-panel">
          <h2>Theme Lab</h2>
          <p>Switch packs and modes from the right rail to test adapter behavior.</p>
          <div className="content-grid">
            <ContentCard title="Current Theme Context">
              <p>Pack: {themePack}</p>
              <p>Mode: {themeMode}</p>
              <p>Available packs: {availablePacks.join(', ') || 'none'}</p>
            </ContentCard>
            <ContentCard title="Adapter Output Preview">
              <pre>{JSON.stringify(adapters.vanilla || {}, null, 2)}</pre>
            </ContentCard>
          </div>
        </section>
      );
    }

    if (secondaryView === 'component-lab') {
      return (
        <div className="content-grid">
          <ContentCard title="Action Buttons">
            <div className="inline-actions">
              <button type="button" className="cta">Primary Action</button>
              <button type="button">Secondary Action</button>
            </div>
          </ContentCard>
          <ContentCard title="Information Card">
            <p>Use this style to showcase features, outcomes, and release notes.</p>
          </ContentCard>
          <ContentCard title="Alert State">
            <p className="error">Sample alert styling for diagnostics and policy warnings.</p>
          </ContentCard>
        </div>
      );
    }

    if (secondaryView === 'runtime') {
      return (
        <section className="demo-panel">
          <h2>Developer Runtime</h2>
          <p>Tag-aware runtime is active. Open the overlay for element metadata inspection.</p>
          <div className="inline-actions">
            <button
              type="button"
              className="cta"
              onClick={() => {
                toggleDevOverlay();
                pushActivity('RUNTIME', 'Toggled dev overlay');
              }}
            >
              Toggle Dev Runtime Overlay
            </button>
          </div>
          {diagnostics.length > 0 && (
            <div className="theme-diagnostics">
              <h3>Latest Diagnostics</h3>
              <ul>
                {diagnostics.slice(-6).map((item, index) => (
                  <li key={`${item.code || 'diag'}-${index}`}>
                    <strong>{item.level || 'info'}</strong> {item.code ? `[${item.code}]` : ''} {item.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      );
    }

    if (secondaryView === 'sees-live-stack') {
      return <SeesLiveStackMockPage />;
    }

    if (secondaryView === 'architecture-framework') {
      return <ArchitectureFrameworkPage />;
    }

    if (secondaryView === 'status') {
      return <SystemStatusPage />;
    }

    if (secondaryView === 'setup') {
      return <SetupWizardPage />;
    }

    if (secondaryView === 'settings') {
      return <SettingsPage />;
    }

    if (secondaryView === 'symbols-browser') {
      return <SymbolsBrowserPage />;
    }

    if (secondaryView === 'database-tables') {
      return <DatabaseTablesPage />;
    }

    if (secondaryView === 'theme-packs') {
      return <ThemePage />;
    }

    if (secondaryView === 'analytics') {
      return (
        <div className="content-grid">
          <ContentCard title="Analytics Pipeline">
            <p>Mode: {analyticsSnapshot.enabled ? 'enabled' : 'disabled'}</p>
            <p>Forwarding: {analyticsSnapshot.endpointConfigured ? 'configured' : 'local queue only'}</p>
            <p>Queued events: {analyticsSnapshot.queueLength}</p>
            <p>Sent events: {analyticsSnapshot.sentCount}</p>
            <p>Readiness: {readiness.level}</p>
          </ContentCard>
          <ContentCard title="Performance Metrics">
            <p>Monitoring: {performanceSnapshot.enabled ? 'enabled' : 'disabled'}</p>
            <p>Samples captured: {performanceSnapshot.samples}</p>
            <p>Last update: {performanceSnapshot.lastUpdatedAt || 'pending'}</p>
          </ContentCard>
          <ContentCard title="Runtime Report">
            <p>Export current health, policy, analytics, and vitals as JSON.</p>
            <div className="inline-actions">
              <button type="button" onClick={onDownloadRuntimeReport}>Download Report</button>
            </div>
          </ContentCard>
        </div>
      );
    }

    if (secondaryView === 'security') {
      return (
        <div className="content-grid">
          <ContentCard title="Security Controls">
            <ul>
              <li>Theme allowlist policy and fail-closed enforcement.</li>
              <li>Analytics endpoint restrictions (https or localhost only).</li>
              <li>Sanitized event payloads and bounded local queue.</li>
            </ul>
          </ContentCard>
          <ContentCard title="Governance Intent">
            <p>
              Production builds should enforce approved module sets and reject unknown extensions by default.
            </p>
          </ContentCard>
        </div>
      );
    }

    if (secondaryView === 'about') {
      return (
        <section className="intro-panel">
          <h2>About Trading Command Suite</h2>
          <p>
            Built by Ryan Bayne and offered by FifeCIC.Scot, this platform helps teams move from prototype
            to secure live products without rebuilding foundation systems each time.
          </p>
        </section>
      );
    }

    if (secondaryView === 'roadmap') {
      return (
        <div className="content-grid">
          <ContentCard title="Near-Term">
            <ul>
              <li>Plugin registry tooling and module validation pipeline.</li>
              <li>Central analytics collector integration.</li>
              <li>Expanded sci-fi component kit and templates.</li>
            </ul>
          </ContentCard>
          <ContentCard title="Long-Term">
            <ul>
              <li>Cross-app federation for intranet-wide observability.</li>
              <li>Adaptive runtime profiles by deployment type.</li>
              <li>Premium tooling services and implementation support.</li>
            </ul>
          </ContentCard>
        </div>
      );
    }

    return (
      <section className="demo-panel">
        <h2>Support Trading Command Suite</h2>
        <p>
          If this platform saves you development time, sponsorships help maintain rapid releases and open tooling.
        </p>
        <div className="inline-actions">
          <a
            className="support-link-button"
            href="https://www.buymeacoffee.com/ryanbayne"
            target="_blank"
            rel="noreferrer"
            onClick={() => onSupportClick('support.main')}
          >
            Buy Me a Coffee
          </a>
          <a className="support-link-button" href="mailto:tradingcs@fifecic.scot">
            Contact Ryan
          </a>
        </div>
      </section>
    );
  }

  return (
    <div className="site-shell" {...withDevTag('app.shell', { product: 'tradingcs' })}>
      <div className="sci-bg" aria-hidden="true">
        <div className="sci-stars" />
        <div className="sci-grid" />
        <div className="sci-glow" />
      </div>

      <header className="topbar">
        <div>
          <p className="eyebrow">Trading Command Suite</p>
          <h1>SEES + MT5 Integration Platform</h1>
        </div>
        <nav className="primary-nav" aria-label="Primary areas">
          {Object.keys(NAV_STRUCTURE).map((area) => (
            <button
              key={area}
              type="button"
              className={primaryArea === area ? 'nav-active' : ''}
              onClick={() => onPrimarySelect(area)}
            >
              {area}
            </button>
          ))}
        </nav>
      </header>

      <aside className="left-rail" aria-label="Section navigation">
        <h2>{primaryArea}</h2>
        <div className="rail-links">
          {(NAV_STRUCTURE[primaryArea] || []).map((item) => (
            <button
              key={item.id}
              type="button"
              className={secondaryView === item.id ? 'nav-active' : ''}
              onClick={() => onSecondarySelect(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {primaryArea === 'theme' && (
          <>
            <div className="rail-block">
              <p className="muted">Mode</p>
              <div className="inline-actions">
                <button type="button" className={themeMode === 'light' ? 'cta' : ''} onClick={() => setThemeMode('light')}>
                  Light
                </button>
                <button type="button" className={themeMode === 'dark' ? 'cta' : ''} onClick={() => setThemeMode('dark')}>
                  Dark
                </button>
              </div>
            </div>

            <div className="rail-block">
              <p className="muted">Theme Pack</p>
              <div className="rail-links">
                {availablePacks.map((packId) => (
                  <button
                    key={packId}
                    type="button"
                    className={themePack === packId ? 'nav-active' : ''}
                    onClick={() => {
                      setThemePack(packId);
                      pushActivity('THEME', `Pack switched to ${packId}`);
                    }}
                  >
                    {packId}
                  </button>
                ))}
              </div>
            </div>

            <div className="rail-block preview-cards-rail">
              <p className="muted">Preview</p>
              <div className="preview-cards">
                {THEME_CARDS.filter((c) => availablePacks.includes(c.id)).map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className={`preview-card-rail ${themePack === card.id ? 'active' : ''}`}
                    onClick={() => { setThemePack(card.id); pushActivity('THEME', `Preview clicked ${card.id}`); }}
                  >
                    <div className="preview-card-swatch" style={{ background: card.colors[0] }}>
                      <span className="preview-card-accent" style={{ background: card.colors[1] }} />
                      <span className="preview-card-line" style={{ background: card.colors[2], opacity: 0.3 }} />
                      <span className="preview-card-line short" style={{ background: card.colors[2], opacity: 0.2 }} />
                    </div>
                    <span className="preview-card-name">{card.name}</span>
                    <span className="preview-card-desc">{card.description}</span>
                    <div className="preview-card-bars">
                      {card.colors.map((c) => (
                        <span key={c} className="preview-card-bar" style={{ background: c }} title={c} />
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </aside>

      <main className="main-stage" {...withDevTag('main.stage', { area: secondaryView })}>
        {renderMainContent()}
      </main>

      <aside className="right-rail" aria-label="Admin and status">
        <h2>Admin + Status</h2>
        <div className="rail-block">
          <p className="muted">Theme Mode</p>
          <div className="inline-actions">
            <button type="button" className={themeMode === 'light' ? 'cta' : ''} onClick={() => setThemeMode('light')}>
              Light
            </button>
            <button type="button" className={themeMode === 'dark' ? 'cta' : ''} onClick={() => setThemeMode('dark')}>
              Dark
            </button>
          </div>
          <p className="muted" style={{ marginTop: 6 }}>Pack: <strong>{themePack}</strong></p>
          <button
            type="button"
            className="cta"
            style={{ marginTop: 4 }}
            onClick={() => { setPrimaryArea('theme'); setSecondaryView('theme-packs'); }}
          >
            Open Theme Page
          </button>
        </div>

        <div className="rail-block">
          <p className="muted">Server</p>
          {healthQuery.isLoading && <p>Checking...</p>}
          {healthQuery.error && <p className="error">Offline</p>}
          {healthQuery.data && <p className="ok">Online: {healthQuery.data.version || 'unknown'}</p>}
          <p className="muted">Adapters: {availableAdapters.length}</p>
          <p className="muted">Analytics queue: {analyticsSnapshot.queueLength}</p>
          <p className="muted">Perf samples: {performanceSnapshot.samples}</p>
        </div>

        <div className="rail-block">
          <p className="muted">Actions</p>
          {FEATURE_FLAGS.devRuntime && (
            <button
              type="button"
              className="cta"
              onClick={() => {
                toggleDevOverlay();
                pushActivity('RUNTIME', 'Overlay toggled from right rail');
              }}
            >
              Toggle Dev Overlay
            </button>
          )}
          <a
            className="support-link-button"
            href="https://www.buymeacoffee.com/ryanbayne"
            target="_blank"
            rel="noreferrer"
            onClick={() => onSupportClick('right-rail.support')}
          >
            Support Ryan
          </a>
          <button type="button" onClick={onDownloadRuntimeReport}>Export Report</button>
        </div>
      </aside>

      <section
        className="floating-panel floating-insights"
        onMouseDown={startPanelDrag}
        {...withDevTag('floating.insights', { kind: 'hidden-info' })}
      >
        <div className="floating-title">
          <span>Hidden Info</span>
          <BadgePill label={themePack} status="ok" />
        </div>
        <p>Policy: {policyMeta.policyEnforced ? 'enforced' : 'not enforced'}</p>
        <p>Fail-closed: {policyMeta.failClosed ? 'on' : 'off'}</p>
        <p>Vitals tracked: {Object.keys(performanceSnapshot.metrics).length}</p>
      </section>

      <section
        className="floating-panel floating-log"
        onMouseDown={startPanelDrag}
        {...withDevTag('floating.log', { kind: 'activity-log' })}
      >
        <div className="floating-title">
          <span>Live Activity Log</span>
          <BadgePill label={`${activityLog.length}`} status="neutral" />
        </div>
        <div className="log-scroll">
          {activityLog.length === 0 && <p className="muted">Interact with the shell to populate log events.</p>}
          {activityLog.map((item) => (
            <p key={item.id} className="log-line">
              {item.timestamp} [{item.type}] {item.details}
            </p>
          ))}
        </div>
      </section>

      <a
        className="support-fab"
        href="https://www.buymeacoffee.com/ryanbayne"
        target="_blank"
        rel="noreferrer"
        onClick={() => onSupportClick('support-fab.link')}
        {...withDevTag('support.fab', { placement: 'fixed' })}
      >
        Buy Ryan a Coffee
      </a>

      {FEATURE_FLAGS.devRuntime && <DevOverlay />}
    </div>
  );
}
