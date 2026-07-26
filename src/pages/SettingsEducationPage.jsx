/**
 * Education Settings Page
 * =======================
 * Controls for the education/training system: show/hide guidance,
 * reset dismissed containers, experience level.
 *
 * Route: /settings/settings-education
 * Also appears under: /education/settings-education
 */

import { usePreferences } from '../core/hooks/usePreferences';
import './settings.css';

function SettingRow({ label, children, hint }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <strong>{label}</strong>
        {hint && <p>{hint}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

const GUIDE_LABELS = {
  'directives-global': 'What Are Directives? (global explanation)',
  'directives-specific': 'About This Directive (per-directive guidance)',
};

export default function SettingsEducationPage() {
  const { prefs, set, setMany } = usePreferences();

  const showGuidance = prefs?.showTrainingGuidance !== false;
  const dismissed = prefs?.dismissedGuides || {};
  const dismissedKeys = Object.keys(dismissed);
  const experienceLevel = prefs?.experienceLevel || 'beginner';
  const displayMode = prefs?.displayMode || 'focused';

  const resetDismissed = () => {
    set('dismissedGuides', {});
  };

  const resetDismissedOne = (key) => {
    const next = { ...dismissed };
    delete next[key];
    set('dismissedGuides', next);
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Education Settings</h1>
        <p>Control how educational guidance and training content appears throughout the app.</p>
      </header>

      {/* ── Guidance Toggle ── */}
      <section className="settings-section">
        <h2>Educational Guidance</h2>
        <SettingRow
          label="Show educational guidance"
          hint="When enabled, beginner-friendly explanations and tips appear on directive detail pages and other areas."
        >
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={showGuidance}
              onChange={(e) => set('showTrainingGuidance', e.target.checked)}
            />
            <span className="setting-toggle-label">{showGuidance ? 'Enabled' : 'Disabled'}</span>
          </label>
        </SettingRow>
      </section>

      {/* ── Experience Level ── */}
      <section className="settings-section">
        <h2>Experience Level</h2>
        <SettingRow
          label="Trading experience"
          hint="Controls which features and content are shown. Beginner shows more guidance; Expert shows everything with less hand-holding."
        >
          <select
            className="setting-select"
            value={experienceLevel}
            onChange={(e) => set('experienceLevel', e.target.value)}
          >
            <option value="beginner">Beginner — more guidance, simpler language</option>
            <option value="experienced">Experienced — less guidance, technical language</option>
            <option value="expert">Expert — minimal guidance, full feature set</option>
          </select>
        </SettingRow>
        <SettingRow
          label="Display mode"
          hint="Focused shows key information; Technical shows all details including raw scores and formulas."
        >
          <select
            className="setting-select"
            value={displayMode}
            onChange={(e) => set('displayMode', e.target.value)}
          >
            <option value="focused">Focused — key results only</option>
            <option value="technical">Technical — full details with raw data</option>
          </select>
        </SettingRow>
      </section>

      {/* ── Dismissed Containers ── */}
      <section className="settings-section">
        <h2>Dismissed Education Containers</h2>
        <p className="settings-hint" style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
          Education containers (like "What Are Directives?" and "About This Directive") can be dismissed by clicking the ✕ button.
          Dismissed containers stay hidden until you reset them here.
        </p>

        {dismissedKeys.length === 0 ? (
          <div className="setting-empty" style={{ color: 'var(--ink-soft)', fontSize: '0.82rem', padding: '0.75rem 0' }}>
            No education containers have been dismissed yet.
          </div>
        ) : (
          <>
            <div className="setting-dismissed-list">
              {dismissedKeys.map((key) => (
                <div key={key} className="setting-row">
                  <div className="setting-info">
                    <strong>{GUIDE_LABELS[key] || key}</strong>
                    <p>Dismissed {new Date(dismissed[key]).toLocaleDateString()}</p>
                  </div>
                  <div className="setting-control">
                    <button
                      className="setting-btn setting-btn-sm"
                      onClick={() => resetDismissedOne(key)}
                    >
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <button
                className="setting-btn setting-btn-danger"
                onClick={resetDismissed}
              >
                Reset All Dismissed Containers
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── About Education System ── */}
      <section className="settings-section">
        <h2>About the Education System</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', lineHeight: 1.6 }}>
          <p>The Trading Command Suite includes an embedded education system designed to help traders of all experience levels understand scoring directives, trading concepts, and platform features.</p>
          <p style={{ marginTop: '0.5rem' }}><strong>Education containers</strong> appear on directive detail pages and provide plain-language explanations of what each directive does and how directives work in general.</p>
          <p style={{ marginTop: '0.5rem' }}><strong>Glossary terms</strong> are bold and underlined throughout the app. Hover over any glossary term to see a plain-language definition.</p>
          <p style={{ marginTop: '0.5rem' }}><strong>Pro Tips</strong> accompany each directive to help you interpret scores and use the platform effectively.</p>
        </div>
      </section>
    </div>
  );
}
