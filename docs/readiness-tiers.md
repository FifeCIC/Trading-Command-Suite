# Readiness Tier Policy

> Established 2026-07-29 from architectural quality-control discussion.
> This policy is **enforced** — not advisory. Code review and activation gates
> MUST check readiness tiers before accepting changes or activating strategies.

---

## The Problem

> ⚠️ **Counts flagged for re-verification (2026-09-13).** These figures were written 2026-07-29 and are stale: the code registry now declares **155** directive ids (was 104). The readiness *distribution* lives in the DB (`directive.readiness`) — recount via `GET /api/directives` before quoting these numbers. The **policy** below is the part that still stands.

The Trading Command Suite registers a large directive set. Only a minority produce real, data-backed scores. The remainder fall into two categories:

- **Mock-neutral**: Returns score=50 with "no API keys" or "data unavailable" reason. Present in the scoring pipeline, drags composites toward the middle.
- **Stub**: Returns score=0 or placeholder values. Marked `[STUBBED]` but still registered and counted in directive totals.

The result: strategies and protocols appear "active" and produce plausible-looking scores that are partially or entirely noise. Users cannot distinguish between a score driven by real market data and a score driven by mock placeholders.

## The Tier System

Every component in the system — directives, data feeds, protocols, strategies — carries a **readiness tier**:

```
┌─────────┬──────────────────────────────────────────────────┐
│  ALPHA  │ Idea documented, code exists, NOT verified with  │
│         │ real data. May return mock-neutral or stub.      │
│         │                                                  │
│         │ Directive: returns 50 with "mock" reason         │
│         │ Data feed: planned, no provider connected        │
│         │ Protocol: contains ≥1 alpha directive            │
│         │ Strategy: status = 'concept'                     │
├─────────┼──────────────────────────────────────────────────┤
│  BETA  │ Works with real data, has known limitations.     │
│         │ Limitations are DOCUMENTED and SURFACED to user. │
│         │                                                  │
│         │ Directive: real math, but e.g. uses proxy data   │
│         │ Data feed: active but indirect (EURUSD for DXY)  │
│         │ Protocol: all directives ≥ beta, some degraded  │
│         │ Strategy: status = 'partial' or 'supported'      │
├─────────┼──────────────────────────────────────────────────┤
│  READY  │ Verified against live data. Thresholds tuned.    │
│         │ Confidence calibrated. No known limitations.     │
│         │                                                  │
│         │ Directive: real math, real data, tested output   │
│         │ Data feed: direct provider connection verified   │
│         │ Protocol: all directives ready                   │
│         │ Strategy: status = 'live'                        │
└─────────┴──────────────────────────────────────────────────┘
```

## The Weakest-Link Rule

> **A component can only claim the readiness of its weakest dependency.**

This is the strictest quality control in the system. Examples:

| Component | Dependencies | Readiness |
|-----------|-------------|-----------|
| `gold-macro-correlation` directive | DXY feed (EURUSD proxy = BETA), 10Y feed (not connected = ALPHA) | **ALPHA** |
| `xau-speed-v1` protocol | 9 directives: 4 READY, 3 BETA, 2 ALPHA | **ALPHA** |
| Gold Macro Regime strategy | `xau-macro-v1` protocol (ALPHA) | **ALPHA** |

A single alpha directive poisons the entire chain upward. This is intentionally harsh — it forces the team to promote dependencies before claiming readiness.

## Where Tiers Are Stored

| Component | Storage Location | Field |
|-----------|-----------------|-------|
| Directive | `IDirective` interface (NestJS) | `readonly readiness: 'alpha' \| 'beta' \| 'ready'` |
| Directive (DB) | `Directive` table | `readiness` column (enum) |
| Data Feed | Provider health endpoint | `status` field with readiness metadata |
| Protocol | Computed from directive readiness | Not stored — derived at query time |
| Strategy | `strategy-library.js` | `status: 'concept' \| 'partial' \| 'supported' \| 'live'` |

## Enforcement Points

### 1. Directive Registration

When a new directive is added to `directives.module.ts`, it MUST declare a readiness tier. The default is `'alpha'` — a directive is alpha until proven otherwise. Promoting to beta or ready requires:

- Beta: Evidence of real data flowing + documented limitations
- Ready: Test suite with known input/output pairs + confidence calibration

### 2. Protocol Activation

When a protocol is activated (wired to a strategy), the system computes its readiness from its directives. If the protocol is ALPHA, activation is BLOCKED with a message listing which directives need promotion.

### 3. Strategy Library Display

The Strategy Library page shows per-strategy readiness. Expandable cards show per-directive readiness with color coding (red=alpha, yellow=beta, green=ready). Users can filter to show only READY strategies.

### 4. Scoring Pipeline

ALPHA directives are EXCLUDED from composite scoring. They appear in the breakdown with a "mock — excluded" flag. BETA directives are included but their confidence is capped at 0.6. READY directives contribute fully.

### 5. META.Stack Explorer

Each pipeline stage shows readiness: green check (ready), yellow dash (beta/degraded), red X (alpha/missing). The "Confirm All" button only activates for stages where all sub-components are ≥ beta.

## Transition Rules

| From → To | Requirement |
|-----------|------------|
| ALPHA → BETA | Real data flowing for ≥ 5 trading days. Documented limitations. No mock/stub returns. |
| BETA → READY | Test suite passing. Thresholds calibrated against ≥ 50 historical signals. Confidence ≥ 0.6. |

Transitions are ONE-WAY. A READY directive that starts returning mock data (provider fails) is demoted to BETA, not ALPHA — it still has proven logic, just degraded data.

## Pending State (Data-Gated Activation)

A strategy whose requirements are not yet met but are **fetchable** enters a PENDING state rather than being blocked:

```
Strategy activation:
  ✓ Symbol registered
  ✓ Protocol valid
  ✗ Required bars not yet cached (need 200 daily, have 47)
  ✗ DXY data not yet flowing (EURUSD proxy available but untested)
  
  → Result: PENDING (not BLOCKED)
  
  System auto-queues:
  1. BarRefreshService: bump XAUUSD priority, fetch remaining 153 daily bars
  2. DXY pipeline: begin EURUSD proxy collection
  
  When requirements met → auto-activates to RUNNING
  If requirements not met within 24h → escalates to BLOCKED with reason
```

This distinguishes between "can never work" (BLOCKED — missing provider, unsupported symbol) and "not ready yet" (PENDING — waiting for data to accumulate).

## Filters Throughout the App

| Page/Section | Filter |
|-------------|--------|
| Strategy Library | Toggle: Show all / Hide ALPHA / READY only |
| Directive Registry | Column: Readiness (sortable, filterable) |
| Protocol Config | Badge on each directive: 🟢 READY 🟡 BETA 🔴 ALPHA |
| META.Stack Explorer | Stage status reflects weakest dependency |
| Automation Dashboard | Strategy status: RUNNING / PENDING / BLOCKED / DEGRADED |
| QA Testing Page | Priority queue: ALPHA directives sorted by "closest to BETA" |
| Capability Map | Feature readiness heatmap (green → red gradient) |
