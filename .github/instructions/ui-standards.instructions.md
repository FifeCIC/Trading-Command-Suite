# UI Standards — Trading Command Suite

**Purpose:** Defines what UI technologies and patterns are permitted across the plugin vs. experimental-only.

---

## ✅ Accepted (use freely in any page)

| Technology | Usage |
|---|---|
| **View Transitions API** | Page-to-page crossfade via `<meta name="view-transition">`. Active globally. |
| **CSS Variables** (`var(--ink)`, `var(--panel)`, etc.) | All theming. Defined in `index.css :root` and theme packs. |
| **CSS Grid + Flexbox** | Layout. Standard across all pages. |
| **`useQuery` + `apiGet`** | Data fetching pattern. From `@tanstack/react-query` and `src/core/api/client`. |
| **LoadingSkeleton** | Loading states. Import from `src/components/LoadingSkeleton`. |
| **CSS Nesting** | Use sparingly for deep selectors. Native CSS nesting is supported. |
| **CSS Animations / Transitions** | Keep under 300ms. Prefer `opacity` and `transform` for GPU acceleration. |
| **SVG inline charts** | Simple visualizations. Keep under 100 nodes for performance. |
| **`motion` (Motion One)** | Accepted. Use for micro-interactions only: hover states, enter/exit, list reorder. Avoid layout animations on data-heavy pages. |
| **React Hooks** | `useState`, `useMemo`, `useCallback`, `useRef`, `useEffect` — standard. |
| **Zustand stores** | Global state. `useUiStore` for theme/prefs, new stores for feature state. |
| **ErrorBoundary** | Wrap every page. Import from `src/components/ErrorBoundary`. |

## 🧪 Experimental (Lab area only until proven)

| Technology | Lab page | Criteria for promotion |
|---|---|---|
| **Container Queries** | `/lab/theme-lab-container` | Verify no layout break on supported browsers. Fallback OK. |
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

## 📐 Page Scaffold Pattern

Every new page must:
1. Import `LoadingSkeleton` for loading state
2. Wrap content in `<ErrorBoundary>` in the route
3. Use `useQuery` + `apiGet` for data, never inline fetch
4. Show error state when API is unreachable
5. Show empty state when data is missing
6. Use CSS variables for all colors (never hardcode hex)
7. Export as default function

## 🎨 Theme Lab Rules

- The Theme Lab is sandboxed — changes here do NOT affect the rest of the app
- Experimental features live only in Theme Lab sub-pages
- When an experimental feature is promoted to accepted, update this file AND create a migration prompt
- Keep examples self-contained: no external data dependencies, no API calls
- Each sub-page should include both working demos AND code snippets showing usage
