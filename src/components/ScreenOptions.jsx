/**
 * ScreenOptions — Reusable overlay for per-view configuration.
 * First use case: Speed Scanner trade mode selection.
 * Extensible to other views via the view registry pattern.
 *
 * #249 — Screen Options overlay + sticky options button
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import './screen-options.css';

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
    ],
  },
};

export default function ScreenOptions({ activeView, onSettingsChange, isOpen, onToggle }) {
  const registry = activeView ? OPTIONS_REGISTRY[activeView] : null;

  // Read current values from localStorage
  const [values, setValues] = useState(() => {
    const initial = {};
    if (registry) {
      for (const section of registry.sections) {
        try {
          initial[section.key] = localStorage.getItem(section.key) || section.defaultValue;
        } catch {
          initial[section.key] = section.defaultValue;
        }
      }
    }
    return initial;
  });

  // Sync values when view changes
  useEffect(() => {
    if (registry) {
      const next = {};
      for (const section of registry.sections) {
        try {
          next[section.key] = localStorage.getItem(section.key) || section.defaultValue;
        } catch {
          next[section.key] = section.defaultValue;
        }
      }
      setValues(next);
    }
  }, [activeView]);

  const handleChange = useCallback((key, value) => {
    const next = { ...values, [key]: value };
    setValues(next);
    try { localStorage.setItem(key, value); } catch {}
    if (onSettingsChange) onSettingsChange({ key, value });
  }, [values, onSettingsChange]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onToggle(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onToggle]);

  return (
    <>
      {/* Sticky gear button */}
      <button
        className={`so-gear-btn ${isOpen ? 'so-gear-active' : ''}`}
        onClick={onToggle}
        title={`Screen Options${registry ? ` — ${registry.title}` : ''}`}
        aria-label="Open screen options"
      >
        ⚙
      </button>

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
                {!registry ? (
                  <p className="so-empty">No options available for this view.</p>
                ) : (
                  registry.sections.map((section) => (
                    <div key={section.id} className="so-section">
                      <h3 className="so-section-title">{section.label}</h3>
                      {section.description && (
                        <p className="so-section-desc">{section.description}</p>
                      )}
                      {section.type === 'radio' && (
                        <div className="so-radio-group">
                          {section.options.map((opt) => (
                            <label
                              key={opt.value}
                              className={`so-radio-option ${values[section.key] === opt.value ? 'so-radio-selected' : ''}`}
                            >
                              <input
                                type="radio"
                                name={section.key}
                                value={opt.value}
                                checked={values[section.key] === opt.value}
                                onChange={() => handleChange(section.key, opt.value)}
                              />
                              <span className="so-radio-content">
                                <span className="so-radio-label">{opt.label}</span>
                                <span className="so-radio-desc">{opt.desc}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
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
