## Source

`/qa/qa-testing` — `<div.qa-filters>`

## Problem

The QA filter bar is a long horizontal row of buttons:
"Area: All | Scoring Pipeline | Automation | Trading | Risk | Data | Backtesting | UI | Broker | Alerts | Backend | ..."

This takes up too much space and wraps awkwardly.

## Expected

Compact these filter groups into a dropdown menu (or multi-select). The area filter should be a single compact control rather than a row of buttons.

## Element

```html
<div class="qa-filters">
  Area: All | Scoring Pipeline | Automation | Trading | Risk | Data | Backtesting | UI | Broker | Alerts | Backend | ...
</div>
```
