## Source

`/automation/automation-dashboard`

## Problem

### 1. Toggle design
The automation config toggles are badly displayed:
```html
<div class="ad-config-row">
  mt5  Trading  Threshold  Confirm
</div>
```

These need to be replaced with the agreed toggle design. By the time this issue is worked on, the new design should be available in the Theme Lab (see related toggle slider issue #549).

### 2. Narrow layout
The dashboard uses a narrow grid layout. It should use the **full-width** layout like the Speed Scanner does:
```html
<div class="ad-grid">
  📊 Portfolio Scores  RBLX_US_EQ  2133  buy  strong  HOOD_US_EQ  2033  buy...
</div>
```

## Expected

- Replace all toggle switches with the Theme Lab toggle design
- Change to full-width content layout (reference Speed Scanner as the example)
