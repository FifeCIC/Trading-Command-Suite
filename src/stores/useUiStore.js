import { create } from 'zustand';

export const useUiStore = create((set) => ({
  devOverlayOpen: false,
  themeMode: 'dark',
  themePack: 'scifi',
  toggleDevOverlay: () => set((state) => ({ devOverlayOpen: !state.devOverlayOpen })),
  closeDevOverlay: () => set({ devOverlayOpen: false }),
  setThemeMode: (mode) => set({ themeMode: mode === 'dark' ? 'dark' : 'light' }),
  setThemePack: (pack) => {
    const safePack = typeof pack === 'string' && /^[a-z0-9-]{1,64}$/i.test(pack) ? pack : 'core';
    set({ themePack: safePack });
  }
}));
