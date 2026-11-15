/**
 * SettingsPage — GENERAL settings. (#617)
 * =======================================
 * WHAT BELONGS HERE: app-wide plumbing that is not part of any META.Stack layer.
 *
 * ⚠️ THE RULE THAT SHRANK THIS PAGE
 * ---------------------------------
 * General used to hold 13 sections covering everything from the theme to trade thresholds to
 * a QA-check reset button. That was not a design, it was accretion: the control lived here, so
 * this is where it was added. The user could not find a setting because there was no reason to
 * expect it in any particular place.
 *
 * The META.Stack layers are directives → protocols → scoring → bots. Everything a user can
 * change now has an obvious home:
 *
 *   | Question                                  | Page        |
 *   |-------------------------------------------|-------------|
 *   | What does the app look like?              | Appearance  |
 *   | Is the loop running, and what's in it?    | Automation  |
 *   | What counts as a signal?                  | Scoring     |
 *   | What does each bot do?                    | Trading     |
 *   | None of the above (API, DB, security)     | General     |
 *
 * General is the LAST resort, not the default. If a new setting can be answered by one of the
 * four layer questions, it belongs on that layer's page.
 *
 * ⚠️ The "Moved" index at the bottom is load-bearing, not padding.
 *   A user's only index for a setting is their memory of where it was. Removing a section with
 *   no trace turns a reorganisation into a disappearance, and the next report is "the setting
 *   is gone" — which costs far more to answer than this list costs to render.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../core/api/client';
import { SettingRow, SettingsSection, MovedNote } from '../components/SettingsControls';
import './settings.css';

function HealthChecksSection() {
  const qc = useQueryClient();
  const { data: hc } = useQuery({
    queryKey: ['settings-health-checks'],
    queryFn: () => apiGet('/api/system/settings/health-checks').catch(() => null),
    staleTime: 30_000,
  });

  const toggle = async (key) => {
    if (!hc) return;
    await apiPut('/api/system/settings/health-checks', { [key]: !hc[key] });
    qc.setQueryData(['settings-health-checks'], { ...hc, [key]: !hc[key] });
  };

  const setRefresh = async (sec) => {
    if (!hc) return;
    await apiPut('/api/system/settings/health-checks', { autoRefreshSec: sec });
    qc.setQueryData(['settings-health-checks'], { ...hc, autoRefreshSec: sec });
  };

  const CHECK_LABELS = {
    systemVitals: 'System Vitals', dbDiagnostics: 'DB Table Diagnostics', slowQueries: 'Slow Query Detection',
    apiTrends: 'API Response Trends', providerGrid: 'Provider Health Grid', traceCorrelations: 'Trace Correlations',
    diskInfo: 'Disk Space Monitor', errorRates: 'Error Rate Tracking', cronHeartbeats: 'Cron Heartbeat Monitor',
    portStatus: 'Port Status Check',
  };

  // 'Health & Diagnostics' was a premium-only view, so this settings section was gated while the
  // free edition existed (removed 2026-10-28). It renders unconditionally now.
  // THE REASONING WORTH KEEPING if a per-build split ever returns: the gate had to be a build-time
  // constant so the minifier dropped the element and neither the title nor the href reached the
  // artefact — a runtime check would still ship both strings.
  return (
    true && (
    <SettingsSection
      id="health-checks"
      title="🩺 Health & Diagnostics"
      desc="Enable or disable individual health checks. Disabled checks skip their queries entirely — useful for reducing load or silencing known issues."
    >
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
    </SettingsSection>
    )
  );
}

/**
 * SupporterSection — the off switch for the in-app support prompt (#1147).
 *
 * WHY THIS EXISTS AT ALL: `#1147` §2.2 — *"a prompt the user cannot turn off is a hassle"*. The
 * prompt offers "Don't ask again" itself, but a user who chose "Not now" months ago needs a place
 * to change their mind. Both switches live here because they are the same decision.
 *
 * ⚠️ The current verdict is rendered from `/api/supporter/status`'s own `detail` sentence. It is
 * NOT recomputed here: two implementations of "how often may we ask" would drift, and the user
 * would be told a cadence the server is not applying.
 */
