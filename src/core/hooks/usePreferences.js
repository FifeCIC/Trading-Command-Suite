import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'tcs:preferences';

const DEFAULTS = {
  defaultSignalSymbols: '',
  defaultProtocol: '',
  riskMaxDrawdown: 25,
  riskMaxPositions: 5,
  riskMaxPerSymbol: 25,
  riskMaxPerTrade: 2,
  circuitBreakerDrawdownTrigger: 20,
  circuitBreakerExposureTrigger: 80,
  researchRefreshInterval: 30000,
  signalsAutoRefresh: false,
  signalsRefreshInterval: 60000,
  // Display
  defaultTimeframe: '1h',
  decimalPlaces: 2,
  compactMode: false,
  tableStyle: 'default',      // 'default' | 'compact' | 'bordered' | 'striped'
  // Experience level — controls feature gating
  experienceLevel: 'beginner', // 'beginner' | 'experienced' | 'expert'
  // Accessibility & UX
  pageTransitions: true,       // View Transitions API page morphing
  keyboardShortcutsHelp: true, // Show keyboard shortcuts helper
  highContrastText: false,     // Boost text contrast for accessibility
  // Performance
  pollingInterval: 30,
  chartAnimation: true,
  // Degradation — how the system behaves when providers fail
  degradationNotify: true,
  degradationPauseAutomation: true,
  degradationCloseProfitable: false,
  degradationAdjustStops: false,
  degradationMinProviderHealth: 50,
  // Automation — auto-start behaviour
  autoStartAutomation: true,   // Restore loop + MT5 trading state on server start
};

let cached = null;

function load() {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cached = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached;
}

function save(prefs) {
  cached = prefs;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* noop */ }
}

let listeners = [];
function subscribe(cb) {
  listeners.push(cb);
  return () => { listeners = listeners.filter(l => l !== cb); };
}
function notify() {
  listeners.forEach(cb => cb());
}

function getSnapshot() {
  return load();
}

/**
 * Shared preferences hook — reads/writes localStorage with defaults.
 * Works across all three new feature pages (Signals, Risk, Research).
 */
export function usePreferences() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const set = useCallback((key, value) => {
    const next = { ...load(), [key]: value };
    save(next);
    notify();
  }, []);

  const setMany = useCallback((updates) => {
    const next = { ...load(), ...updates };
    save(next);
    notify();
  }, []);

  const reset = useCallback(() => {
    save({ ...DEFAULTS });
    notify();
  }, []);

  return { prefs, set, setMany, reset, defaults: DEFAULTS };
}

/**
 * Get preferences synchronously (for non-React contexts).
 */
export function getPreferences() {
  return load();
}
