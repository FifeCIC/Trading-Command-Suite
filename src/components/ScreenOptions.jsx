/**
 * ScreenOptions — Reusable overlay for per-view configuration.
 * First use case: Speed Scanner trade mode selection.
 * Extensible to other views via the view registry pattern.
 *
 * #249 — Screen Options overlay + sticky options button
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import { usePreferences } from '../core/hooks/usePreferences';
import { VIEW_EXPLANATIONS } from '../core/view-explanations';
import EmptyState from './EmptyState';
import GlossaryPage from '../pages/GlossaryPage';
import { SB_OPTIONAL_COLUMNS, sbColumnKey } from '../core/symbols-browser-columns';
import { SCR_OPTIONAL_COLUMNS, scrColumnKey } from '../core/screener-columns';
import './notification-disc.css';
import './screen-options.css';

/** Global preferences shown on ALL views */
var GLOBAL_PREFERENCES = [
  {
    id: 'displayMode',
    label: 'Display Mode',
    description: 'Focused shows plain-language trading information. Technical shows raw data and identifiers.',
    type: 'radio',
    key: 'tcs:preferences',
    field: 'displayMode',
    defaultValue: 'focused',
    options: [
      { value: 'focused', label: 'Focused', desc: 'Plain language — \"Strong Buy\", \"FOREX Majors\", interpreted signals' },
      { value: 'technical', label: 'Technical', desc: 'Raw data — composite scores, protocol IDs, slugs, port numbers' },
    ],
  },
  {
    id: 'experienceLevel',
    label: 'Experience Level',
    description: 'Controls feature gating and information density across the app.',
    type: 'radio',
    key: 'tcs:preferences',
    field: 'experienceLevel',
    defaultValue: 'beginner',
    options: [
      { value: 'beginner', label: 'Beginner', desc: 'Essential features only — guided workflows and simple language' },
      { value: 'experienced', label: 'Experienced', desc: 'Full feature set — assumes trading and platform familiarity' },
      { value: 'expert', label: 'Expert', desc: 'All features unlocked — advanced configuration and raw data access' },
    ],
  },
  {
    id: 'hidePageTitle',
    label: 'Page Title',
    description: 'Show or hide the main heading on each page.',
    type: 'checkbox',
    key: 'tcs:preferences',
    field: 'hidePageTitle',
    defaultValue: false,
  },
  {
    id: 'hidePageSubtitle',
    label: 'Page Description',
    description: 'Show or hide the subtitle/description under the page heading.',
    type: 'checkbox',
    key: 'tcs:preferences',
    field: 'hidePageSubtitle',
    defaultValue: false,
  },
  {
    id: 'highContrastText',
    label: '🔍 High Contrast Text',
    description: 'Boost text and accent contrast for readability. Recommended for visual accessibility.',
    type: 'checkbox',
    key: 'tcs:preferences',
    field: 'highContrastText',
    defaultValue: false,
  },
  {
    id: 'colorBlindMode',
    label: '🎨 Color-Blind Friendly',
    description: 'Adds shape indicators (+/- signs, arrows, pattern fills) alongside color coding. Does not remove colors — adds redundant cues per WCAG 1.4.1.',
    type: 'checkbox',
    key: 'tcs:preferences',
    field: 'colorBlindMode',
    defaultValue: false,
  },
  {
    id: 'fontScale',
    label: '🔤 Font Size',
    description: 'Scale all text across the application. Choose a size that works best for your display and reading comfort.',
    type: 'radio',
    key: 'tcs:preferences',
    field: 'fontScale',
    defaultValue: 'normal',
    options: [
      { value: 'small', label: 'Small', desc: 'Compact — fits more data on screen. Best for high-resolution displays.' },
      { value: 'normal', label: 'Normal', desc: 'Default size — balanced for most screens and workflows.' },
      { value: 'large', label: 'Large', desc: 'Easier to read — more comfortable for extended use.' },
      { value: 'x-large', label: 'X-Large', desc: 'Maximum readability — ideal for accessibility or large monitors.' },
    ],
  },
  {
    id: 'focusIndicatorStyle',
    label: '⌖ Focus Indicator',
    description: 'Choose how keyboard focus rings appear. Strong is the default 2px accent outline. Subtle uses a 1px dashed outline. None hides focus indicators entirely (not recommended for accessibility).',
    type: 'radio',
    key: 'tcs:preferences',
    field: 'focusIndicatorStyle',
    defaultValue: 'strong',
    options: [
      { value: 'strong', label: 'Strong', desc: '2px solid accent outline — high visibility, recommended for keyboard users.' },
      { value: 'subtle', label: 'Subtle', desc: '1px dashed outline — visible but less prominent.' },
      { value: 'none', label: 'None', desc: 'No focus ring — not recommended. Use only if you rely on other feedback.' },
    ],
  },
  {
    id: 'layoutSize',
    label: '📐 Layout Size',
    description: 'Control how wide pages render. Compact is narrower for focused reading. Full uses the entire screen width.',
    type: 'radio',
    key: 'tcs:preferences',
    field: 'layoutSize',
    defaultValue: 'normal',
    options: [
      { value: 'compact', label: 'Compact', desc: 'Narrower max-width (~720px) — focused reading, less eye movement.' },
      { value: 'normal', label: 'Normal', desc: 'Default max-width (~960px) — balanced for most screens.' },
      { value: 'wide', label: 'Wide', desc: 'Wider max-width (~1200px) — fits more data columns on screen.' },
      { value: 'full', label: 'Full Width', desc: 'No max-width constraint — uses entire browser window.' },
    ],
  },
  {
    id: 'hidePracticeData',
    label: '🧪 Hide Practice Data',
    description: 'Hide paper trading and practice account positions across all views. Live account data is always shown.',
    type: 'checkbox',
    key: 'tcs:preferences',
    field: 'hidePracticeData',
    defaultValue: false,
  },
  {
    id: 'showTrainingGuidance',
    label: '📖 Show Training Guidance',
    description: 'Display beginner-friendly explanations, tips, and glossary links throughout the app. Turn off if you\'re experienced and prefer a clean interface.',
    type: 'checkbox',
    key: 'tcs:preferences',
    field: 'showTrainingGuidance',
    defaultValue: true,
  },
];

