---
description: "UI standards — permitted UI technologies, CSS variable tokens, spacing/sizing scales, and user-configurable preferences. The single source of truth for UI work. Read before creating a page/component or restyling. Use when: writing CSS, choosing colours or spacing, adding a page, or building an interactive control."
applyTo: "src/**"
---

# UI Standards — Trading Command Suite

**Purpose:** Defines what UI technologies, visual patterns, spacing/sizing scales, and user-configurable preferences are permitted across the app. This file is the single source of truth for the React UI Agent.

> ⚠️ **2026-09-11 — frontmatter added.** This file previously had NO frontmatter, so it had no
> `applyTo` and may not have loaded as an instruction at all. A rule that does not load is
> indistinguishable from a rule that does not exist. `scripts/validate-agent-docs.cjs` now
> warns on any instruction file without an explicit `applyTo`.

---

## 🎨 Visual Specification

### CSS Variable Tokens (in `src/index.css :root`)

All colors MUST use CSS variables. Never hardcode a hex value in a page/component CSS file.

> ⚠️ **Values corrected 2026-10-16 against `src/index.css`.** Six held their PRE-WCAG-boost
> values (`--ink-soft`, `--accent`, `--danger`, `--color-loss`, `--color-sell`, `--color-neutral`)
> and the twelve notice tokens were missing entirely. An agent copying `#ef4444` from this table
> would have written exactly the hardcoded-literal debt the gate below now blocks — so a stale
> token table here is not cosmetic drift, it is a source of it. **Re-read `index.css` before
> trusting a value in this table.**

| Token | Value | Purpose |
|-------|-------|---------|
| `--bg` | `#000000` | Page background |
| `--ink` | `#e5e7eb` | Primary text |
| `--ink-soft` | `#a1a9b5` | Secondary/muted text |
| `--panel` | `#000000` | Panel/shell background |
| `--line` | `#1a1a1a` | Borders, dividers |
| `--accent` | `#14b8b9` | Primary accent (teal) |
| `--danger` | `#f87171` | Destructive actions |
| `--color-profit` | `#22c55e` | Profit, buy, bullish |
| `--color-loss` | `#f87171` | Loss, sell, bearish |
| `--color-buy` | `#22c55e` | Buy signal |
| `--color-sell` | `#f87171` | Sell signal |
| `--color-accent-blue` | `#3b82f6` | Interactive elements |
| `--color-warning` | `#f59e0b` | Warnings, cautions |
| `--color-neutral` | `#a1a9b5` | Neutral/muted text |
| `--color-muted` | `#64748b` | Disabled, tertiary |
| `--color-text-dim` | `#6b7280` | Dimmed text |
| `--color-panel` | `#1a1d2e` | Card/panel fill |
| `--color-border` | `#2d3040` | Card/panel border |
| `--color-grid` | `#1e2030` | Grid/dashboard fill |
| `--color-input-bg` | `#111318` | Input backgrounds |
| `--notice-success-text` | `#22c55e` | Notice banner — `-bg` / `-border` variants also exist |
| `--notice-warning-text` | `#f59e0b` | Notice banner |
| `--notice-critical-text` | `#ef4444` | Notice banner — ⚠️ still the PRE-boost red |
| `--notice-info-text` | `#60a5fa` | Notice banner |
| `--shadow-card` | `0 12px 28px rgba(0,0,0,0.65)` | Card elevation |

> ⚠️ **Two gaps in the accessibility layer, recorded not fixed** (both need a colour decision,
> not a sweep): `--notice-critical-text` did not get the WCAG boost that `--danger` and
> `--color-loss` did, and the `:root[data-high-contrast='true']` block overrides the semantic
> tokens but **not** the notice tokens — so notice banners do not respond to High Contrast Text.

### Hardcoded Colours — enforced by a build gate

**Rule:** a colour in a page/component stylesheet comes from a token. A literal with no `var()`
cannot be looked up by `validate-css-tokens.cjs` — there is no name to resolve — so it renders,
looks plausible, and ignores every theme pack. A hex tuned against `#000000` is simply wrong on
a light background.

**This is enforced, not advised.** `scripts/validate-css-literals.cjs` runs in `prebuild`:

```powershell
node scripts/validate-css-literals.cjs              # gate — exit 1 on NEW debt
node scripts/validate-css-literals.cjs --by-file    # what is left, worst first
node scripts/validate-css-literals.cjs --self-test  # prove the guard still fires
```

