import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUiStore } from '../stores/useUiStore';

const SHORTCUTS = [
  {
    category: 'Trading',
    keys: [
      { combo: 'B', label: 'Buy at market', context: 'Speed Trading, MT5 Trading' },
      { combo: 'S', label: 'Sell at market', context: 'Speed Trading, MT5 Trading' },
      { combo: 'C', label: 'Close position', context: 'Speed Trading, MT5 Trading' },
      { combo: 'Shift + B', label: 'Buy 2× size', context: 'Speed Trading' },
      { combo: 'Shift + S', label: 'Sell 2× size', context: 'Speed Trading' },
    ],
  },
  {
    category: 'Navigation',
    keys: [
      { combo: 'R', label: 'Refresh current view', context: 'All pages' },
      { combo: 'Esc', label: 'Close modal / dismiss', context: 'All pages' },
      { combo: '?', label: 'Toggle this help', context: 'All pages' },
      { combo: '/', label: 'Focus search', context: 'Where available' },
    ],
  },
  {
    category: 'General',
    keys: [
      { combo: 'Ctrl/Cmd + K', label: 'Command palette', context: 'All pages' },
      { combo: 'Ctrl/Cmd + Enter', label: 'Submit form', context: 'Forms' },
    ],
  },
];

export default function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const toggleDevOverlay = useUiStore((state) => state.toggleDevOverlay);

  const toggle = useCallback(() => setOpen((p) => !p), []);

  useEffect(() => {
    const onKey = (e) => {
      // Only ? when not in an input
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
          e.preventDefault();
          toggle();
        }
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, toggle]);

  // Don't render if user disabled it
  useEffect(() => {
    try {
      const raw = localStorage.getItem('tcs:preferences');
      if (raw) {
        const prefs = JSON.parse(raw);
        if (prefs.keyboardShortcutsHelp === false) return;
      }
    } catch { /* no pref */ }
  }, []);

  return (
    <>
      {/* Floating trigger buttons */}
      <button
        type="button"
        className="ksh-trigger"
        onClick={toggleDevOverlay}
        title="Toggle Dev Overlay"
        aria-label="Toggle Dev Overlay"
        style={{ right: 122 }}
      >
        ◈
      </button>
      <button
        type="button"
        className="ksh-trigger"
        onClick={toggle}
        title="Keyboard Shortcuts (press ?)"
        aria-label="Keyboard shortcuts"
      >
        ?
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="ksh-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          >
            <motion.div
              className="ksh-modal"
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <div className="ksh-header">
                <h2>⌨ Keyboard Shortcuts</h2>
                <button className="ksh-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
              </div>

              <div className="ksh-body">
                {SHORTCUTS.map((cat) => (
                  <div key={cat.category} className="ksh-category">
                    <h3 className="ksh-cat-title">{cat.category}</h3>
                    <div className="ksh-keys">
                      {cat.keys.map((k) => (
                        <div key={k.combo} className="ksh-key-row">
                          <kbd className="ksh-kbd">{k.combo}</kbd>
                          <span className="ksh-key-label">{k.label}</span>
                          <span className="ksh-key-context">{k.context}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="ksh-footer">
                Press <kbd className="ksh-kbd-inline">?</kbd> anytime to toggle this panel.
                Disable in Settings → Display → Keyboard Shortcuts Help.
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