/** Registry of option definitions keyed by view ID */
const OPTIONS_REGISTRY = {
  'speed-scanner': {
    title: 'Speed Scanner',
    sections: [
      {
        id: 'tradingMode',
        label: 'Trading Mode',
        description: 'How trades are executed from the scanner',
        type: 'radio',
        key: 'ss-trade-mode',
        defaultValue: 'quick-trade',
        options: [
          { value: 'quick-trade', label: '⚡ Quick Trade', desc: 'Execute immediately at market' },
          { value: 'one-click', label: '🎯 One-Click', desc: 'Confirm before execution' },
          { value: 'automation', label: '🤖 Automation', desc: 'Queue for next automation loop' },
          { value: 'keyboard', label: '⌨️ Keyboard', desc: 'Map to a hotkey for manual execution' },
        ],
      },
      {
        id: 'layoutWidth',
        label: 'Layout Width',
        description: 'Maximum content width for this view',
        type: 'radio',
        key: 'ss-layout-width',
        defaultValue: 'full',
        options: [
          { value: 'full', label: 'Full Width', desc: 'Use all available screen width' },
          { value: '4k', label: '4K (2560px)', desc: 'Wide layout for large monitors' },
          { value: 'desktop', label: 'Desktop (1440px)', desc: 'Standard desktop layout' },
          { value: 'laptop', label: 'Laptop (1024px)', desc: 'Compact for smaller screens' },
        ],
      },
      {
        id: 'includeInactive',
        label: 'Include Inactive Protocols',
        description: 'Show protocols marked as inactive in the ladder. Default: hidden.',
        type: 'checkbox',
        key: 'ss-include-inactive',
        defaultValue: false,
      },
    ],
  },
  'pipeline-graph-lab': {
    title: 'Pipeline Graph',
    sections: [
      {
        id: 'connectorMode',
        label: 'Connector Style',
        description: 'How connection lines are drawn between nodes',
        type: 'radio',
        key: 'pg-connector-mode',
        defaultValue: 'diagonal',
        options: [
          { value: 'diagonal', label: '╱ Diagonal', desc: 'Straight lines between ports — reliable and clean' },
          { value: 'orthogonal', label: '└ Orthogonal', desc: 'Right-angle L-bends — experimental, some paths may cross' },
        ],
      },
      {
        id: 'layoutWidth',
        label: 'Layout Width',
        description: 'Maximum content width for this view',
        type: 'radio',
        key: 'pg-layout-width',
        defaultValue: 'full',
        options: [
          { value: 'full', label: 'Full Width', desc: 'Use all available screen width' },
          { value: '4k', label: '4K (2560px)', desc: 'Wide layout for large monitors' },
          { value: 'desktop', label: 'Desktop (1440px)', desc: 'Standard desktop layout' },
          { value: 'laptop', label: 'Laptop (1024px)', desc: 'Compact for smaller screens' },
        ],
      },
    ],
  },
  'active-symbols': {
    title: 'Active Symbols',
    sections: [
      {
        id: 'layoutWidth',
        label: 'Layout Width',
        description: 'Maximum content width for this view',
        type: 'radio',
        key: 'as-layout-width',
        defaultValue: 'full',
        options: [
          { value: 'full', label: 'Full Width', desc: 'Use all available screen width' },
          { value: '4k', label: '4K (2560px)', desc: 'Wide layout for large monitors' },
          { value: 'desktop', label: 'Desktop (1440px)', desc: 'Standard desktop layout' },
          { value: 'laptop', label: 'Laptop (1024px)', desc: 'Compact for smaller screens' },
        ],
      },
    ],
  },
  'directives-registry': {
    title: 'Directives Registry',
    sections: [
      {
        id: 'layoutWidth',
        label: 'Layout Width',
        description: 'Maximum content width for this view',
        type: 'radio',
        key: 'dm-layout-width',
        defaultValue: 'full',
        options: [
          { value: 'full', label: 'Full Width', desc: 'Use all available screen width' },
          { value: '4k', label: '4K (2560px)', desc: 'Wide layout for large monitors' },
          { value: 'desktop', label: 'Desktop (1440px)', desc: 'Standard desktop layout' },
          { value: 'laptop', label: 'Laptop (1024px)', desc: 'Compact for smaller screens' },
        ],
      },
    ],
  },
  'symbols-ladder': {
    title: 'Symbols Ladder',
    sections: [
      {
        id: 'scoreDisplay',
        label: 'Score Display',
        description: 'How the Signal and Opportunity score cells render their values.',
        type: 'radio',
        key: 'sl-score-display',
        defaultValue: 'both',
        options: [
          { value: 'both', label: 'Raw + Percent', desc: 'Raw score with the percentage stacked underneath' },
          { value: 'raw', label: 'Raw Only', desc: 'Just the raw score out of its denominator (e.g. 91 / 180)' },
          { value: 'percent', label: 'Percent Only', desc: 'Just the percentage (e.g. 51%)' },
        ],
      },
    ],
  },
  'symbols-browser': {
    title: 'Symbols Browser',
    sections: [
      {
        id: 'tableColumns',
        label: 'Table Columns',
        description: 'Choose which columns appear in the table. Changes apply immediately.',
        type: 'columns',
        options: SB_OPTIONAL_COLUMNS.map(function (col) {
          return {
            key: sbColumnKey(col),
            label: col.label,
            desc: col.desc || '',
            defaultValue: !!col.def,
          };
        }),
      },
    ],
  },
  'screener': {
    title: 'Screener',
    sections: [
      {
        id: 'tableColumns',
        label: 'Table Columns',
        description: 'Choose which columns appear in the table. Changes apply immediately.',
        type: 'columns',
        options: SCR_OPTIONAL_COLUMNS.map(function (col) {
          return {
            key: scrColumnKey(col),
            label: col.label,
            desc: col.desc || '',
            defaultValue: !!col.def,
          };
        }),
      },
      {
        id: 'topPicks',
        label: 'Top Picks Count',
        description: 'How many highest-attention rows are highlighted as top picks.',
        type: 'radio',
        key: 'scr-top-picks',
        defaultValue: '10',
        options: [
          { value: '5', label: '5', desc: 'Five top picks — minimal noise' },
          { value: '10', label: '10', desc: 'Ten top picks — default' },
          { value: '15', label: '15', desc: 'Fifteen top picks' },
          { value: '20', label: '20', desc: 'Twenty top picks' },
          { value: '25', label: '25', desc: 'Twenty-five top picks — maximum surface' },
        ],
      },
    ],
  },
  'live-ordering-stack': {
    title: 'Ladder',
    sections: [
      {
        id: 'scoreDisplay',
        label: 'Score Display',
        description: 'How each card\u2019s score value renders.',
        type: 'radio',
        key: 'lad-score-display',
        defaultValue: 'both',
        options: [
          { value: 'both', label: 'Raw + Percent', desc: 'Raw score with the percentage stacked underneath' },
          { value: 'raw', label: 'Raw Only', desc: 'Just the raw score out of its denominator (e.g. 91 / 180)' },
          { value: 'percent', label: 'Percent Only', desc: 'Just the percentage (e.g. 33%)' },
        ],
      },
    ],
  },
  'signals-overview': {
    title: 'Signals',
    sections: [
      {
        id: 'dismissHours',
        label: 'Dismissal Window',
        description: 'How many hours a dismissed signal stays hidden before it returns to the ladder.',
        type: 'radio',
        key: 'sig-dismiss-hours',
        defaultValue: '1',
        options: [
          { value: '1', label: '1 hour', desc: 'Default — back after an hour' },
          { value: '2', label: '2 hours', desc: 'Hide until after lunch' },
          { value: '4', label: '4 hours', desc: 'Half a trading day' },
          { value: '8', label: '8 hours', desc: 'Full session' },
          { value: '24', label: '24 hours', desc: 'Until tomorrow' },
        ],
      },
    ],
  },
  't212-portfolio': {
    title: 'Portfolio',
    sections: [
      {
        id: 'accounts',
        label: 'Accounts & Totals',
        description: 'Choose which accounts (and Live/Demo categories) are included in the total.',
        type: 'accounts',
      },
    ],
  },
};