Pre-existing debt is frozen in `scripts/css-literal-baseline.json` as per-file, per-literal
**counts** — counts rather than a list, so a *swap* (one literal removed, a different one added)
is still caught. **A count may only ever go down.** Fix a literal by choosing the token; never
by running `--update-baseline`.

**Exempt — and only these four literals:** `#fff`, `#ffffff`, `#000`, `#000000`. They are correct
on a *fixed-contrast* surface (text on an accent-filled button, a scrim), and a line scanner
cannot see the sibling `background` to tell that case from `color: #fff` where `--ink` was meant.
The alternative was firing on correct code, and a guard that fires on correct code gets
allowlisted wholesale — so the narrower rule wins. **Accepted cost:** a `#fff` that should have
been `--ink` is not caught.

**Also exempt:** a token *definition* (`--name: #hex`) — that is where a literal belongs.

| Writing this | Flagged? | Use instead |
|---|---|---|
| `color: #f87171` | ✅ | `var(--color-loss)` / `var(--color-sell)` / `var(--danger)` |
| `color: #22c55e` | ✅ | `var(--color-profit)` / `var(--color-buy)` |
| `background: #f59e0b22` | ✅ | `var(--notice-warning-bg)` or `color-mix()` |
| `border: 1px solid #1a1a1a` | ✅ | `var(--line)` |
| `color: #fff` on an accent fill | ❌ exempt | — |
| `--brand: #f7931a` | ❌ exempt | — (a definition) |

⚠️ **Outside the gate — use judgement:** `rgb()` / `rgba()` / `hsl()` and named colours
(`red`, `white`) are equally theme-blind and are not counted. A declaration whose value is
wrapped onto its own line is missed too. Writing one declaration per line avoids the second.

### Spacing Scale

| Token | Size | Usage |
|-------|------|-------|
| `xs` | `4px` | Icon gaps, tight inline elements |
| `sm` | `8px` | List gaps, chip gaps, detail rows |
| `md` | `12-16px` | Card padding, section gaps |
| `lg` | `20-24px` | Page section spacing |
| `xl` | `32px+` | Major layout breaks |

### Sizing (Typography Scale)

| Role | Size | Weight | Usage |
|------|------|--------|-------|
| Page title | `1.4rem` | `700` | `h1` in page header |
| Section heading | `1.05rem` | `700` | `h2` in panels |
| Subheading | `0.95rem` | `600` | Card titles, widget headers |
| Body | `0.85-0.95rem` | `400` | Paragraph text, descriptions |
| Body small | `0.78-0.82rem` | `400` | Secondary descriptions |
| Label | `0.65-0.72rem` | `600` | Form labels, metadata, uppercase |
| Caption | `0.55-0.62rem` | `400` | Timestamps, tertiary info |
| Stat value (large) | `1.1-1.4rem` | `700-800` | Dashboard stat numbers — MUST use monospace |
| Stat value (normal) | `0.9-1.05rem` | `700` | Card stat values — MUST use monospace |

### Border Radius

| Element | Radius |
|---------|--------|
| Cards, panels, sections | `10px` |
| Buttons | `6px` |
| Inputs, selects | `5px` |
| Chips, badges, pills | `999px` (full round) |
| Inner elements (rows, tags) | `4px` |

### Animation Timing

| Type | Duration | Notes |
|------|----------|-------|
| Hover transitions | `150ms` | `ease` |
| Enter animations | `250ms` | Stagger items by `index × 0.04s`, max `0.4s` total delay |
| Page transitions | `200-300ms` | `ease-out` for enter, `ease-out` for exit |
| Attention pulse | `2s` | For live dots, status indicators |

### Typography

- **Headings:** System font stack (`'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`)
- **Data/numbers:** Monospace (`'JetBrains Mono', 'Fira Code', 'Consolas', monospace`)
  - Use for: prices, P&L, percentages, scores, quantities, ADX values, entry/exit prices
- **Code:** `0.78-0.82rem`, monospace, `rgba(255,255,255,0.06)` background, `4px` border-radius

### Responsive Breakpoints

| Name | Width | Behavior |
|------|-------|----------|
| 4K | `2560px` | All columns, no hiding |
| Desktop | `1440px` | Default, all columns |
| Laptop | `1024px` | Priority 1-4 columns |
| Tablet | `768px` | Priority 1-3 columns, sidebar→off-canvas |
| Mobile | `480px` | Priority 1-2 columns, single-column grids |

