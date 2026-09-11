---
description: "Accessibility and usability policy — WCAG 2.2 AA contrast, keyboard navigation, focus states, tap targets, and reduced-motion handling. Read before building or restyling any UI. Use when: adding a page/component, choosing colours, building forms or interactive controls, or reviewing a UI change."
applyTo: "src/**"
---

# Accessibility & Usability Policy — Trading Command Suite

**Target:** WCAG 2.2 Level AA (Level AAA where achievable without design compromise)
**Last reviewed:** 2026-07-16

> ⚠️ **2026-09-11 — frontmatter added.** This file previously had NO frontmatter, so it had no
> `applyTo` and may not have loaded as an instruction at all. A rule that does not load is
> indistinguishable from a rule that does not exist. `scripts/validate-agent-docs.cjs` now
> warns on any instruction file without an explicit `applyTo`.

---

## Color Contrast Requirements

All text MUST meet WCAG AA minimum contrast against its background:

| Token | On `--bg` (#000) | Ratio | AA Pass |
|-------|------------------|-------|---------|
| `--ink` #e5e7eb | Pure black | 17.4:1 | ✅ AAA |
| `--ink-soft` #a1a9b5 | Pure black | 8.4:1 | ✅ AAA |
| `--accent` #14b8b9 | Pure black | 5.3:1 | ✅ AA |
| `--color-profit` #22c55e | Pure black | 5.1:1 | ✅ AA |
| `--color-loss` #f87171 | Pure black | 5.1:1 | ✅ AA |
| `--color-warning` #f59e0b | Pure black | 9.3:1 | ✅ AAA |

**Enforcement:** No hardcoded hex values in page/component CSS. All colors via CSS variables defined in `index.css :root`. Before changing a token value, verify the new contrast ratio against `--bg`.

---

## User Preferences (Accessibility Settings)

All accessible via the ⚙ Screen Options panel on every page:

| Preference | Storage Key | Default | Effect |
|-----------|-------------|---------|--------|
| High Contrast Text | `highContrastText` | `false` | Swaps `--ink`, `--ink-soft`, `--accent`, `--color-loss` to higher-contrast variants |
| Display Mode | `displayMode` | `focused` | Plain language vs technical/raw data |
| Experience Level | `experienceLevel` | `beginner` | Feature gating — fewer options at beginner level |
| Hide Page Title | `hidePageTitle` | `false` | Reduces visual noise |
| Hide Page Subtitle | `hidePageSubtitle` | `false` | Reduces visual noise |

**Implemented:**
- ✅ Font size scaling (small/normal/large/x-large) — #357
- ✅ Color-blind friendly mode (pattern indicators alongside red/green) — #358
- ✅ Focus indicator style (subtle/strong/none) — #360

**Planned** (see GitHub issues):
- Screen reader verbosity (minimal/standard/verbose for live data)

---

## Motion & Animation

- All CSS animations and `motion/react` transitions MUST respect `prefers-reduced-motion`
- The global media query in `index.css` sets `animation-duration: 0.01ms` and disables view transitions when the user's OS preference is set
- Page transition animations use the View Transitions API, controlled by the `pageTransitions` preference
- No auto-playing video or infinite animation loops longer than 5 seconds

---

## Keyboard Navigation

- All interactive elements MUST be reachable via Tab
- Focus order MUST follow visual order
- `:focus-visible` uses a global 2px accent outline (defined in `index.css`)
- `:focus:not(:focus-visible)` removes the outline (no focus ring on mouse clicks)
- Escape closes modals, drawers, and the Screen Options panel
- Keyboard shortcuts registered via `useKeyboardShortcuts` hook — help bar shown by preference

---

## Screen Readers

- Every page MUST have exactly one `<h1>`
- Landmark regions: `<nav>`, `<main>`, `<aside>` used consistently
- `aria-label` on icon-only buttons and interactive elements without visible text
- `role="alert"` on error banners, `role="status"` on loading states
- Live region for the Market Ticker (announces symbol changes)
- All images and charts need `alt` text or `aria-label`

---

## Touch & Pointer

- Tap targets MUST be at least 44×44px (WCAG 2.5.5)
- No hover-only interactions — all functionality available via tap/click
- Touch scrolling regions use `-webkit-overflow-scrolling: touch`

---

## Responsive & Zoom

- Content MUST work at 200% browser zoom without horizontal scrolling
- Breakpoints at ≤900px and ≤600px on every page
- Font sizes use `rem` units (base 16px) — respects browser font size settings
- `--page-max-width: 1400px` central container prevents ultra-wide line lengths

---

## Testing Cadence

- **Per page build:** Lighthouse accessibility audit (target ≥95)
- **Per release:** Full keyboard walkthrough of all interactive elements
- **Quarterly:** Screen reader audit (NVDA on Windows)
- **CI lint:** CSS custom property contrast check (planned)

---

## Phase Gates

New UI features pass these checks before merge:

1. All colors via CSS variables — no hex in page CSS
2. Focus visible styles present on all interactive elements
3. `prefers-reduced-motion` respected
4. At least one `aria-` attribute on the page
5. Keyboard-navigable without a mouse
6. Lighthouse accessibility score ≥95
