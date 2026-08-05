## Source

`/education/candle-patterns`

## Problem

### 1. Header not styled correctly
The header and some elements aren't synced with the current theme/light mode. This shouldn't apply to the TradingView chart itself.

### 2. Pattern legend shows too many
The bottom of the chart displays 3-4 patterns simultaneously. The legend shows all 17:
```html
<div class="pattern-legend">Patterns detected: 17  🔨 Hammer  ⇕ Engulfing  ⚊ Doji  ☰ Three Soldiers...</div>
```
**Expected:** Only show the current pattern and the previous one.

### 3. Pattern score explanation
What equation produces the pattern score? Is it an industry-standard calculation? The score is often close to but not exactly the confidence percentage.
```html
<span class="pattern-score">72</span>
```

### 4. "Candle Index" unclear
```html
<div class="detail-row">Candle Index  #57 of 1 candle</div>
```
Add popovers/hover tooltips explaining each field in the detail panel.

### 5. Pattern list needs column headers
The detected patterns list has columns but no headers — numbers are meaningless without context.

### 6. Pattern predictor (separate Lab issue)
Idea: predict the NEXT pattern using directives, run simulations on backtest data to measure accuracy. Separate view in the Lab.

### 7. TradingView chart customization
Can we change candle colors for candles that match detected patterns?

## Expected

- Fix header and element styling
- Limit pattern legend to current + previous
- Add popovers explaining each field
- Add column headers to pattern list
- Create separate issue for pattern predictor lab feature