All trading-view pages MUST use `max-width: var(--page-max-width)` (default `1400px` for dashboards, `1200px` for forms).

---

## 📐 Approved Design Patterns

### 1. Card with Status Border

> ⚠️ **2026-09-18 — DISFAVOURED BY THE OWNER.** Verbatim: *"which use left hand coloured bordered cards
> which I very much dislike. I prefer ones we have in theme, full coloured borders."*
>
> **Use a FULL coloured border** (`border: 1px solid <tone>`) so the colour reads as part of the card
> rather than a stripe bolted on the side. Colour the whole card edge, and leave the tone on the
> BORDER — never on the body text (the semantic tones fail WCAG AA as text on a light panel).
>
> The pattern below is kept only as a description of what existing pages do. Do not add new ones.
> Migrate existing cards to a full border opportunistically, as `ui-standards` Rule A already says
> for prefixes.

```
.pm-pos-card { border-left: 3px solid ... }   ← do NOT copy this into a new component
.pm-win  { border-left-color: var(--color-profit); }
.pm-lose { border-left-color: var(--color-loss); }
```
Used in: Positions Monitor, Strategy Comparison, Portfolio cards.

---

## ⚠️ TOKENS: STATIC vs THEMED — read before choosing a colour

**The token table above is NOT all themed.** It lists tokens from `src/index.css :root`, which is
written **once** and never changes. The real per-theme tokens are written onto `:root` at runtime by
`src/theme/adapters/vanilla.js` on every theme change:

| Kind | Tokens | Follows the theme? |
|---|---|---|
| **Themed (runtime)** | `--bg` `--ink` `--ink-soft` `--panel` `--line` `--accent` `--danger`, `--bg-elev` `--bg-elev-2`, `--border` `--border-strong`, `--text-dim` `--text-faint`, `--risk-normal` `--risk-watch` `--risk-elevated` `--risk-high` `--risk-critical`, `--accent-soft` | ✅ yes |
| **Static** | `--color-profit` `--color-loss` `--color-buy` `--color-sell` `--color-warning` `--color-panel` `--color-border` `--color-muted` `--color-text-dim` `--color-neutral` `--color-grid` `--color-input-bg` | ❌ no — `index.css` only overrides `--color-loss`/`--color-sell`, and only for high contrast |
| **Pack-only** | `--panel-raised` (declared ONLY in `theme/packs/slate.css` as `#233049`) | ❌ no — dark navy in every other pack and in light mode |

⚠️ **Both sets pass `scripts/validate-css-tokens.cjs`, so the guard cannot catch a wrong choice.**
That is what makes this a silent trap, and it produced a real defect: the per-bot truth view used
`--panel-raised` for its summary block and rendered dark navy against every theme — reported by the
owner as *"incorrectly styled, not using the current theme"* (2026-09-18).

**Rules:**

1. For anything that must follow light/dark/black, use the **themed (runtime)** column.
2. Use `--bg-elev` for a raised surface, not `--panel-raised`.
3. For a severity ramp (enforcement, risk, health) use the **`--risk-*`** scale — it is the app's
   only themed multi-step severity palette. `--color-profit`/`--color-warning` cannot serve it.
4. **`color-mix()` cannot be replaced by hex-alpha concatenation.** `typeColor + '18'` only works on
   a hex literal; `var(--risk-normal)18` is invalid CSS and silently produces no colour.
5. A token name is a claim. Check `theme/adapters/vanilla.js` before trusting the table above.

### 2. Dashboard Stat Card
Background: `var(--color-panel)`, border: `1px solid var(--color-border)`, border-radius: `10px`.
Large monospace value, small uppercase label in `var(--color-neutral)`.
Optional colored left accent. Used in: Scoring Overview, Automation Dashboard, Risk Controls.

### 3. Filter Chip Bar
Horizontal row of small pill buttons (`border-radius: 999px`).
Inactive: `border: 1px solid var(--color-border)`. Active: `background: rgba(59,130,246,0.15)`, `color: var(--color-accent-blue)`, `border-color: var(--color-accent-blue)`.
Used in: Speed Scanner, Positions Monitor, Automation Rules.

### 4. Sticky Header (Scroll-Shrink)
Component: `StickyHeader.jsx` — sticks to viewport top, smoothly shrinks padding and font-size after 80px of scroll. Props: `shrinkThreshold`, `expandedPadding`, `shrunkPadding`, `expandedFontSize`, `shrunkFontSize`. Use on any long-scrolling page with key stats needing persistent access.

