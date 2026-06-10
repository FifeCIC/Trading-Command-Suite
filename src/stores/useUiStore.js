import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useUiStore = create(
  persist(
    (set) => ({
      devOverlayOpen: false,
      themeMode: 'dark',
      themePack: 'scifi',
      backgroundTone: 'aura',
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
    }),
    {
      name: 'tradingcs-theme',
      partialize: (state) => ({
        themeMode: state.themeMode,
        themePack: state.themePack,
        backgroundTone: state.backgroundTone,
      }),
    },
  ),
);
