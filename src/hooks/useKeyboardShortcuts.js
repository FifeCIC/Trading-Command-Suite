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
