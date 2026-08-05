## Source

`/trading/positions-monitor`

## Problem

### 1. In wrong menu section
Positions Monitor is buried under "— Legacy Strategy Pages —". It should be in the normal Trading menu — we're keeping it.

### 2. Card design needs revision
The position cards have a percentage loader bar that spans the full card width — it's taking up too much space. This is a card that needs to be larger and "busier" than most, showing more data.

## Expected

### Menu
- Move Positions Monitor out of "Legacy Strategy Pages" into the main Trading section

### Card design
- Reduce the percentage loader bar — don't make it full-width
- Explore 2-3 card design variants (A/B/C testing approach)
- If two designs are both good, keep them as user-selectable options
- Check if the Theme Lab has card design examples to reference

## Element

Current card:
```html
<div class="pm-pos-card pm-win">
  NVDA  Trading212  #NVDA  +6.83 (+7.6%)  Entry $184.94→$198.94  Direction...
</div>
```
