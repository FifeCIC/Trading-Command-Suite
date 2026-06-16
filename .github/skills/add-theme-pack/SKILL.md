---
name: add-theme-pack
description: "Add a new theme pack to the Trading Command Suite. Use when: creating a theme, adding a color scheme, building a theme pack with companion CSS, or registering a new theme card in the settings panel. Covers the JS token file, companion CSS file, vanilla adapter extension, and theme card registration."
---
# Add Theme Pack

## When to Use
- User asks to "add a theme", "new color scheme", "create theme pack"
- User shares a color palette or CSS from another website to adopt

## Architecture
A theme pack has three parts:
1. **JS token file** (`src/theme/packs/<name>.js`) — Exports `tokens` for light/dark modes and `extended` tokens
2. **Companion CSS** (`src/theme/packs/<name>.css`) — Scoped to `[data-theme-pack='<name>']`
3. **Theme card** — Registered in `App.jsx` `THEME_CARDS` array

## Procedure

### 1. Create the Token File
Create `src/theme/packs/<name>.js`:
```js
export const tokens = {
  light: {
    bg: '#hex',
    panel: '#hex',
    border: '#hex',
    text: '#hex',
    textDim: '#hex',
    accent: '#hex',
  },
  dark: {
    bg: '#hex',
    panel: '#hex',
    border: '#hex',
    text: '#hex',
    textDim: '#hex',
    accent: '#hex',
  },
};

export const extended = {
  bgElev: { light: '#hex', dark: '#hex' },
  bgElev2: { light: '#hex', dark: '#hex' },
  borderStrong: { light: '#hex', dark: '#hex' },
  textFaint: { light: '#hex', dark: '#hex' },
  riskNormal: { light: '#hex', dark: '#hex' },
  riskWatch: { light: '#hex', dark: '#hex' },
  riskElevated: { light: '#hex', dark: '#hex' },
  riskHigh: { light: '#hex', dark: '#hex' },
  riskCritical: { light: '#hex', dark: '#hex' },
  accentSoft: { light: '#hex', dark: '#hex' },
};
```

### 2. Extend the Vanilla Adapter
Edit `src/theme/adapters/vanilla.js`. Add the extended tokens to the output object:
```js
'--bgElev': extended.bgElev?.[mode] || ...,
'--bgElev2': extended.bgElev2?.[mode] || ...,
// ... etc
```

### 3. Create Companion CSS (optional)
Create `src/theme/packs/<name>.css` with rules scoped to the pack:
```css
[data-theme-pack='<name>'] .some-element {
  /* pack-specific overrides */
}
```
Import it in `App.jsx` alongside the other pack CSS files.

### 4. Register the Theme Card
In `App.jsx`, add to `THEME_CARDS` array (first position for default):
```js
{ id: '<name>', name: 'Display Name', description: 'Short description.', colors: ['#bg', '#accent', '#text'] },
```

### 5. Build and Verify
```powershell
npm --prefix c:/wamp64/www/trading-command-suite run build
```
Test theme switching in Settings → Theme Packs.

## Key Files
- `src/theme/packs/<name>.js` — token definitions
- `src/theme/packs/<name>.css` — companion stylesheet
- `src/theme/adapters/vanilla.js` — CSS variable generation
- `src/App.jsx` — THEME_CARDS registration and CSS import
