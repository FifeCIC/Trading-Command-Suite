---
description: "Quick-reference answers about the Trading Command Suite frontend architecture. Use when: an agent needs to understand the app shell, route system, CSS architecture, data fetching pattern, state management, or page registration flow. Saves re-discovering these patterns by reading 500+ lines of code."
---

# App Architecture Explorer — Quick Reference

Use this skill when you need to understand how the Trading Command Suite frontend is wired. Instead of reading hundreds of lines to rediscover the patterns, check here first.

---

## AppShell (Layout Shell)

**File:** `src/App.jsx` (function starts ~line 189, JSDoc comment above it)

- **Route param mapping:**
  - `/:area/:view` → `useParams()` gives `{area, view}` → `primaryArea=area`, `secondaryView=view`
  - `/research/symbol/:symbolId` → `{symbolId}` → `primaryArea='research'`, `secondaryView='symbol-detail'`
  - `/symbol/:ticker` → standalone page (`SymbolFocusPage`, no AppShell wrapper)

- **Content rendering:** `renderMainContent()` at line ~484 looks up `VIEW_COMPONENTS[secondaryView]` from `src/core/view-routes.jsx`. Falls back to plugin skeletons, then inline views (demos, analytics, about, roadmap). **Does NOT use React Router `<Outlet>`.**

- **Sidebar** (`<aside className="left-rail">`, line ~896): Shows `NAV_STRUCTURE[primaryArea]` views. Bookmarks section below.

- **Footer** (line ~960): Quick links, status indicators, dev overlay toggle.

- **ScreenOptions** (line ~1030): Floating disc group, per-view settings via `VIEW_TO_OPTIONS` mapping.

---

## Route Table

**File:** `src/App.jsx` lines ~1050-1060

```
/research/symbol/:symbolId  → AppShell (research area, symbol-detail view)
/trading/symbol/:ticker     → SymbolPage
/symbol/:ticker             → SymbolFocusPage (standalone, no AppShell)
/:area/:view                → AppShell (catch-all for nav structure)
/:area                      → AppShell (first view auto-selected)
/                           → HomeDashboard
/dashboard                  → DashboardPage
```

---

## VIEW_COMPONENTS (Page Registry)

**File:** `src/core/view-routes.jsx`

Maps `secondaryView` strings to React components. ~90+ entries. If a page isn't rendering, check:
1. Is there an entry in `VIEW_COMPONENTS`?
2. Is there a route in the route table?
3. Is the page imported in `App.jsx`?

---

## CSS Architecture

- **Theme system:** CSS variables scoped to theme packs (`src/theme/packs/`). Key variables: `--ink`, `--panel`, `--line`, `--accent`, `--ink-soft`.
- **`color-mix()`** used throughout for hover states (e.g., `color-mix(in srgb, var(--accent) 8%, var(--panel))`).
- **Global styles:** `src/App.css`, `src/index.css`. `.btn` class at `App.css:64`.
- **Page styles:** Each page imports its own CSS file. Some pages scope styles under a parent class (e.g., `.trading-platforms-page .btn`).
- **Theme packs:** `src/theme/packs/ai-original.css`, `scifi.css`, etc. Imported in `App.jsx`.

---

## Data Fetching

- **Library:** TanStack Query (`@tanstack/react-query`)
- **Client:** `apiGet` from `src/core/api/client`
- **Pattern:**
  ```jsx
  const query = useQuery({
    queryKey: ['some-key'],
    queryFn: () => apiGet('/api/some-endpoint'),
    refetchInterval: 30_000,
    retry: 1,
  });
  ```
- Error handling: `.catch(() => null)` in `queryFn`, then check `data` for null/undefined.

---

## State Management

- **Zustand** via `src/stores/useUiStore.js` for UI state (theme, sidebar collapse, bookmarks, dev overlay).
- **localStorage** for preferences (`tcs:preferences` key) and ScreenOptions view settings.
- **React state** (`useState`) for most component-local state.
- **No Redux** or Context providers for global state.

---

## Page Registration Checklist

When adding a new page:

1. Create component in `src/pages/`
2. Import it in `src/App.jsx` (with all other page imports)
3. Add route in the route table (App.jsx ~line 1050) — wrap in `<AppShell />` if it needs sidebar/header/footer
4. Add entry to `VIEW_COMPONENTS` in `src/core/view-routes.jsx` with matching `secondaryView` key
5. Add nav entry in `src/core/nav-tree.js` `NAV_STRUCTURE` under the appropriate `primaryArea`
6. Build and verify the route

---

## Key Files at a Glance

| Purpose | File |
|---------|------|
| App shell + routing | `src/App.jsx` |
| View component registry | `src/core/view-routes.jsx` |
| Navigation tree | `src/core/nav-tree.js` |
| Feature flags | `src/utils/featureFlags.js` |
| Zustand UI store | `src/stores/useUiStore.js` |
| API client | `src/core/api/client.js` |
| Theme packs | `src/theme/packs/*.css` |
| Global CSS | `src/App.css` |
