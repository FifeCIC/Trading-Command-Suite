# UI Standards — Trading Command Suite

**Purpose:** Defines what UI technologies, visual patterns, spacing/sizing scales, and user-configurable preferences are permitted across the app. This file is the single source of truth for the React UI Agent.

---

## 🎨 Visual Specification

### CSS Variable Tokens (in `src/index.css :root`)

All colors MUST use CSS variables. Never hardcode a hex value in a page/component CSS file.

| Token | Value | Purpose |
|-------|-------|---------|
| `--bg` | `#000000` | Page background |
| `--ink` | `#e5e7eb` | Primary text |
| `--ink-soft` | `#94a3b8` | Secondary/muted text |
| `--panel` | `#000000` | Panel/shell background |
| `--line` | `#1a1a1a` | Borders, dividers |
| `--accent` | `#0ea5a6` | Primary accent (teal) |
| `--danger` | `#ef4444` | Destructive actions |
| `--color-profit` | `#22c55e` | Profit, buy, bullish |
| `--color-loss` | `#ef4444` | Loss, sell, bearish |
| `--color-buy` | `#22c55e` | Buy signal |
| `--color-sell` | `#ef4444` | Sell signal |
| `--color-accent-blue` | `#3b82f6` | Interactive elements |
| `--color-warning` | `#f59e0b` | Warnings, cautions |
| `--color-neutral` | `#94a3b8` | Neutral/muted text |
| `--color-muted` | `#64748b` | Disabled, tertiary |
| `--color-text-dim` | `#6b7280` | Dimmed text |
| `--color-panel` | `#1a1d2e` | Card/panel fill |
| `--color-border` | `#2d3040` | Card/panel border |
| `--color-grid` | `#1e2030` | Grid/dashboard fill |
| `--color-input-bg` | `#111318` | Input backgrounds |
| `--shadow-card` | `0 12px 28px rgba(0,0,0,0.65)` | Card elevation |

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
```
.pm-pos-card { border-left: 3px solid ... }
.pm-win  { border-left-color: var(--color-profit); }
.pm-lose { border-left-color: var(--color-loss); }
```
Used in: Positions Monitor, Strategy Comparison, Portfolio cards.

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
- [ ] Phase gates checked — no phase-gated features built prematurely

---

## ✅ Accepted (use freely in any page)

| Technology | Usage |
|---|---|
| **View Transitions API** | Page-to-page crossfade via `<meta name="view-transition">`. Active globally. User-toggleable via `pageTransitions` preference. |
| **CSS Variables** (`var(--*)`)  | All theming and colors. Defined in `index.css :root`. |
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