### 5. Data Table (Strong)
Clean rows with good contrast. Alternating row backgrounds optional (striped variant via `--tableStyle` preference). Priority-based column hiding on mobile via CSS media queries. Used in: Scoring Overview, Directives Manager, Trade History.

### 6. Summary Banner
Horizontal flex row of stat cards at page top. Shows aggregate metrics (total P&L, win/loss count, best/worst performer). Background: `linear-gradient` from panel to slightly lighter, border: `1px solid var(--color-border)`. Used in: Positions Monitor, Portfolio Overview.

### 7. Notice Banner
Component: `app-notice` class in `index.css`. Four variants: `--success`, `--warning`, `--critical`, `--info`. Each uses the corresponding `--notice-*-` CSS variables for background, border, and text color.

### 8. Signal Badge (shared output layer)
A trading signal (BUY/HOLD/SELL/PAUSED) is rendered by ONE component:
`src/components/SignalBadge.jsx`, fed by `buildScoreDisplay()` from
`src/core/score-display.js`. Never re-derive signal/tone/state in a page.
Frozen rows (market closed or stale data) render a muted "⏸ PAUSED" everywhere —
never a colored BUY/SELL.

---

## 👤 User-Configurable Preferences

All preferences are stored in `localStorage` key `tcs:preferences` and managed by `usePreferences()` hook from `src/core/hooks/usePreferences.js`. Settings are surfaced on the Settings page.

### Display Preferences

| Key | Default | Options | Description |
|-----|---------|---------|-------------|
| `tableStyle` | `'default'` | `'default'`, `'compact'`, `'bordered'`, `'striped'` | Data table visual variant |
| `compactMode` | `false` | `true/false` | Tighter spacing throughout |
| `decimalPlaces` | `2` | `0-4` | Decimal precision for displayed numbers |
| `chartAnimation` | `true` | `true/false` | Enable chart entry animations |
| `showNavIcons` | `true` | `true/false` | Show/hide icons in navigation |

### Trading View Preferences

| Key | Default | Options | Description |
|-----|---------|---------|-------------|
| `defaultSignalSymbols` | `''` | Comma-separated tickers | Symbols loaded in Signals Workbench |
| `defaultProtocol` | `''` | Protocol ID | Default protocol for scoring |
| `defaultTimeframe` | `'1h'` | `'5s','30s','1m','5m','15m','1h','4h','1d'` | Default chart timeframe |
| `signalsAutoRefresh` | `false` | `true/false` | Auto-refresh signal data |
| `signalsRefreshInterval` | `60000` | `5000-300000` (ms) | Signal refresh rate |
| `pollingInterval` | `30` | `5-300` (seconds) | Default data polling interval |
| `researchRefreshInterval` | `30000` | `10000-300000` (ms) | Research panel refresh rate |

### Risk Preferences

| Key | Default | Options | Description |
|-----|---------|---------|-------------|
| `riskMaxDrawdown` | `25` | `5-50` (%) | Max portfolio drawdown threshold |
| `riskMaxPositions` | `5` | `1-20` | Max concurrent positions |
| `riskMaxPerSymbol` | `25` | `5-100` (%) | Max allocation per symbol |
| `riskMaxPerTrade` | `2` | `0.5-10` (%) | Max risk per individual trade |
| `circuitBreakerDrawdownTrigger` | `20` | `5-50` (%) | Auto-stop drawdown level |
| `circuitBreakerExposureTrigger` | `80` | `50-100` (%) | Auto-stop exposure level |

### Degradation Preferences

| Key | Default | Options | Description |
|-----|---------|---------|-------------|
| `degradationNotify` | `true` | `true/false` | Show notification when providers degrade |
| `degradationPauseAutomation` | `true` | `true/false` | Pause automation on provider degradation |
| `degradationCloseProfitable` | `false` | `true/false` | Close profitable positions during degradation |
| `degradationAdjustStops` | `false` | `true/false` | Tighten stops during degradation |
| `degradationMinProviderHealth` | `50` | `20-100` (%) | Minimum provider health before action |

### Proposed New Preferences (issues #254, #257, #228)

These preferences are planned but not yet implemented. Add them to `DEFAULTS` and the Settings page when built:

