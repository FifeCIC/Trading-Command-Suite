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
Create `src/pages/<PageName>.css` with scoped class names. Use the theme's CSS custom properties:
- `var(--bg)` — page background
- `var(--panel)` — card/section background
- `var(--border)` — borders
- `var(--text)` / `var(--textDim)` / `var(--textFaint)` — text hierarchy
- `var(--accent)` — accent color
- `var(--riskNormal)` / `var(--riskHigh)` — status colors

### 3. Add to Nav Tree
Edit `src/core/nav-tree.js`. Find the appropriate area and add a view:
```js
{ id: 'view-id', label: 'View Label' },
```
- Use kebab-case for the `id`
- Place the view where it makes sense in the area's existing order
- If creating a new area, add it before the `PRIMARY_PAGES` export

### 4. Add Route in App.jsx
a) Import the page at the top:
```js
import <PageName> from './pages/<PageName>';
```
b) Add a route in `renderMainContent()` (alphabetical order):
```js
if (secondaryView === 'view-id') {
  return <<PageName> />;
}
```

### 5. Build and Verify
```powershell
npm --prefix c:/wamp64/www/trading-command-suite run build
```
Navigate to `http://localhost:5188/<area>/<view-id>` to verify.

## Anti-Patterns
- Don't create pages that call APIs directly — use TanStack Query hooks
- Don't hardcode colors — use CSS custom properties
- Don't skip the nav-tree entry — the page won't be reachable from the sidebar
