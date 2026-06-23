import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useUiStore = create(
  persist(
    (set) => ({
      devOverlayOpen: false,
      themeMode: 'dark',
      themePack: 'scifi',
      backgroundTone: 'aura',
      showNavIcons: true,
      bookmarks: [],
      toggleDevOverlay: () => set((state) => ({ devOverlayOpen: !state.devOverlayOpen })),
      closeDevOverlay: () => set({ devOverlayOpen: false }),
      setThemeMode: (mode) => set({ themeMode: mode === 'dark' ? 'dark' : 'light' }),
      setThemePack: (pack) => {
        const safePack = typeof pack === 'string' && /^[a-z0-9-]{1,64}$/i.test(pack) ? pack : 'scifi';
        set({ themePack: safePack });
      },
      setBackgroundTone: (tone) => {
        const allowed = ['aura', 'slate', 'black'];
        const safeTone = allowed.includes(tone) ? tone : 'aura';
        set({ backgroundTone: safeTone });
      },
      setShowNavIcons: (show) => set({ showNavIcons: !!show }),
      toggleBookmark: (area, view) => set((state) => {
        const id = `${area}/${view}`;
        const exists = state.bookmarks.find((b) => b.id === id);
        if (exists) return { bookmarks: state.bookmarks.filter((b) => b.id !== id) };
        return { bookmarks: [...state.bookmarks, { id, area, view }] };
      }),
      isBookmarked: (area, view) => {
        const id = `${area}/${view}`;
        return (state) => state.bookmarks.some((b) => b.id === id);
      },
    }),
    {
      name: 'tradingcs-theme',
      partialize: (state) => ({
        themeMode: state.themeMode,
        themePack: state.themePack,
        backgroundTone: state.backgroundTone,
        showNavIcons: state.showNavIcons,
        bookmarks: state.bookmarks,
      }),
    },
  ),
);
