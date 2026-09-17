/**
 * AppearanceSettingsPage — Theme + Display + Market Tape in one place. (#617)
 *
 * WHY THE THREE ARE TOGETHER
 * --------------------------
 * All three answer the SAME question — "what does the app look like?" — and none of them
 * affects a META.Stack layer. Before this page they lived inside General, filed between
 * "Trade Thresholds" and "Security", so a user changing their theme had to scroll past
 * trading configuration to reach it and scrolled past theme configuration to reach trading.
 *
 * Grouping them by the question they answer is what makes General's remaining contents
 * (API / Queue / Performance / Security / Health) make sense as a set.
 *
 * ⚠️ This page OVERLAPS deliberately with two existing views:
 *   - `theme-packs` is the full preview gallery (it exists to try packs before committing).
 *   - `user-preferences` is the complete preference table (every key, with its default).
 *   This page is the curated, everyday surface. Seeing the same value in two places is
 *   intended — it is how the link between "the page I use" and "the page that lists
 *   everything" stays discoverable — but there is ONE store behind all three
 *   (`usePreferences` / `useUiStore`), so the copies cannot disagree.
 *
 * ⚠️ The `id` attributes are deep-link anchors and are load-bearing: the market tape's ⚙
 * button navigates to `/settings/appearance?section=market-tape`. Renaming an id silently
 * breaks that button (the page still renders, the scroll-into-view finds nothing, and the
 * user lands at the top of a long page with no error anywhere).
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUiStore } from '../stores/useUiStore';
import { usePreferences } from '../core/hooks/usePreferences';
import { ALL_SECTIONS } from '../components/MarketTape';
import { SettingRow, SettingsSection, TogglePair, MovedNote } from '../components/SettingsControls';
import './settings.css';

/**
 * MarketTapeSection — the ONE place tape sections are configured.
 *
 * It renders from `ALL_SECTIONS`, exported by MarketTape itself, so the settings list
 * and the tape's own render list cannot drift apart. A second hand-maintained list here
 * would be a section the user can see but never switch on.
 *
 * ⚠️ Moved here from SettingsPage (§617) with no behavioural change. Only the surrounding
 * `id="market-tape"` anchor moved with it — see the tape's ⚙ button, which targets it.
 */
function MarketTapeSection() {
  const { prefs, set } = usePreferences();
  const on = ALL_SECTIONS.filter((s) => prefs[s.key]);
  return (
    <>
      {ALL_SECTIONS.map((s) => (
        <SettingRow key={s.key} label={s.label}>
          <TogglePair value={prefs[s.key]} onChange={(next) => set(s.key, next)} />
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

export default function AppearanceSettingsPage() {
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const themePack = useUiStore((state) => state.themePack);
  const showNavIcons = useUiStore((state) => state.showNavIcons);
  const setShowNavIcons = useUiStore((state) => state.setShowNavIcons);

  const { prefs, set } = usePreferences();

  // Deep-link support: the market tape's ⚙ button navigates to
  // /settings/appearance?section=market-tape. Scroll that section into view on arrival so
  // the button lands the user ON the control rather than at the top of a long page.
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
        <h1>Appearance</h1>
        <p>Theme, display defaults and the market tape. Nothing here changes what is traded.</p>
      </header>

      <SettingsSection
        id="theme"
        title="Theme"
        desc="How the app is coloured and how the navigation is decorated."
      >
        <SettingRow label="Mode" hint="Light, dark, or pure black background.">
          <div className="inline-actions">
            <button type="button" className={themeMode === 'light' ? 'cta' : ''} onClick={() => setThemeMode('light')}>
              ☀ Light
            </button>
            <button type="button" className={themeMode === 'dark' ? 'cta' : ''} onClick={() => setThemeMode('dark')}>
              🌙 Dark
            </button>
            <button type="button" className={themeMode === 'black' ? 'cta' : ''} onClick={() => setThemeMode('black')}>
              ⬛ Black
            </button>
          </div>
        </SettingRow>
        <SettingRow label="Pack" hint="Active theme pack ID. Theme Packs is the full preview gallery.">
          <code>{themePack}</code>
        </SettingRow>
        <SettingRow label="Navigation Icons" hint="Show category icons on the right side of sidebar menu items.">
          <TogglePair
            value={showNavIcons}
            onChange={setShowNavIcons}
            onLabel="◉ Show"
            offLabel="✕ Hide"
          />
        </SettingRow>
        <MovedNote>
          Browse and preview packs on <a href="/settings/theme-packs">Theme Packs</a>. Accessibility
          options (contrast, font scale, focus rings, colour-blind mode) are on{' '}
          <a href="/settings/user-preferences">User Preferences</a>.
        </MovedNote>
      </SettingsSection>

      <SettingsSection
        id="display"
        title="Display"
        desc="Chart and density defaults applied across the app."
      >
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
          <TogglePair value={prefs.compactMode} onChange={(next) => set('compactMode', next)} />
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
      </SettingsSection>

      <SettingsSection
        id="market-tape"
        title="Market Tape"
        desc="Choose which sections appear in the ticker at the top of the app. The ⚙ button on the tape links straight here. Everything is off-by-default for new sections so the tape never silently grows wider than you asked for."
      >
        <MarketTapeSection />
      </SettingsSection>

      <SettingsSection title="Performance" desc="These affect every page, not just charts, which is why they are not on the chart views.">
        <SettingRow label="Polling Interval" hint="Default polling interval for live data panels (seconds).">
          <input type="number" min="5" max="120" step="5" className="settings-input settings-input-sm"
            value={prefs.pollingInterval} onChange={e => set('pollingInterval', Math.max(5, parseInt(e.target.value, 10) || 30))} />
        </SettingRow>
        <SettingRow label="Chart Animation" hint="Enable animations on chart components.">
          <TogglePair value={prefs.chartAnimation} onChange={(next) => set('chartAnimation', next)} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Refresh intervals" desc="How often live data re-fetches. Lower is fresher and more expensive.">
        <SettingRow label="Signals Auto-Refresh" hint="Auto-refresh the signal ladder at the interval below.">
          <TogglePair value={prefs.signalsAutoRefresh} onChange={(next) => set('signalsAutoRefresh', next)} />
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
      </SettingsSection>
    </div>
  );
}