function SupporterSection() {
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ['supporter-status', 'general'],
    queryFn: () => apiGet('/api/supporter/status?kind=general'),
    retry: false,
    staleTime: 30_000,
  });
  const { data: registry } = useQuery({
    queryKey: ['settings-registry'],
    queryFn: () => apiGet('/api/system/settings/registry'),
    retry: false,
    staleTime: 30_000,
  });

  const read = (key) => (registry?.settings || []).find((s) => s.key === key);

  const save = async (key, value) => {
    await apiPut(`/api/system/settings/registry/${key}`, { value });
    await qc.invalidateQueries({ queryKey: ['settings-registry'] });
    await qc.invalidateQueries({ queryKey: ['supporter-status', 'general'] });
  };

  const enabled = read('supporter.enabled');
  const cadence = read('supporter.cadenceDays');
  const snooze = read('supporter.snoozedUntil');
  const donate = read('supporter.donate.url');
  const snoozedUntil = typeof snooze?.value === 'string' ? snooze.value : '';
  const snoozeActive = snoozedUntil && new Date(snoozedUntil).getTime() > Date.now();

  return (
    <SettingsSection
      id="supporter"
      title="💚 Supporter Programme"
      desc="The app asks, roughly once a quarter, whether you would like to support it. It is free and complete either way — nothing is withheld, and both answers here are respected immediately."
    >
      {!registry && (
        <p className="settings-footnote">
          The settings registry could not be read, so these controls are not shown. Nothing has
          changed — an unreadable value is never rendered as if it were a default.
        </p>
      )}

      {enabled && (
        <SettingRow
          label="Support prompts"
          hint="Off stops every in-app support prompt. Nothing else in the app changes."
        >
          <div className="inline-actions">
            <button
              type="button"
              className={enabled.value === true ? 'cta' : ''}
              onClick={() => save('supporter.enabled', !(enabled.value === true))}
            >
              {enabled.value === true ? 'On' : 'Off'}
            </button>
          </div>
        </SettingRow>
      )}

      {cadence && (
        <SettingRow
          label="Minimum days between prompts"
          hint="Also how long a new installation is in use before the first ask."
        >
          <input
            type="number"
            min="7"
            max="3650"
            step="1"
            className="settings-input settings-input-sm"
            value={typeof cadence.value === 'number' ? cadence.value : 90}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10);
              if (Number.isFinite(next) && next >= 7 && next <= 3650) save('supporter.cadenceDays', next);
            }}
          />
        </SettingRow>
      )}

      <SettingRow
        label="Snoozed until"
        hint={
          snoozeActive
            ? 'Set by "Not now" on the prompt. Clearing it makes the prompt eligible again.'
            : 'Not snoozed.'
        }
      >
        <div className="inline-actions">
          <code>{snoozedUntil || '—'}</code>
          {snoozedUntil && (
            <button type="button" onClick={() => save('supporter.snoozedUntil', '')}>
              Clear
            </button>
          )}
        </div>
      </SettingRow>

      {donate && (
        <SettingRow
          label="Donate destination"
          hint="Where the prompt's button sends you. One primary destination on purpose — a menu is not an ask."
        >
          <code>
            <a href={typeof donate.value === 'string' ? donate.value : '#'} target="_blank" rel="noopener noreferrer">
              {typeof donate.value === 'string' && donate.value ? donate.value : '(not set)'}
            </a>
          </code>
        </SettingRow>
      )}

      {status?.detail && (
        <p className="settings-footnote">
          <strong>Current decision:</strong> {status.detail}
        </p>
      )}
    </SettingsSection>
  );
}

export default function SettingsPage() {
  // Deep-link support: `?section=<id>` scrolls the named section into view, so a link from
  // anywhere in the app lands the user ON the control rather than at the top of the page.
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
        <h1>General</h1>
        <p>
          Application plumbing. Everything a user can change that belongs to a{' '}
          {'META.Stack'} layer now lives on
          that layer's page — see the index at the bottom.
        </p>
      </header>

      <SettingsSection
        id="api-connection"
        title="API Connection"
        desc="Where the frontend looks for the backend. Set by the build, not by the user."
      >
        <SettingRow label="Backend URL" hint="The NestJS API endpoint the frontend calls.">
          <code>http://localhost:3201</code>
        </SettingRow>
        <SettingRow label="Auto-refresh" hint="How often live data panels refresh (seconds). Set per view on Appearance → Refresh intervals.">
          <code>30</code>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="security"
        title="Security"
        desc="Read-only. These are server configuration, shown so the posture is visible rather than assumed."
      >
        <SettingRow label="CORS Origin" hint="Allowed cross-origin request origin.">
          <code>http://localhost:5173</code>
        </SettingRow>
        <SettingRow label="Localhost Only" hint="Restrict API to localhost connections.">
          <code>off</code>
        </SettingRow>
        <SettingRow label="API Key Rotation" hint="Days until API key expiry warning.">
          <code>90</code>
        </SettingRow>
      </SettingsSection>

      <HealthChecksSection />

      <SupporterSection />

      <SettingsSection
        id="moved"
        title="Where things went"
        desc="This page used to hold all of these. Nothing was removed — it was filed where it belongs."
      >
        <MovedNote><strong>Theme, Display, Market Tape</strong> → <a href="/settings/appearance">Appearance</a></MovedNote>
        <MovedNote><strong>The loop, the queue, layer kill switches</strong> → <a href="/settings/automation">Automation</a></MovedNote>
        <MovedNote><strong>Trade thresholds, scoring defaults</strong> → <a href="/settings/scoring-settings">Scoring</a></MovedNote>
        <MovedNote><strong>Database</strong> → <a href="/settings/settings-database">Database</a></MovedNote>
        <MovedNote><strong>Reset QA checks</strong> → <a href="/development/qa-testing">QA Checklist</a></MovedNote>
        <MovedNote><strong>Bots, trade defaults, risk limits</strong> → <a href="/settings/trading-settings">Trading</a></MovedNote>
        <MovedNote><strong>Full preference list</strong> → <a href="/settings/user-preferences">User Preferences</a></MovedNote>
      </SettingsSection>

      <footer className="settings-footer">
        <p>Settings are read from environment files and app configuration. Changes to backend settings require a restart.</p>
        <p>Documentation: <code>nest/README.md</code> and <code>nest/.env</code></p>
      </footer>
    </div>
  );
}