| Key | Default | Options | Description |
|-----|---------|---------|-------------|
| `pageTransitions` | `true` | `true/false` | Enable View Transitions API page morphing (#254) |
| `keyboardShortcutsHelp` | `true` | `true/false` | Show keyboard shortcuts help bar (#257) |
| `layoutWidth` | `'desktop'` | `'full','4k','desktop','laptop','tablet'` | Default page width preset (#258) |
| `panelBorderStyle` | `'solid'` | `'solid','dashed'` | Card/panel border style (dashed variant per user preference) |
| `highContrastText` | `false` | `true/false` | Boost text contrast for accessibility (#256) |

---

## 📐 Page Scaffold Pattern

Every new page MUST:

1. Import `LoadingSkeleton` from `src/components/LoadingSkeleton` for loading state
2. Wrap content in `<ErrorBoundary>` in the route definition
3. Use `useQuery` + `apiGet` for data, never inline `fetch()`
4. Show error state when API is unreachable (use `ApiOfflineBanner`)
5. Show empty state when data is missing (use shared `app-notice` classes)
6. Use CSS variables for ALL colors — never hardcode hex values in page/component CSS
7. Export as `default function`
8. Use `motion/motion` for enter animations with `index × 0.04s` staggered delays
9. Respect `var(--page-max-width)` for the outer container
10. Include responsive breakpoints at `≤900px` and `≤600px`
11. Put page/component styles in a **`*.module.css`** file — see "Page & Component Stylesheets" below

---

## 🗂 Page & Component Stylesheets — `*.module.css` for anything NEW

> **Decided 2026-09-17.** Adopted after measuring, not on principle. Read the two rules; they
> are short and they replace nothing else in this file.

### Rule B — new stylesheets are CSS Modules

**Any new page or component stylesheet MUST be `*.module.css`**, imported as
`import styles from './x.module.css'` and used as `className={styles.foo}`.

**Why (measured, not assumed):**

| Fact | Value |
|---|---|
| Stylesheets in `src/` | **167** (135 pages, 31 components, 1 root) |
| Built CSS output | **ONE** file — `index-*.css`, ~1,067 KB |
| Class selectors defined in more than one stylesheet | **110** |
| `*.module.css` in use | 0 (as of the adoption date) |

Every stylesheet is concatenated into a single global sheet, so a "page prefix" is a **global
namespace** and the last-loaded rule wins **on both pages**. This is not hypothetical — it was
found twice in one day:

- **Trading Settings** (`/settings/trading-settings`) was styled almost entirely by two *other*
  pages. Measured: `background rgb(8,8,13)`, `display:flex`, `min-height:780px` (from
  `triple-screen.css`) and `display:flex` overriding its own `display:grid`, making
  `grid-template-columns` **inert**. Nothing it declared reached the DOM.
- **Trading Styles** (`/planner/trading-styles`) was painted by the same orphaned rule.

CSS Modules removes the namespace, so the class of bug cannot recur for new files.

**✅ Verified working in THIS project** (Vite 8.1.3 + rolldown 1.1.4, `css.lightningcss:false`,
`build.cssMinify:false` — non-default, hence checked rather than assumed). A probe file built to:

```
. _probeScopedBox_autgy_5 { color: rgb(1, 2, 3); }     ← hashed in the output CSS
window.__cssmoduleProbe = { probeScopedBox: '_probeScopedBox_autgy_5' }   ← scope map exported
```

No config is required. The `_<hash>` suffix is derived from the file, so **two files may each
define `.page` without colliding.**

### Rule A — rename the prefix opportunistically

The 110 existing duplicates are **not** to be fixed in a sweep. When you next work on a page
whose stylesheet shares a class prefix with another, rename **that page's** prefix
(`.pl-` → `.plab-`, `.ts-` → `.tsty-`) in the same change. Same for a rule whose selector has no
consumer at all — `triple-screen.css`'s `.ts-page` was orphaned and still painted another page.
Dead CSS is not inert when the selector is generic.

### ❌ Not doing — and why

- **A duplicate-selector linter + 110-entry baseline.** Rejected: it stops new collisions but
  fixes none of the 110, and a large allowlist is close to the "an allowlisted guard is worse
  than none" trap in `development-philosophy.instructions.md`.
- **A full migration of all 167 stylesheets to modules.** Correct in principle, disproportionate
  here. New files are immune; old files improve as they are touched.

---

## ✅ UI Agent Pre-Flight Checklist

Before ANY UI change is considered complete, silently verify:

- [ ] Uses CSS variables for all colors (no hex codes outside `index.css :root`)
- [ ] Uses semantic color tokens (`--color-profit`, not `#22c55e`)
- [ ] Has loading state (LoadingSkeleton or equivalent)
- [ ] Has empty state when no data
- [ ] Has error state when API fails (ApiOfflineBanner)
- [ ] Uses `motion/motion` for enter animations (staggered by `index × 0.04s`)
- [ ] Respects `var(--page-max-width)` for trading views
- [ ] Has responsive breakpoints at `≤900px` and `≤600px`
- [ ] Font sizes follow the typography scale
- [ ] Border radius follows the scale
- [ ] Monospace used for all numeric data (prices, P&L, scores, percentages)
- [ ] No library >50KB uncompressed added
- [ ] No hardcoded hex colors in page CSS files
- [ ] New page/component stylesheet is `*.module.css` (not a new global `.css` file)
- [ ] Phase gates checked — no phase-gated features built prematurely

---

## ✅ Accepted (use freely in any page)

| Technology | Usage |
|---|---|
| **View Transitions API** | Page-to-page crossfade via `<meta name="view-transition">`. Active globally. User-toggleable via `pageTransitions` preference. |
| **CSS Variables** (`var(--*)`)  | All theming and colors. Defined in `index.css :root`. |
| **CSS Modules** (`*.module.css`) | ✅ **REQUIRED for new stylesheets** (2026-09-17). Scope hashes class names so they cannot collide with the 167 global stylesheets. Verified working in this project's Vite 8/rolldown config. See "Page & Component Stylesheets". |
| **CSS Grid + Flexbox** | Layout. Standard across all pages. |
| **`useQuery` + `apiGet`** | Data fetching pattern. From `@tanstack/react-query` and `src/core/api/client`. |
| **LoadingSkeleton** | Loading states. Import from `src/components/LoadingSkeleton`. |
| **CSS Nesting** | Use sparingly for deep selectors. Native CSS nesting is supported. |
| **CSS Animations / Transitions** | Keep under 300ms. Prefer `opacity` and `transform` for GPU acceleration. |
| **SVG inline charts** | Simple visualizations. Keep under 100 nodes for performance. |
| **Container Queries** | ✅ Accepted. Use for widget/dashboard layouts, DetachableWidget, sidebar panels. Apply `@container` with `container-type: inline-size`. Fallback: viewport media queries via `@supports not (container-type: inline-size)`. |
| **`motion` (Motion One)** | Accepted. Use for micro-interactions only: hover states, enter/exit, list reorder. Avoid layout animations on data-heavy pages. |
| **React Hooks** | `useState`, `useMemo`, `useCallback`, `useRef`, `useEffect` — standard. |
| **Zustand stores** | Global state. `useUiStore` for theme/prefs, new stores for feature state. |
| **ErrorBoundary** | Wrap every page. Import from `src/components/ErrorBoundary`. |
| **StickyHeader** | Scroll-driven shrink header. Import from `src/components/StickyHeader.jsx`. |
| **ApiOfflineBanner** | Standard API-error banner. Import from `src/components/ApiOfflineBanner`. |

## 🧪 Experimental (Lab area only until proven)

| Technology | Lab page | Criteria for promotion |
|---|---|---|
| **Scroll-Driven Animations** | `/lab/theme-lab-scroll` | Chrome/Edge only. Must degrade gracefully on Firefox/Safari. |
| **Popover API** | `/lab/theme-lab-popover` | Must not break on unsupported browsers. Polyfill or fallback required. |
| **Intensive Motion animations** | `/lab/theme-lab-motion` | Keep CPU budget under 5ms per frame. Test on mobile. |
| **CSS `@layer`** | Theme Lab | Verify cascade with existing theme packs. |
| **Feature Demos (trading)** | `/lab/feature-lab` | Visual demonstrations before production implementation. |

## ❌ Forbidden

| Technology | Reason |
|---|---|
| CSS-in-JS libraries | Project uses plain CSS files. Keep it consistent. |
| Tailwind / utility-first frameworks | Conflicts with existing theme variable system. |
| jQuery or DOM manipulation libraries | React manages the DOM. |
| Heavy animation libraries (GSAP, Framer Motion) | Motion One is the accepted lightweight alternative. |
| Any library >50KB uncompressed | Bundle size matters for PWA. |

## 🎨 Theme Lab Rules

- The Theme Lab is sandboxed — changes here do NOT affect the rest of the app
- Experimental features live only in Theme Lab sub-pages
- When an experimental feature is promoted to accepted, update this file AND create a migration prompt
- Keep examples self-contained: no external data dependencies, no API calls
- Each sub-page should include both working demos AND code snippets showing usage
