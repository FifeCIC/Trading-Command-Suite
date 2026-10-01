/**
 * mermaid-theme.js — the ONE place Mermaid is configured, so every diagram in the app follows
 * the ACTIVE THEME instead of a hardcoded palette.
 *
 * ── THE PROBLEM THIS FIXES ────────────────────────────────────────────────────────────────
 * Both diagram surfaces called `mermaid.initialize({ theme: 'dark' })`. Mermaid's `dark` is its
 * own grey palette, which matches no theme pack in this app: under the `scifi` pack the page is
 * navy (#0a1428) with a cyan accent (#00d9ff) while the diagrams stayed grey. The diagrams read
 * as a foreign object because they were one. `theme: 'base'` plus explicit variables is the only
 * way to make them belong.
 *
 * ── ⚠️ WHY THE VALUES ARE READ IN JS AND NOT PASSED AS `var(--token)` ─────────────────────
 * Tempting, and it does NOT work. Mermaid runs every theme variable through a colour parser, and
 * `var(--panel)` throws:
 *
 *     Unsupported color format: "var(--panel)"
 *         at Object.parse → Theme.updateColors → Object.initialize
 *
 * (verified against the running app, 2026-09-23). So each value is read from the live theme with
 * `getComputedStyle` and passed as a REAL colour. `rgba()` is fine — that is not what broke.
 *
 * ── ⚠️ MERMAID IS GLOBAL STATE — THIS MODULE MUST BE THE ONLY CALLER ─────────────────────
 * `mermaid.initialize()` configures a singleton. Two pages each calling it means whichever
 * mounted last wins, and a diagram can silently render with the other page's palette. That is why
 * `DiagramsPage` and `StrategyLibraryPage` both import from here rather than each holding their
 * own config. **If you add a third diagram surface, import this — do not call `initialize`.**
 *
 * ── HOW A THEME CHANGE IS NOTICED ────────────────────────────────────────────────────────
 * `useThemeRuntime` writes the tokens onto `:root` and then sets `data-theme-pack` and
 * `data-theme-mode`. Those two attributes are the observable signal, so a MutationObserver on
 * them catches every switch — no polling, and no dependency on the theme hook being in scope.
 */

import { useEffect, useState } from 'react';
import mermaid from 'mermaid';

/** Read a token from the live theme, falling back to a literal so a missing key cannot blank a diagram. */
function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;

  // The THEMED surface tokens are `--bg` / `--panel` / `--line` / `--ink*` / `--accent`: the theme
  // runtime writes those per pack. ⚠️ `--color-panel` and `--color-border` are STATIC (written once
  // in index.css and never updated), so using them here would pin the diagram to the default pack
  // while the page around it followed the user's choice — which is half the original complaint.
  return {
    bg: v('--bg', '#0a1428'),
    panel: v('--panel', '#0f1b2e'),
    panelElev: v('--bg-elev', '') || v('--panel', '#0f1b2e'),
    ink: v('--ink', '#e5e7eb'),
    inkSoft: v('--ink-soft', '#a1a9b5'),
    line: v('--line', '#2d3040'),
    border: v('--border', '') || v('--line', '#2d3040'),
    accent: v('--accent', '#14b8b9'),
    fontBody: v('--font-body', 'system-ui, sans-serif'),
    fontMono: v('--font-mono', '') || 'ui-monospace, monospace',
    // Status colours. These ARE static by design (see the static/themed table in
    // ui-standards.instructions.md) — a pass and a failure should look the same in every theme.
    // Read rather than hardcoded so a future pack that does define them is honoured.
    profit: v('--color-profit', '#22c55e'),
    loss: v('--color-loss', '#f87171'),
    warning: v('--color-warning', '#f59e0b'),
    muted: v('--color-muted', '#64748b'),
  };
}

/** The identity of the current theme — changes exactly when the palette does. */
function themeKeyOf() {
  const el = document.documentElement;
  return `${el.getAttribute('data-theme-pack') || 'default'}|${el.getAttribute('data-theme-mode') || 'dark'}`;
}

/**
 * Build the Mermaid config from a token snapshot.
 *
 * `theme: 'base'` means "use exactly the variables given and derive nothing from a preset", which
 * is the only mode where the output follows our palette rather than Mermaid's.
 */
