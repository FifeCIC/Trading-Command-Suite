---
description: "Rule for agents: when implementing or testing features, add structured QA entries to the QA Testing page. Applies to all agent work."
applyTo: "nest/src/**, src/pages/**, src/components/**, src/data/**"
---

# Agent QA Test Recording Rule

When you implement a feature, fix a bug, or run a test, you MUST add a structured entry to the QA checklist at `src/data/qa-checklist.js`.

## When to Add Entries

- **Feature complete**: after building a new endpoint, directive, protocol, or page
- **Bug fixed**: after fixing a bug — add a regression test entry
- **Test executed**: after running a manual or automated test with observable results
- **Integration verified**: after confirming two systems work together

## Entry Format

```javascript
{
  id: 'qa-{category}-{number}',       // e.g. qa-auto-001, qa-nvda-001, qa-risk-001
  area: '{System Area}',              // Scoring Pipeline, Trading, Automation, Data, UI, Risk, etc.
  system: '{Component Name}',         // Specific system being tested
  name: '{Short descriptive name}',   // What was tested
  procedure: '{How to reproduce}',    // Concrete steps — API calls, UI navigation, etc.
  expected: '{Expected result}',      // What should happen
  category: '{Category}',             // API, Directive, Protocol, Integration, Feature, Safety, UI
  priority: '{priority}',             // critical, high, medium, low
  versionNote: '{context}',           // Sprint/date/version info
}
```

## ID Convention

- `qa-score-*` — scoring pipeline tests
- `qa-auto-*` — automation/loop/trading tests
- `qa-data-*` — data import/quality tests
- `qa-risk-*` — risk management/safety tests
- `qa-ui-*` — frontend/UX tests
- `qa-int-*` — integration tests (cross-system)
- `qa-mt5-*` — MT5 bridge/broker tests
- `qa-crypto-*` — crypto-related tests
- `qa-backtest-*` — backtesting tests
- `qa-protocol-*` — protocol validation tests
- `qa-nvda-*`, `qa-eurusd-*` etc — symbol-specific tests

## Priority Guidelines

- **critical**: core trading pipeline, data integrity, money-affecting
- **high**: automation execution, scoring accuracy, position sync
- **medium**: UI correctness, filter accuracy, display issues
- **low**: cosmetic, nice-to-have, documentation

## Example Entries

```javascript
// Automated trading execution
{
  id: 'qa-auto-001',
  area: 'Automation',
  system: 'Automation Loop',
  name: 'Auto-mode strategy executes trade when score exceeds threshold',
  procedure: 'Create TEST strategy with minComposite=10, mode=auto, wait for EURUSD score>10 during London session',
  expected: 'MT5 position opened with SL/TP set, decision shows EXECUTED, ticket number returned',
  category: 'Integration',
  priority: 'critical',
  versionNote: 'Sprint 2026-07-08 — auto-execute fix',
},

// Data import verification
{
  id: 'qa-data-001',
  area: 'Data',
  system: 'Market Data Import',
  name: 'NVDA 5m bars imported from Yahoo Finance',
  procedure: 'GET /api/signals/envelope/NVDA — verify composite > 0 and bars available',
  expected: '67 bars from Jul 7 14:30-20:00 UTC, composite score 3/SELL',
  category: 'API',
  priority: 'medium',
  versionNote: '2026-07-08 — NVDA backtest prep',
},
```

## File Location

`src/data/qa-checklist.js` — append new entries to the end of the array, before the closing `];`.
