---
description: "DEPRECATED — Superseded by agent-handoff.instructions.md. Agents should write handoff files instead of directly editing QA/Capability/Architecture pages. The Librarian batch-processes handoffs."
applyTo: "**"
---

# Agent QA Test Recording Rule — DEPRECATED

**⚠️ This rule has been superseded by `agent-handoff.instructions.md`.**

Do NOT directly edit `qa-checklist.js`, `CapabilityMapPage.jsx`, or `architecture-framework.data.js`. Instead, write a handoff file to `.github/handoffs/` as described in `agent-handoff.instructions.md`. The Librarian agent will batch-process all handoffs and update these pages.

## Legacy reference (for handoff format)

When writing the QA section of your handoff, use this format:

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
