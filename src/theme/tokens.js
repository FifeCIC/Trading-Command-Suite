const LIGHT_PALETTE = {
  bg: '#f4f7fb',
  ink: '#0f172a',
  inkSoft: '#334155',
  panel: '#ffffff',
  line: '#d9e2ec',
  accent: '#0ea5a6',
  danger: '#dc2626',
  /**
   * SEMANTIC COLOURS, PER MODE (#861).
   *
   * ⚠️ These are NOT decoration. `--color-profit` / `--color-loss` are used as BODY TEXT across the
   * app, and the dark-tuned values fail WCAG AA on a light surface: measured 2026-11-06,
   * `#22c55e` is **2.28:1** on `#ffffff` where AA needs 4.5:1. Eleven of the fifteen semantic tokens
   * failed, not one — the issue named the most visible example.
   *
   * ⚠️ The values below are chosen against BOTH light surfaces in play — the panel (`#ffffff`) and
   * the page (`#f4f7fb`) — because a token sits on each. Checked with the WCAG 2.x relative-luminance
   * formula; the minimum pair here is profit at **4.67:1 on the page** (AA needs 4.5). The guard is
   * `src/theme/semantic-contrast.spec.js`, which recomputes every pair and fails under 4.5 — so
   * these numbers cannot drift by hand.
   */
  semantic: {
    profit: '#15803d',   // 5.02 on panel · 4.67 on page
    loss: '#b91c1c',     // 6.47 · 6.02
    buy: '#15803d',
    sell: '#b91c1c',
    accentBlue: '#1d4ed8', // 6.70 · 6.24
    warning: '#b45309',   // 5.02 · 4.67
    neutral: '#475569',   // 7.58 · 7.05
    muted: '#5a6675',     // 5.85 · 5.44
    textDim: '#5f6b7a',   // 5.43 · 5.05
    noticeSuccess: '#15803d',
    noticeWarning: '#b45309',
    noticeCritical: '#b91c1c',
    noticeInfo: '#1d4ed8',
  }
};

const DARK_PALETTE = {
  bg: '#0b1220',
  ink: '#e2e8f0',
  inkSoft: '#a7b4c6',
  panel: '#111b2e',
  line: '#23324a',
  accent: '#22d3ee',
  danger: '#f87171',
  /**
   * The dark set is the one that already existed in `src/index.css` and already passes AA on the
   * dark panel (measured: profit 8.22:1, loss 6.77:1, warning 8.72:1). It is declared here so the
   * light and dark sets have ONE owner each and the contrast guard can check both by mode.
   */
  semantic: {
    profit: '#22c55e',
    loss: '#f87171',
    buy: '#22c55e',
    sell: '#f87171',
    accentBlue: '#67a8fa', // 7.01 on core panel · passes every dark pack panel (min 5.96 on slate)
    warning: '#f59e0b',
    neutral: '#a1a9b5',
    // ⚠️ LIGHTENED 2026-11-06 (#861). These were `#64748b` / `#6b7280`, which measure **3.62:1** and
    // **3.56:1** on the dark PANEL (`#111b2e`) — under AA. The first measurement missed them because
    // it only compared against the page; the contrast test asserts the panel too, and caught it. A
    // secondary label still has to be legible; "dim" is a hierarchy, not a legibility exemption.
    muted: '#8896ab',      // 5.74 on panel · 6.24 on page
    textDim: '#94a3b8',    // 6.71 · 7.30
    noticeSuccess: '#22c55e',
    noticeWarning: '#f59e0b',
    noticeCritical: '#f87171', // 6.22 on core panel · passes every dark pack panel (min 5.29 on slate).
                               // ⚠️ was #ef4444, which measured 3.89:1 on slate's panel — a pack panel is
                               // lighter than core's, so the value has to clear the LIGHTEST dark surface.
    noticeInfo: '#60a5fa',
  }
};

/**
 * The canonical semantic colour set for a mode.
 *
 * ⚠️ WHY THIS IS EXPORTED (#861). Every theme pack builds its tokens as
 * `{ ...createThemeTokens(mode), palette: PACK_PALETTE }` — it REPLACES the palette, so a pack that
 * does not redeclare `semantic` loses the AA-safe set and silently falls back to whatever
 * `index.css` holds (the dark-tuned values). That is how `void` shipped `--color-muted: #64748b`
 * at 3.62:1 on its own panel while `core` was correct.
 *
 * The adapter uses this as a fallback, so ONE fix covers every pack including future ones, and a
 * pack may still override any token it genuinely wants to differ.
 */
export function getSemanticPalette(mode = 'dark') {
  return (mode === 'light' ? LIGHT_PALETTE : DARK_PALETTE).semantic;
}

export function createThemeTokens(mode = 'light') {
  const normalizedMode = mode === 'dark' ? 'dark' : 'light';
  const palette = normalizedMode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;

  return {
    mode: normalizedMode,
    palette,
    radius: {
      sm: 10,
      md: 14
    },
    shadow: {
      card:
        normalizedMode === 'dark'
          ? '0 12px 28px rgba(2, 6, 23, 0.45)'
          : '0 10px 24px rgba(15, 23, 42, 0.08)'
    },
    typography: {
      body: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    }
  };
}
