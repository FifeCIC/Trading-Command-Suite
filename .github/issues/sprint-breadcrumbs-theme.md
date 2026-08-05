## Source

`/trading212/t212-portfolio` — `<nav.breadcrumbs>`

## Problem

Breadcrumbs are rendered with dark backgrounds/styling even when the app is in light theme mode. They don't respond to the active theme.

## Expected

Breadcrumbs should match the current theme — light background in light mode, dark background in dark mode.

## Element

```html
<nav class="breadcrumbs" aria-label="Breadcrumb">
  Dashboard > Trading212 > Portfolio
</nav>
```
