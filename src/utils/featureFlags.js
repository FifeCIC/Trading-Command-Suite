const STORAGE_KEY = 'TRADINGCS_FEATURE_FLAGS';
const API = '/api/feature-flags';

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

/** Push a flag change to server */
function pushFlag(name, enabled) {
  fetch(`${API}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }).catch(() => {});
}

let state = load();

const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(state));
}

/** Hydrate from server on init */
fetch(API).then(r => r.json()).then(flags => {
  if (Array.isArray(flags) && flags.length) {
    const map = {};
    for (const f of flags) map[f.id] = f.enabled;
    state = { ...DEFAULTS, ...map };
    save(state);
    notify();
  }
}).catch(() => {});

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
    pushFlag(name, true);
    notify();
  },

  /** Disable a flag */
  disable(name) {
    state = { ...state, [name]: false };
    save(state);
    pushFlag(name, false);
    notify();
  },

  /** Toggle a flag */
  toggle(name) {
    const next = !state[name];
    state = { ...state, [name]: next };
    save(state);
    pushFlag(name, next);
    notify();
  },

  /** Reset to defaults */
  reset() {
    state = { ...DEFAULTS };
    save(state);
    for (const [k, v] of Object.entries(DEFAULTS)) pushFlag(k, v);
    notify();
  },

  /** Subscribe to flag changes */
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
