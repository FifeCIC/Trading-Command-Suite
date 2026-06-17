import { create } from 'zustand';

const STORAGE_KEY = 'tcs:current-symbol';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const useCurrentSymbolStore = create((set) => ({
  symbol: loadFromStorage(),
  setSymbol: (symbol) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(symbol));
    } catch { /* ignore */ }
    set({ symbol });
  },
  clearSymbol: () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    set({ symbol: null });
  },
}));
