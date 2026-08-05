## Source

`/automation/alert-center`

## Problem

### 1. Theme mismatch
Alert cards have dark backgrounds not synced with the current theme/light mode:
```html
<div>● trading  R3NK P&L Alert</div>
```

### 2. R3NK alerts investigation
R3NK alerts appear many times. An agent confirmed: "R3NK/risk system fires alerts but they're separate from the trading strategy execution flow."

**Questions:**
- Why is R3NK firing so many alerts?
- Is there a live protocol for R3NK?
- Should R3NK alerts be suppressed or filtered?

### 3. Alert count too high
The notification badge shows 1922 — far too many. Need filtering and limits.

### 4. Alert deduplication
When the exact same alert appears consecutively, collapse them into one row with a **count** and an **accordion** to view individual timestamps.

Rule: only merge consecutive identical alerts. If Alert A appears 5 times, then Alert B once, then Alert A again — only the first 5 merge. The final Alert A stays separate.

### 5. Missing severity/priority
Alerts have no severity level or color coding.

### 6. Limits
- Default limit: 200 stored alerts
- Error/fault alerts can exceed the limit
- Option for users to choose which event types trigger alerts (existing issue)

## Expected

- Fix theme styling
- Investigate and resolve R3NK alert spam
- Implement consecutive deduplication with accordion
- Add severity/priority with color coding
- Add configurable alert limits

## Elements

```html
<span class="notif-badge">1922</span>
```

Alert examples:
```html
<div>● trading  R3NK P&L Alert</div>
<div>● trading  MT5 Bridge Disconnected</div>
```