/**
 * Read every registry value for a view from localStorage, applying defaults.
 * Handles plain sections (key on the section) and column-toggle groups
 * (each option carries its own key).
 */
function readRegistryValues(registry) {
  var initial = {};
  if (!registry) return initial;
  for (var i = 0; i < registry.sections.length; i++) {
    var section = registry.sections[i];
    if (section.type === 'columns' && Array.isArray(section.options)) {
      for (var j = 0; j < section.options.length; j++) {
        var opt = section.options[j];
        try {
          initial[opt.key] = localStorage.getItem(opt.key);
          if (initial[opt.key] == null) initial[opt.key] = String(opt.defaultValue);
        } catch (e) {
          initial[opt.key] = String(opt.defaultValue);
        }
      }
    } else if (section.key) {
      try {
        initial[section.key] = localStorage.getItem(section.key) || section.defaultValue;
      } catch (e) {
        initial[section.key] = section.defaultValue;
      }
    }
  }
  return initial;
}

export default function ScreenOptions({ activeView, onSettingsChange, isOpen, onToggle, isBookmarked, onToggleBookmark, statusLevel, isMt5Online, isApiOnline, isDbOnline }) {
  var { prefs, set: setPref } = usePreferences();
  var registry = activeView ? OPTIONS_REGISTRY[activeView] : null;
  var [calcOpen, setCalcOpen] = useState(false);
  var [notifOpen, setNotifOpen] = useState(false);
  var [infoOpen, setInfoOpen] = useState(false);
  var [glossaryOpen, setGlossaryOpen] = useState(false);
  var [dismissed, setDismissed] = useState(new Set());
  var viewExplanation = activeView ? VIEW_EXPLANATIONS[activeView] : null;

  // ── Notification data ──
  var healthQuery = useQuery({
    queryKey: ['so-notif-health'],
    queryFn: () => apiGet('/api/providers/health').catch(() => null),
    refetchInterval: 60_000,
  });
  var autoQuery = useQuery({
    queryKey: ['so-notif-auto'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 30_000,
  });
  // DB-backed alerts (was in-memory, now persisted via #440)
  var alertsQuery = useQuery({
    queryKey: ['so-notif-alerts'],
    queryFn: () => apiGet('/api/alerts/count').catch(() => ({ active: 0, critical: 0 })),
    refetchInterval: 30_000,
  });

  // ── Portfolio account toggles (view-specific) ──
  var hasAccountsSection = registry && registry.sections.some(function (s) { return s.type === 'accounts'; });
  var accountsQuery = useQuery({
    queryKey: ['so-portfolio-accounts'],
    queryFn: () => apiGet('/api/portfolio/accounts').catch(() => null),
    enabled: !!hasAccountsSection,
    refetchInterval: 60_000,
  });
  var portfolioAccounts = accountsQuery.data || { categories: [], grandTotal: null };
  var togglePortfolioAccount = useCallback(function (id, enabled) {
    apiPost('/api/portfolio/accounts/' + id, { enabled: enabled }).catch(function () {});
    accountsQuery.refetch();
    try { window.dispatchEvent(new CustomEvent('tcs:accounts-changed')); } catch (e) {}
  }, [accountsQuery]);

  var notifications = useMemo(() => {
    var items = [];
    var now = new Date().toISOString();
    var providers = healthQuery.data?.providers || [];
    providers.forEach(function(p) {
      if (p.status === 'degraded') {
        items.push({ id: 'prov-' + p.provider + '-degraded', severity: 'warning', title: p.displayName + ' degraded', detail: p.message || 'Provider performance degraded', timestamp: p.checkedAt || now });
      }
      if (p.status === 'error' || p.status === 'unreachable') {
        items.push({ id: 'prov-' + p.provider + '-down', severity: 'critical', title: p.displayName + ' unreachable', detail: p.message || 'Provider is not responding', timestamp: p.checkedAt || now });
      }
    });
    var decisions = autoQuery.data?.recentDecisions || [];
    var errs = decisions.filter(function(d) { return d.decision === 'ERROR' || d.decision === 'BLOCKED'; });
    if (errs.length > 0) {
      items.push({ id: 'auto-recent-errors', severity: 'warning', title: errs.length + ' automation error' + (errs.length > 1 ? 's' : ''), detail: errs.slice(0, 3).map(function(d) { return d.symbol + ': ' + d.reason; }).join('; '), timestamp: now });
    }
    return items;
  }, [healthQuery.data, autoQuery.data]);

  var visible = notifications.filter(function(n) { return !dismissed.has(n.id); });
  var criticalCount = visible.filter(function(n) { return n.severity === 'critical'; }).length;
  var alertActive = alertsQuery.data?.active || 0;
  var alertCritical = alertsQuery.data?.critical || 0;
  var totalUnread = visible.length + alertActive;

  // Read current global preference values
  var displayMode = prefs.displayMode || 'focused';
  var experienceLevel = prefs.experienceLevel || 'beginner';
  var hidePageTitle = prefs.hidePageTitle === true;
  var hidePageSubtitle = prefs.hidePageSubtitle === true;
  var highContrastText = prefs.highContrastText === true;
  var colorBlindMode = prefs.colorBlindMode === true;
  var hidePracticeData = prefs.hidePracticeData === true;
  var showTrainingGuidance = prefs.showTrainingGuidance !== false;
  var fontScale = prefs.fontScale || 'normal';
  var focusIndicatorStyle = prefs.focusIndicatorStyle || 'strong';
  var layoutSize = prefs.layoutSize || 'normal';

  // Read view-specific values from localStorage
  var [values, setValues] = useState(function () {
    return readRegistryValues(registry);
  });

  useEffect(function () {
    setValues(readRegistryValues(registry));
  }, [activeView]);

  var handleViewChange = useCallback(function (key, value) {
    var next = { ...values, [key]: value };
    setValues(next);
    try { localStorage.setItem(key, value); } catch (e) {}
    if (onSettingsChange) onSettingsChange({ key: key, value: value });
  }, [values, onSettingsChange]);

  var handleGlobalChange = useCallback(function (field, value) {
    setPref(field, value);
  }, [setPref]);

  // Close on Escape
  useEffect(function () {
    if (!isOpen) return;
    var onKey = function (e) { if (e.key === 'Escape') onToggle(); };
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, [isOpen, onToggle]);

  // Build global section state for rendering
  var globalValueMap = { displayMode: displayMode, experienceLevel: experienceLevel, hidePageTitle: hidePageTitle, hidePageSubtitle: hidePageSubtitle, highContrastText: highContrastText, colorBlindMode: colorBlindMode, hidePracticeData: hidePracticeData, showTrainingGuidance: showTrainingGuidance, fontScale: fontScale, focusIndicatorStyle: focusIndicatorStyle };
  var hasGlobalSections = true; // always show global section
  var hasViewSections = registry && registry.sections.length > 0;

  // Apply hide title/subtitle preferences to the document so CSS can respond
  useEffect(function () {
    document.documentElement.dataset.hidePageTitle = hidePageTitle ? 'true' : 'false';
    document.documentElement.dataset.hidePageSubtitle = hidePageSubtitle ? 'true' : 'false';
  }, [hidePageTitle, hidePageSubtitle]);

  // Apply font scale preference to the document so CSS can respond
  useEffect(function () {
    document.documentElement.setAttribute('data-font-scale', fontScale || 'normal');
  }, [fontScale]);

  // Apply focus indicator style preference to the document so CSS can respond
  useEffect(function () {
    document.documentElement.setAttribute('data-focus-indicator-style', focusIndicatorStyle || 'strong');
  }, [focusIndicatorStyle]);

  // Apply layout size preference to the document so CSS can respond
  useEffect(function () {
    document.documentElement.setAttribute('data-layout-size', layoutSize || 'normal');
  }, [layoutSize]);

  // Apply color-blind mode preference to the document so CSS can respond
  useEffect(function () {
    document.documentElement.setAttribute('data-colorblind', colorBlindMode ? 'true' : 'false');
  }, [colorBlindMode]);

  return (
    <>
      {/* Sticky buttons */}
      <div className="so-sticky-btns">
        {statusLevel && (
          <button
            className="so-gear-btn"
            onClick={() => window.location.href = '/status/setup'}
            title={`Bridge: ${isMt5Online ? 'Connected' : 'Offline'} | API: ${isApiOnline ? 'Online' : 'Offline'} | DB: ${isDbOnline ? 'Connected' : 'Offline'}`}
            aria-label="System status"
            style={{ color: statusLevel === 'online' ? '#22c55e' : statusLevel === 'warn' ? '#f59e0b' : '#ef4444' }}
          >
            !
          </button>
        )}
        <button
          className={`so-gear-btn ${isBookmarked ? 'so-bookmarked' : ''}`}
          onClick={onToggleBookmark}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
        >
          {isBookmarked ? '⭐' : '☆'}
        </button>
        {viewExplanation && (
          <div className="so-info-wrap">
            <button
              className={`so-gear-btn so-info-btn ${infoOpen ? 'so-gear-active' : ''}`}
              onClick={() => setInfoOpen((v) => !v)}
              title="View explanation"
              aria-label="View explanation"
            >
              ℹ
            </button>
            {infoOpen && (
              <div className="so-info-popover">
                <div className="so-info-pop-title">About this view</div>
                <div className="so-info-pop-text">{viewExplanation}</div>
                <button className="so-info-pop-close" onClick={() => setInfoOpen(false)}>×</button>
              </div>
            )}
          </div>
        )}
        <button
          className="ksh-trigger"
          onClick={() => setGlossaryOpen((v) => !v)}
          title="Trading Glossary"
          aria-label="Open trading glossary"
          style={{ right: 174 }}
        >
          📖
        </button>
        <button
          className={`so-gear-btn ${isOpen ? 'so-gear-active' : ''}`}
          onClick={onToggle}
          title={`Screen Options${registry ? ` — ${registry.title}` : ''}`}
          aria-label="Open screen options"
        >
          ⚙
        </button>
        <div className="notif-disc">
          <button
            type="button"
            className={`notif-bell ${notifOpen ? 'active' : ''} ${criticalCount > 0 ? 'has-critical' : ''}`}
            onClick={function() { setNotifOpen(function(v) { return !v; }); }}
            aria-label={'Notifications - ' + totalUnread + ' unread'}
            title={totalUnread + ' notification' + (totalUnread !== 1 ? 's' : '')}
          >
            <svg className="notif-svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {totalUnread > 0 && (
              <span className="notif-badge">{totalUnread}</span>
            )}
          </button>
          {notifOpen && (
            <>
              <div className="notif-backdrop" onClick={function() { setNotifOpen(false); }} />
              <div className="notif-dropdown">
                <div className="notif-header">
                  <h3>Notifications</h3>
                </div>
                {visible.length === 0 ? (
                  <p className="notif-empty">All clear - no notifications.</p>
                ) : (
                  <div className="notif-list">{visible.length} notification(s)</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sidebar rail — hidable like Dev Tools (no backdrop, no overlay) */}
      {isOpen && (
        <aside className="so-rail" aria-label="Screen options">
              <div className="so-header">
                <h2 className="so-title">
                  Screen Options
                  {registry && <span className="so-view-name"> — {registry.title}</span>}
                </h2>
                <button className="so-close-btn" onClick={onToggle} aria-label="Close screen options">
                  ✕
                </button>
              </div>

              <div className="so-body">
                {/* ── Global preferences (always shown) ── */}
                <div className="so-global-section">
                  <h3 className="so-global-label">Preferences</h3>
                  {GLOBAL_PREFERENCES.map(function (section) {
                    return (
                      <div key={section.id} className="so-section">
                        <h3 className="so-section-title" title={section.description}>{section.label}</h3>
                        {section.type === 'radio' && (
                          <div className={`so-radio-group so-radio-group--${section.id}`}>
                            {section.options.map(function (opt) {
                              var currentValue = globalValueMap[section.field];
                              return (
                                <label
                                  key={opt.value}
                                  className={'so-radio-option' + (currentValue === opt.value ? ' so-radio-selected' : '')}
                                  title={opt.desc}
                                >
                                  <input
                                    type="radio"
                                    name={'global-' + section.field}
                                    value={opt.value}
                                    checked={currentValue === opt.value}
                                    onChange={function () { handleGlobalChange(section.field, opt.value); }}
                                  />
                                  <span className="so-radio-content">
                                    <span className="so-radio-label">{opt.label}</span>
                                    <span className="so-radio-desc">{opt.desc}</span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                        {section.type === 'checkbox' && (
                          <label className="so-checkbox-option">
                            <input
                              type="checkbox"
                              defaultChecked={globalValueMap[section.field] === true}
                              onChange={function (e) { handleGlobalChange(section.field, e.target.checked); }}
                            />
                            <span>{section.description || section.label}</span>
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ── View-specific options ── */}
                {hasViewSections ? (
                  <div className="so-view-section">
                    <h3 className="so-global-label">View Options — {registry.title}</h3>
                    {registry.sections.map(function (section) {
                      return (
                        <div key={section.id} className="so-section">
                          <h3 className="so-section-title" title={section.description}>{section.label}</h3>
                          {section.type === 'radio' && (
                            <div className={`so-radio-group so-radio-group--${section.id}`}>
                              {section.options.map(function (opt) {
                                return (
                                  <label
                                    key={opt.value}
                                    className={'so-radio-option' + (values[section.key] === opt.value ? ' so-radio-selected' : '')}
                                    title={opt.desc}
                                  >
                                    <input
                                      type="radio"
                                      name={section.key}
                                      value={opt.value}
                                      checked={values[section.key] === opt.value}
                                      onChange={function () { handleViewChange(section.key, opt.value); }}
                                    />
                                    <span className="so-radio-content">
                                      <span className="so-radio-label">{opt.label}</span>
                                      <span className="so-radio-desc">{opt.desc}</span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {section.type === 'checkbox' && (
                            <label className="so-checkbox-option">
                              <input
                                type="checkbox"
                                checked={values[section.key] === 'true' || values[section.key] === true}
                                onChange={function (e) { handleViewChange(section.key, String(e.target.checked)); }}
                              />
                              <span>{section.description || section.label}</span>
                            </label>
                          )}
                          {section.type === 'columns' && (
                            <div className="so-columns-grid">
                              {section.options.map(function (opt) {
                                return (
                                  <label key={opt.key} className="so-checkbox-option" title={opt.desc}>
                                    <input
                                      type="checkbox"
                                      checked={values[opt.key] === 'true' || values[opt.key] === true}
                                      onChange={function (e) { handleViewChange(opt.key, String(e.target.checked)); }}
                                    />
                                    <span>{opt.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {section.type === 'accounts' && (
                            <div className="so-accounts">
                              {(portfolioAccounts.categories || []).map(function (cat) {
                                return (
                                  <div key={cat.id} className="so-accounts-cat">
                                    <label className="so-checkbox-option so-accounts-cat-head">
                                      <input
                                        type="checkbox"
                                        checked={cat.enabled === true}
                                        onChange={function (e) { togglePortfolioAccount('cat:' + cat.id, e.target.checked); }}
                                      />
                                      <span>{cat.label} — {cat.enabled ? ('£' + Number(cat.total || 0).toFixed(2)) : 'excluded'}</span>
                                    </label>
                                    {(cat.accounts || []).map(function (acc) {
                                      return (
                                        <label key={acc.id} className="so-checkbox-option so-accounts-item" title={acc.note || acc.label}>
                                          <input
                                            type="checkbox"
                                            checked={acc.enabled === true}
                                            disabled={!acc.connected}
                                            onChange={function (e) { togglePortfolioAccount(acc.id, e.target.checked); }}
                                          />
                                          <span>
                                            {acc.label}
                                            {acc.value != null ? ' — £' + Number(acc.value).toFixed(2) : ''}
                                            {!acc.connected ? ' (not connected)' : ''}
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState icon="⚙" title="No view-specific options" description="This view has no additional configurable options." />
                )}
              </div>

              <div className="so-footer">
                <button className="so-done-btn" onClick={onToggle}>
                  Done
                </button>
              </div>
        </aside>
      )}

      {/* ── Calculators Panel ── */}
      <AnimatePresence>
        {calcOpen && (
          <>
            <motion.div
              className="so-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCalcOpen(false)}
            />
            <motion.div
              className="so-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            >
              <div className="so-header">
                <h2 className="so-title">Quick Calculators</h2>
                <button className="so-close-btn" onClick={() => setCalcOpen(false)} aria-label="Close calculators">✕</button>
              </div>
              <div className="so-body">
                <CalcPanel />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Glossary Overlay ── */}
      <AnimatePresence>
        {glossaryOpen && (
          <motion.div
            className="ksh-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => { if (e.target === e.currentTarget) setGlossaryOpen(false); }}
          >
            <motion.div
              className="ksh-modal"
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ maxWidth: '680px', maxHeight: '85vh' }}
            >
              <div className="ksh-header">
                <h2>📖 Trading Glossary</h2>
                <button className="ksh-close" onClick={() => setGlossaryOpen(false)} aria-label="Close glossary">×</button>
              </div>
              <div className="ksh-body">
                <GlossaryPage compact />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** ── Embedded calculator panel ── */
function CalcPanel() {
  var [account, setAccount] = useState(10000);
  var [riskPct, setRiskPct] = useState(2);
  var [entry, setEntry] = useState(100);
  var [stopLoss, setStopLoss] = useState(95);
  var [tpEntry, setTpEntry] = useState(100);
  var [tpSl, setTpSl] = useState(95);
  var [tpTp, setTpTp] = useState(115);

  var riskAmount = account * (riskPct / 100);
  var riskPerShare = Math.abs(entry - stopLoss);
  var maxShares = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;
  var totalValue = maxShares * entry;

  var rrRisk = Math.abs(tpEntry - tpSl);
  var rrReward = Math.abs(tpTp - tpEntry);
  var rrRatio = rrRisk > 0 ? rrReward / rrRisk : 0;

  return (
    <div className="so-calc-panel">
      {/* Position Size */}
      <div className="so-calc-section">
        <h3>Position Size</h3>
        <div className="so-calc-fields">
          <CalcInput label="Account ($)" value={account} onChange={setAccount} />
          <CalcInput label="Risk %" value={riskPct} onChange={setRiskPct} step="0.1" />
          <CalcInput label="Entry ($)" value={entry} onChange={setEntry} step="0.01" />
          <CalcInput label="Stop Loss ($)" value={stopLoss} onChange={setStopLoss} step="0.01" />
          <div className="so-calc-results">
            <CalcResult label="Max Shares" value={maxShares} />
            <CalcResult label="Position $" value={`$${totalValue.toFixed(0)}`} />
            <CalcResult label="Risk $" value={`$${riskAmount.toFixed(0)}`} />
          </div>
        </div>
      </div>

      {/* Risk/Reward */}
      <div className="so-calc-section">
        <h3>Risk / Reward</h3>
        <div className="so-calc-fields">
          <CalcInput label="Entry ($)" value={tpEntry} onChange={setTpEntry} step="0.01" />
          <CalcInput label="Stop Loss ($)" value={tpSl} onChange={setTpSl} step="0.01" />
          <CalcInput label="Take Profit ($)" value={tpTp} onChange={setTpTp} step="0.01" />
          <div className="so-calc-results">
            <CalcResult label="Risk" value={`$${rrRisk.toFixed(1)}`} />
            <CalcResult label="Reward" value={`$${rrReward.toFixed(1)}`} />
            <CalcResult label="R:R" value={`1:${rrRatio.toFixed(1)}`} highlight />
          </div>
        </div>
      </div>
    </div>
  );
}

function CalcInput({ label, value, onChange, step }) {
  return (
    <div className="so-calc-input">
      <label>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        step={step}
      />
    </div>
  );
}

function CalcResult({ label, value, highlight }) {
  return (
    <div className="so-calc-result">
      <span>{label}</span>
      <strong className={highlight ? 'so-calc-highlight' : ''}>{value}</strong>
    </div>
  );
}
