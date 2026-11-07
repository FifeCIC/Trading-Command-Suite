/* ── PLANNED IN #1235 ──
 * MISSING:  reachability. Nothing in src/ or nest/src/ names this file — no import, no route,
 *           no dynamic load. Either it is dead code, or it is a capability nobody wired up, and
 *           those two need opposite responses.
 * TODAY:    found by the name-reference scan in scripts/audit-code-health.cjs (see
 *           docs/CODE-HEALTH.md). Decide DELETE / WIRE UP / KEEP+explain, record it on the
 *           issue, then re-bank: node scripts/audit-code-health.cjs --write
 * WHEN BUILT: the file is either gone, or reachable and named by something.
 * CODE-HEALTH-MARKER — written by scripts/audit-code-health.cjs; re-run it rather than editing.
 */

import { useEffect, useCallback } from 'react';

/**
 * useKeyboardShortcuts — registers global keyboard shortcuts.
 * Skips when focus is in an input/textarea/select element.
 *
 * @param {Object} shortcuts - Map of key to handler function
 *   e.g. { r: () => refresh(), '?': () => toggleHelp() }
 */
export default function useKeyboardShortcuts(shortcuts) {
  const handleKeyDown = useCallback((e) => {
    // Don't fire when typing in inputs
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Don't fire when modifiers are held (except no-modifier shortcuts)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const handler = shortcuts[e.key];
    if (handler) {
      e.preventDefault();
      handler();
    }
  }, [shortcuts]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
