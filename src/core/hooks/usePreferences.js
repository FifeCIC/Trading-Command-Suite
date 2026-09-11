import { useCallback, useEffect, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'tcs:preferences';
const API = '/api/preferences';

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
  // Display classification — controls information density and language
  displayMode: 'focused',     // 'focused' | 'technical'
  // Accessibility & UX
  pageTransitions: true,       // View Transitions API page morphing
  keyboardShortcutsHelp: true, // Show keyboard shortcuts helper
  highContrastText: false,     // Boost text contrast for accessibility
  fontScale: 'normal',         // Font size scaling: 'small' | 'normal' | 'large' | 'x-large'
  focusIndicatorStyle: 'strong', // Focus ring: 'strong' | 'subtle' | 'none'
  layoutSize: 'normal',         // Content width: 'compact' | 'normal' | 'wide' | 'full'
  colorBlindMode: false,         // WCAG 1.4.1 — adds shape/pattern indicators alongside color (#358)
  hidePracticeData: false,       // Hide practice/paper trading data across views (#450)
  showTrainingGuidance: true,    // Show beginner-friendly explanations and tips (#445)
  dismissedGuides: {},            // Map of guideId → ISO timestamp for dismissed training containers
  // News Tape — market tape news headline configuration
  newsTapeGlobal: true,           // Show globally-impacting (macro) headline in the market tape
  newsTapeSymbol: true,           // Show symbol-priority (positions/scored) headline in the market tape
  newsTapeRotateSec: 30,          // Seconds between headline rotation (global ↔ symbol)
  // ── Market Tape sections (2026-09-11) ──────────────────────────────────────────
  // MIGRATED from the tape's own localStorage key `tcs:market-tape`. There were two
  // competing preference stores: the tape's private one and this server-synced one.
  // Two stores meant a section could be toggled in Settings and stay unchanged on the
  // tape, which is exactly the "silent no-op" class of bug this repo guards against.
  // The tape's legacy key is still READ once (see MarketTape.migrateLegacyTapePrefs) so
  // an existing user's on/off choices carry over instead of being silently reset.
  tapeSessions: true,
  tapeEvents: true,
  tapeProviders: true,
  tapeAuto: true,
  tapeNext: true,
  tapeNews: false,
  tapeTrade: false,
  tapeUptime: false,
  // New sections — all OFF by default so the tape does not silently grow wider for
  // anyone who has not asked for it.
  tapeScore: false,               // Latest score (most recent scoring run)
  tapeProfit: false,              // Latest profit taken (most recent CLOSED winning trade)
  tapeLoss: false,                // Latest loss taken (most recent CLOSED losing trade)
  // Tape scroll speed, in SECONDS PER COPY of the ticker content. Lower = faster.
  // ⚠️ Named distinctly from `newsTapeRotateSec` above. That one controls how often the
  // NEWS HEADLINE swaps between the global and symbol article; it has nothing to do with
  // how fast the strip moves. Sitting side by side in Settings, the two were easy to
  // mistake for one another — that ambiguity is why this is explicitly "scroll".
  tapeScrollSecPerCopy: 12,
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

/** Push a single key to server (fire-and-forget) */
function pushKey(key, value) {
  fetch(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }).catch(() => {});
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

  // Hydrate from server on mount
  useEffect(() => {
    fetch(API).then(r => r.json()).then(remote => {
      if (remote && typeof remote === 'object' && Object.keys(remote).length) {
        const merged = { ...DEFAULTS, ...load(), ...remote };
        save(merged);
        notify();
      }
    }).catch(() => {});
  }, []);

  const set = useCallback((key, value) => {
    const next = { ...load(), [key]: value };
    save(next);
    pushKey(key, value);
    notify();
  }, []);

  const setMany = useCallback((updates) => {
    const next = { ...load(), ...updates };
    save(next);
    for (const [k, v] of Object.entries(updates)) pushKey(k, v);
    notify();
  }, []);

  const reset = useCallback(() => {
    save({ ...DEFAULTS });
    // Push all defaults to server
    for (const [k, v] of Object.entries(DEFAULTS)) pushKey(k, v);
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
