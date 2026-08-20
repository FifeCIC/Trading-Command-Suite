import { useState, useEffect, useCallback } from 'react';

const PREFIX = 'tcs:view-state:';

/**
 * usePersistentState — localStorage-backed state that survives navigation.
 * =========================================================================
 * Global mechanism for remembering filter/sort/form selections across the
 * ladders and table views. Unlike the global `usePreferences()` (which is for
 * user settings surfaced on the Settings page), this is lightweight view state
 * — each value persists under its own `key` (e.g. 'ladder:rankBy') so pages can
 * remember the user's last selection when they navigate away and back.
 *
 * @param {string} key       Unique storage key, namespaced per view (e.g. 'symbols-ladder:signal').
 * @param {*}      defaultValue  Value used when nothing is stored yet.
 * @returns {[state, setState]}  Same API as useState.
 */
export function usePersistentState(key, defaultValue) {
  const storageKey = `${PREFIX}${key}`;

  // Lazy initialise from localStorage (guarded for no-storage environments).
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw != null ? JSON.parse(raw) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  // Persist on change.
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* noop */ }
  }, [storageKey, state]);

  // Keep in sync across tabs/windows for the same key.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === storageKey && e.newValue != null) {
        try { setState(JSON.parse(e.newValue)); } catch { /* noop */ }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  return [state, setState];
}

/**
 * Convenience wrapper for the common "choice from a set" filter case:
 * validates the stored value against the allowed options and falls back to the
 * default otherwise (handles schema changes / removed options gracefully).
 */
export function usePersistentChoice(key, defaultValue, allowed = []) {
  const [value, setValue] = usePersistentState(key, defaultValue);
  const valid = allowed.includes(value) ? value : defaultValue;
  return [valid, setValue];
}
