# SPY/QQQ Index Timing Directives

This document covers `spy_options_expiry`, `spy_month_end_rebalancing`, and `spy_qqq_relative_strength`.

## SPY Options Expiry Effect

Recommended scope: `SPY`, `QQQ`, `IWM`, `DIA`.

The directive calculates monthly options expiry as the third Friday of the month. No API is required.

- Week before OpEx: -10
- OpEx day: -15
- Week after OpEx: +20
- Quarterly OpEx months, March, June, September, and December: multiply the effect by 1.5

## SPY Month-End Rebalancing

Recommended scope: `SPY`, `QQQ`, broad index ETFs, and large-cap index components.

The directive uses calendar trading-day position and supplied current-month return:

- Last three trading days and month down more than 3%: +25
- Last three trading days and month up more than 5%: -15
- First three trading days of a new month: +10
- Quarter-end month-end effects are multiplied by 1.5

## SPY/QQQ Relative Strength

Recommended scope: `SPY`, `QQQ`, `IWM`.

The directive compares supplied 10-session returns or derives them from histories:

- QQQ beating SPY by more than 2%: +20
- SPY beating QQQ by more than 2%: -15
- IWM outperforming SPY: +15

## Strategy Template

The `SPY/QQQ Index Timing` Strategy Builder template uses:

- SPY Options Expiry Effect: 30%
- SPY Month-End Rebalancing: 30%
- SPY/QQQ Relative Strength: 25%
- Volume: 15%
