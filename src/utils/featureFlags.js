const STORAGE_KEY = 'TRADINGCS_FEATURE_FLAGS';

const DEFAULTS = {
  scoringPipeline: true,
  directiveConfig: true,
  importJobs: false,
  providerHealth: true,
  dataStatus: true,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(flags) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch { /* quota exceeded — ignore */ }
}

let state = load();

const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(state));
}

export const featureFlags = {
  /** Get current flags snapshot */
  getFlags() {
    return { ...state };
  },

  /** Check if a flag is enabled */
  isEnabled(name) {
    return Boolean(state[name]);
  },

  /** Enable a flag */
  enable(name) {
    state = { ...state, [name]: true };
    save(state);
    notify();
  },

  /** Disable a flag */
  disable(name) {
    state = { ...state, [name]: false };
    save(state);
    notify();
  },

  /** Toggle a flag */
  toggle(name) {
    state = { ...state, [name]: !state[name] };
    save(state);
    notify();
  },

  /** Reset to defaults */
  reset() {
    state = { ...DEFAULTS };
    save(state);
    notify();
  },

  /** Subscribe to flag changes */
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
