/**
 * ScreenOptions — Reusable overlay for per-view configuration.
 * First use case: Speed Scanner trade mode selection.
 * Extensible to other views via the view registry pattern.
 *
 * #249 — Screen Options overlay + sticky options button
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { usePreferences } from '../core/hooks/usePreferences';
import EmptyState from './EmptyState';
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
  'directives-manager': {
    title: 'Directives Manager',
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
};

export default function ScreenOptions({ activeView, onSettingsChange, isOpen, onToggle, isBookmarked, onToggleBookmark, statusLevel, isMt5Online, isApiOnline, isDbOnline }) {
  var prefs = usePreferences();
  var registry = activeView ? OPTIONS_REGISTRY[activeView] : null;
  var [calcOpen, setCalcOpen] = useState(false);

  // Read current global preference values
  var displayMode = prefs.displayMode || 'focused';
  var experienceLevel = prefs.experienceLevel || 'beginner';
  var hidePageTitle = prefs.hidePageTitle === true;
  var hidePageSubtitle = prefs.hidePageSubtitle === true;
  var highContrastText = prefs.highContrastText === true;
  var colorBlindMode = prefs.colorBlindMode === true;
  var fontScale = prefs.fontScale || 'normal';
  var focusIndicatorStyle = prefs.focusIndicatorStyle || 'strong';

  // Read view-specific values from localStorage
  var [values, setValues] = useState(function () {
    var initial = {};
    if (registry) {
      for (var i = 0; i < registry.sections.length; i++) {
        var section = registry.sections[i];
        try {
          initial[section.key] = localStorage.getItem(section.key) || section.defaultValue;
        } catch (e) {
          initial[section.key] = section.defaultValue;
        }
      }
    }
    return initial;
  });

  useEffect(function () {
    if (registry) {
      var next = {};
      for (var i = 0; i < registry.sections.length; i++) {
        var section = registry.sections[i];
        try {
          next[section.key] = localStorage.getItem(section.key) || section.defaultValue;
        } catch (e) {
          next[section.key] = section.defaultValue;
        }
      }
      setValues(next);
    }
  }, [activeView]);

  var handleViewChange = useCallback(function (key, value) {
    var next = { ...values, [key]: value };
    setValues(next);
    try { localStorage.setItem(key, value); } catch (e) {}
    if (onSettingsChange) onSettingsChange({ key: key, value: value });
  }, [values, onSettingsChange]);

  var handleGlobalChange = useCallback(function (field, value) {
    prefs.set(field, value);
  }, [prefs]);

  // Close on Escape
  useEffect(function () {
    if (!isOpen) return;
    var onKey = function (e) { if (e.key === 'Escape') onToggle(); };
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, [isOpen, onToggle]);

  // Build global section state for rendering
  var globalValueMap = { displayMode: displayMode, experienceLevel: experienceLevel, hidePageTitle: hidePageTitle, hidePageSubtitle: hidePageSubtitle, highContrastText: highContrastText, colorBlindMode: colorBlindMode, fontScale: fontScale, focusIndicatorStyle: focusIndicatorStyle };
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
            onClick={() => window.location.href = '/status/status'}
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
        <button
          className={`so-gear-btn ${calcOpen ? 'so-gear-active' : ''}`}
          onClick={() => setCalcOpen((v) => !v)}
          title="Quick Calculators"
          aria-label="Open Calculators"
        >
          C
        </button>
        <button
          className={`so-gear-btn ${isOpen ? 'so-gear-active' : ''}`}
          onClick={onToggle}
          title={`Screen Options${registry ? ` — ${registry.title}` : ''}`}
          aria-label="Open screen options"
        >
          ⚙
        </button>
      </div>

      {/* Overlay */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="so-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onToggle}
            />
            <motion.div
              className="so-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            >
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
                        <h3 className="so-section-title">{section.label}</h3>
                        {section.description && (
                          <p className="so-section-desc">{section.description}</p>
                        )}
                        {section.type === 'radio' && (
                          <div className="so-radio-group">
                            {section.options.map(function (opt) {
                              var currentValue = globalValueMap[section.field];
                              return (
                                <label
                                  key={opt.value}
                                  className={'so-radio-option' + (currentValue === opt.value ? ' so-radio-selected' : '')}
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
                              checked={globalValueMap[section.field] === true}
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
                          <h3 className="so-section-title">{section.label}</h3>
                          {section.description && (
                            <p className="so-section-desc">{section.description}</p>
                          )}
                          {section.type === 'radio' && (
                            <div className="so-radio-group">
                              {section.options.map(function (opt) {
                                return (
                                  <label
                                    key={opt.value}
                                    className={'so-radio-option' + (values[section.key] === opt.value ? ' so-radio-selected' : '')}
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
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
              <div className="so-body" style={{ padding: '16px 20px', overflowY: 'auto' }}>
                <CalcPanel />
              </div>
            </motion.div>
          </>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Position Size */}
      <div>
        <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.5rem', color: 'var(--ink)' }}>Position Size</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <CalcInput label="Account ($)" value={account} onChange={setAccount} />
          <CalcInput label="Risk %" value={riskPct} onChange={setRiskPct} step="0.1" />
          <CalcInput label="Entry ($)" value={entry} onChange={setEntry} step="0.01" />
          <CalcInput label="Stop Loss ($)" value={stopLoss} onChange={setStopLoss} step="0.01" />
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
            <CalcResult label="Max Shares" value={maxShares} />
            <CalcResult label="Position $" value={`$${totalValue.toFixed(0)}`} />
            <CalcResult label="Risk $" value={`$${riskAmount.toFixed(0)}`} />
          </div>
        </div>
      </div>

      {/* Risk/Reward */}
      <div>
        <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.5rem', color: 'var(--ink)' }}>Risk / Reward</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <CalcInput label="Entry ($)" value={tpEntry} onChange={setTpEntry} step="0.01" />
          <CalcInput label="Stop Loss ($)" value={tpSl} onChange={setTpSl} step="0.01" />
          <CalcInput label="Take Profit ($)" value={tpTp} onChange={setTpTp} step="0.01" />
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <label style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', minWidth: '90px', textTransform: 'uppercase' }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        step={step}
        style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--line)', borderRadius: '4px', background: 'var(--bg)', color: 'var(--ink)', fontSize: '0.82rem', fontFamily: 'inherit' }}
      />
    </div>
  );
}

function CalcResult({ label, value, highlight }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--bg)', padding: '6px 10px', borderRadius: '4px', flex: 1 }}>
      <span style={{ fontSize: '0.6rem', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>{label}</span>
      <strong style={{ fontSize: '0.82rem', color: highlight ? 'var(--accent)' : 'var(--ink)' }}>{value}</strong>
    </div>
  );
}