export function mermaidConfigFrom(t, mode) {
  return {
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    themeVariables: {
      darkMode: mode !== 'light',
      background: t.bg,
      // Nodes: the panel surface, with the accent as the border so a diagram reads as part of the
      // themed UI rather than a grey box dropped into it.
      primaryColor: t.panel,
      mainBkg: t.panel,
      primaryTextColor: t.ink,
      primaryBorderColor: t.accent,
      nodeBorder: t.accent,
      textColor: t.ink,
      // Edges use the MUTED TEXT colour, not `--line`. `--line` is a border weight (scifi: a 30%
      // alpha cyan) and as a 2px stroke it nearly vanishes; ink-soft is chosen for legibility on
      // the background and reads at stroke width.
      lineColor: t.inkSoft,
      secondaryColor: t.panelElev,
      tertiaryColor: t.panelElev,
      clusterBkg: t.panelElev,
      clusterBorder: t.border,
      edgeLabelBackground: t.bg,
      titleColor: t.ink,
      fontFamily: t.fontBody,
      fontSize: '14px',
    },
    flowchart: { curve: 'basis', htmlLabels: true, useMaxWidth: true },
  };
}

/** Configure Mermaid for the theme that is live right now. Safe to call repeatedly. */
export function applyMermaidTheme() {
  const el = document.documentElement;
  const mode = el.getAttribute('data-theme-mode') || 'dark';
  mermaid.initialize(mermaidConfigFrom(readTokens(), mode));
  return themeKeyOf();
}

/**
 * Configure Mermaid on mount and again on every theme change.
 *
 * @returns {{ themeKey: string, tokens: object }} `themeKey` changes when the palette does —
 *          pass it into any render effect's dependency list so the diagram is redrawn.
 */
export function useThemedMermaid() {
  const [state, setState] = useState(() => ({ themeKey: themeKeyOf(), tokens: null }));

  useEffect(() => {
    const sync = () => setState({ themeKey: applyMermaidTheme(), tokens: readTokens() });
    sync();

    // The theme runtime writes the tokens and then the two attributes in the same effect, so the
    // attribute mutation is the signal that both are in place.
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme-pack', 'data-theme-mode', 'style'],
    });
    return () => obs.disconnect();
  }, []);

  return state;
}

/** The status colours, for callers that draw their own annotation (e.g. `annotateSource`). */
export function readStatusColors() {
  const t = readTokens();
  return { ok: t.profit, bad: t.loss, warning: t.warning, muted: t.muted };
}

/**
 * renderMermaidSvg() — the ONE way this app turns a Mermaid source into an SVG string.
 *
 * ⚠️ SYMPTOM GUARD — Mermaid can resolve its FIRST pass with a STYLE-ONLY svg (no nodes at all)
 * for a source that parses perfectly. Measured on /development/diagrams 2026-10-01: **every
 * diagram with no registered claim rendered BLANK** while diagrams that HAD a claim rendered
 * fine — because a claim fetch updates React state and triggers a SECOND render, which succeeds.
 * A claim-less diagram only ever got the first pass, so it stayed empty with no error.
 *
 * The cause is NOT isolated (no re-initialisation race, and the source renders correctly in a
 * standalone Mermaid). This retries on the observable SYMPTOM instead of the cause, deliberately:
 * a symptom guard fires without needing the theory to be right, and a wrong theory it inherits
 * would have been worse than no guard.
 *
 * ⚠️ Detecting "empty" by the absence of graph TEXT (`<text>`, `<foreignObject>`, `<span>`).
 * All three appear depending on `htmlLabels`; the style-only svg carries none of them.
 *
 * @param renderId  the svg element id (must be unique per rendered diagram)
 * @param source    the Mermaid source, already run through `annotateSource`
 * @returns the svg string, retried up to `attempts` times while it carries no graph
 */
const MERMAID_HAS_GRAPH = /<text\b|<foreignObject\b|<span\b/;
export async function renderMermaidSvg(renderId, source, attempts = 3) {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    const { svg } = await mermaid.render(renderId, source);
    if (MERMAID_HAS_GRAPH.test(svg)) return svg;
    last = svg;
  }
  return last;
}
