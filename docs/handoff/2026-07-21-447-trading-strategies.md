# Handoff — #447 Trading Strategies: TF Tooltip, Sidebar Font Sizes

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#447](https://github.com/FifeCIC/Trading-Command-Suite/issues/447)

## What Changed

### a) TF Column Hover Popover
- TF column header now shows a popover on hover: "Timeframe — the chart interval each strategy operates on (e.g. 5m = 5-minute, 1h = 1-hour, 1D = daily)"
- Each TF cell also shows a popover: "Timeframe: {value} — determines how frequently the strategy evaluates signals"
- Styled with accent-colored border matching the Theme Lab popover design
- Cursor changes to `help` on hover

### b) Sidebar Font Sizes Increased (~15-20%)
All sidebar text elements scaled up for readability:

| Element | Before | After |
|---------|--------|-------|
| `.ts-sidebar-empty` | 0.9rem | 1.05rem |
| `.ts-sidebar-detail h2` | 1.15rem | 1.35rem |
| `.ts-detail-section h3` | 0.75rem | 0.88rem |
| `.ts-detail-card` | 0.88rem | 1.02rem |
| `.ts-detail-card p` | 0.82rem | 0.95rem |
| `.ts-req-label` | 0.72rem | 0.84rem |
| `.ts-req-value` | 0.75rem | 0.88rem |
| `.ts-intensity-badge` | 0.68rem | 0.78rem |
| `.ts-intensity-desc` | 0.7rem | 0.8rem |
| `.ts-account-chip` | 0.7rem | 0.8rem |
| `.ts-no-fallback`, `.ts-has-fallback` | 0.62rem | 0.72rem |
| `.ts-checklist` | 0.65rem | 0.75rem |
| `.ts-disable-note` | 0.6rem | 0.7rem |

### Deferred
- **POS column investigation**: Trade table does not currently store triggering strategy. Schema change needed to link Trade → Strategy for accurate position counts.
- **Non-MT5 positions (T212/ISA)**: POS column still only checks MT5. Extending requires querying T212 and ISA position APIs.
- **TF glossary entry (#445)**: Should be added in a separate glossary update.

### Files Changed
- `src/pages/TradingStrategiesPage.jsx` — TF column header + cell popovers
- `src/pages/trading-strategies.css` — TF popover styles, 12 sidebar font size increases

### Build Verification
- Vite: `vite build` — 2906 modules, no errors
