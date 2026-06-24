import { create } from 'zustand';

/**
 * Lightweight ticker store — holds a rotating queue of background-event
 * messages for the header ticker bar.  Not persisted (transient only).
 *
 * Each entry: { id, message, source, timestamp }
 *   source: 'sees' | 'trading' | 'alert' | 'system'
 */

const MAX_ENTRIES = 50;

export const useTickerStore = create((set, get) => ({
  queue: [],
  index: -1, // points to the currently displayed entry; -1 = empty

  push: (message, source = 'system') => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      message,
      source,
      timestamp: Date.now(),
    };
    set((state) => {
      const next = [entry, ...state.queue].slice(0, MAX_ENTRIES);
      // If nothing is currently displayed, show this immediately
      const idx = state.index < 0 ? 0 : state.index + 1;
      return { queue: next, index: idx >= next.length ? 0 : idx };
    });
  },

  advance: () => {
    const { queue, index } = get();
    if (queue.length === 0) return;
    set({ index: (index + 1) % queue.length });
  },

  /** Returns the currently active message, or null if queue is empty. */
  current: () => {
    const { queue, index } = get();
    if (queue.length === 0 || index < 0 || index >= queue.length) return null;
    return queue[index];
  },
}));
