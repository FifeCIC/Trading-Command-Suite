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

export default function ScreenOptions({ activeView, onSettingsChange, isOpen, onToggle, isBookmarked, onToggleBookmark }) {
  var prefs = usePreferences();
  var registry = activeView ? OPTIONS_REGISTRY[activeView] : null;

  // Read current global preference values
  var displayMode = prefs.displayMode || 'focused';
  var experienceLevel = prefs.experienceLevel || 'beginner';
  var hidePageTitle = prefs.hidePageTitle === true;
  var hidePageSubtitle = prefs.hidePageSubtitle === true;

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
  var globalValueMap = { displayMode: displayMode, experienceLevel: experienceLevel, hidePageTitle: hidePageTitle, hidePageSubtitle: hidePageSubtitle };
  var hasGlobalSections = true; // always show global section
  var hasViewSections = registry && registry.sections.length > 0;

  return (
    <>
      {/* Sticky buttons */}
      <div className="so-sticky-btns">
        <button
          className={`so-gear-btn ${isBookmarked ? 'so-bookmarked' : ''}`}
          onClick={onToggleBookmark}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
        >
          {isBookmarked ? '⭐' : '☆'}
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
    </>
  );
}
