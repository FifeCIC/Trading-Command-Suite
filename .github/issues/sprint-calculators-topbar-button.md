## Source

`/trading/calculators`

## Problem

Calculators are currently accessed via a "C" gear button that's hidden away. This should be a first-class feature accessible from the topbar.

## Expected

### Add topbar button
Create a "Calculators" button in the topbar, placed beside the existing "Online" status button:
```html
<button class="topbar-status-summary">Online</button>
```

### Remove gear button
Remove the existing "C" gear button:
```html
<button class="so-gear-btn">C</button>
```

### Wire all calculators
Ensure all calculator tools from the Calculators page are accessible via the new button/dropdown.
