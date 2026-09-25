---
name: create-new-page
description: "Create a new page/view in the Trading Command Suite React PWA. Use when: adding a new page to the app, creating a view for the sidebar navigation, adding a route to the shell, or scaffolding a new feature page with CSS. Covers the full wiring: component, CSS, nav-tree entry, and App.jsx route mapping."
---
# Create New Page

## When to Use
- User asks to "add a page", "create a view", "new screen", "add to nav"
- Scaffolding a feature page with sidebar navigation and routing

## Procedure

### 1. Create the Page Component
Create `src/pages/<PageName>.jsx`:
```jsx
import './<PageName>.css';

export default function <PageName>() {
  return (
    <div className="<page-class>-page">
      <header className="<page-class>-header">
        <h2>Page Title</h2>
        <p className="muted">Brief description of what this page does.</p>
      </header>
      {/* Page content */}
    </div>
  );
}
```

### 2. Create the CSS
Create `src/pages/<PageName>.css` with scoped class names. Use the theme's CSS custom properties.

⚠️ **THE OBVIOUS TOKEN NAMES ARE WRONG, AND AN UNDEFINED ONE FAILS THE BUILD.** This step used to
list `--text` / `--textDim` / `--textFaint` / `--riskNormal` — **none of those exist**. Measured
2026-09-25: writing them failed `validate-css-tokens.cjs` on **17 references**. Corrected names:

| used to say (wrong) | actual token |
|---|---|
| `--text` | `--ink` (primary text) · `--ink-soft` (secondary) |
| `--textDim` | `--text-dim` |
| `--textFaint` | `--text-faint` |
| `--riskNormal` / `--riskHigh` | `--risk-normal` / `--risk-high` |
| — | `--bg` · `--panel` · `--border` · `--line` · `--accent` · `--bg-elev` · `--font-mono` |

⚠️ At RUNTIME an undefined property is **not** an error — the declaration is silently dropped and
the element falls back to inherited styling. Verify before shipping:

```powershell
node scripts/validate-css-tokens.cjs            # must exit 0
node scripts/validate-css-tokens.cjs --tokens   # the full list of 152 defined tokens
```

⚠️ **Errors must come from the notice registry, not from prose** (#826). A hand-written error string
fails `validate-notices.cjs`, and `scripts/notice-ui-surfaces.json` is an allowance that **may only
go DOWN** — adding your page to it is a regression, not a fix. Use:

```js
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import { notice } from '../core/notices/registry.js';

<NoticeBlock notice={noticeFromError(err, 'TCS-SYS-007', { operation: 'load the thing' })} />
```

### 3. Add to Nav Tree
Edit `src/core/nav-tree.js`. Find the appropriate area and add a view:
```js
{ id: 'view-id', label: 'View Label' },
```
- Use kebab-case for the `id`
- Place the view where it makes sense in the area's existing order
- If creating a new area, add it before the `PRIMARY_PAGES` export

### 4. Register the view component in `src/core/view-routes.jsx`

⚠️ **THIS STEP USED TO SAY App.jsx — THAT IS WRONG AND THE FILE HAS MOVED ON.** Measured 2026-09-25:
App.jsx holds only **6** remaining `secondaryView ===` special cases, and none of them is a normal
page. The route map is `src/core/view-routes.jsx`, whose own header is explicit:

> *View Routes — Single source of truth mapping view IDs to page components.*
> *1. Import the component below  2. Add an entry to VIEW_COMPONENTS  3. Add the view to nav-tree.js*

```js
// src/core/view-routes.jsx — top, beside the other page imports
import <PageName> from '../pages/<PageName>.jsx';

// then in the VIEW_COMPONENTS map
  'view-id': <PageName>,
```

⚠️ The map's entries are indented with **2 spaces**, not 4 — an edit anchored on the wrong
indentation fails to match and leaves the page unreachable while the import looks correct.

### 4b. Add a view-meta entry — the page is not registered without it
Add to `src/core/view-meta.js`, keyed by the FULL route path:

```js
  '/<area>/<view-id>': {
    tier: 'premium',        // or 'free'
    review: 'pending',      // 'approved' once the owner has looked at it
    label: '<View Label>',
    file: 'src/pages/<PageName>.jsx',
    css: 'src/pages/<PageName>.css',
    api: ['GET /api/…'],
  },
```

### 4c. Regenerate the editions mirrors — required after ANY nav-tree change
```powershell
node scripts/generate-free-map.cjs; node scripts/generate-free-manifest.cjs; node scripts/generate-free-registry.cjs
```

### 5. Build and Verify
```powershell
npm run build                                    # Vite frontend — must exit 0
node scripts/verify-view-meta-routes.cjs         # nav -> view-meta sweep, 0 leaves without metadata
```
Then load `http://localhost:5173/<area>/<view-id>` and confirm it RENDERS — a page that compiles and
a page that renders are different claims. A nav-leaf count that went UP without the sweep passing
means the page is registered but unreachable.

## Anti-Patterns
- Don't create pages that call APIs directly — use TanStack Query hooks
- Don't hardcode colors — use CSS custom properties
- Don't skip the nav-tree entry — the page won't be reachable from the sidebar
