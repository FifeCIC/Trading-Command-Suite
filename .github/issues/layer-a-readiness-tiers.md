## Problem

104 registered directives. ~25 produce real, data-backed scores. The other ~79 return mock-neutral (score=50) or stub (score=0 with [STUBBED]). Strategies and protocols appear "active" but produce scores that are partially or entirely noise. Users cannot distinguish real signals from placeholders.

## Solution

Add a `readiness` tier to every directive, data feed, protocol, and strategy:

| Tier | Meaning | Directive Behavior |
|------|---------|-------------------|
| **ALPHA** | Idea documented, code exists, NOT verified | Returns mock-neutral (score=50) |
| **BETA** | Works with real data, has documented limitations | Real math but e.g. uses proxy data |
| **READY** | Verified against live data, thresholds tuned | Full scoring active |

**Weakest-link rule**: A component can only claim the readiness of its weakest dependency. One ALPHA directive makes the entire protocol ALPHA.

## Tasks

### Phase 1 — Directive Interface
- [ ] Add `readonly readiness: 'alpha' | 'beta' | 'ready'` to IDirective interface
- [ ] Default all 104 existing directives to 'alpha' (alpha until proven)
- [ ] Promote directives with verified real-math to 'beta' (~25 directives)
- [ ] Add `readiness` column to Directive DB table (enum)

### Phase 2 — Enforcement
- [ ] Scoring pipeline: exclude ALPHA directives from composite (show in breakdown as "mock — excluded")
- [ ] Protocol activation: BLOCK if protocol readiness is ALPHA
- [ ] BETA directives: cap confidence at 0.6

### Phase 3 — UI Honesty
- [ ] Strategy Library: per-directive readiness badges (red/yellow/green)
- [ ] META.Stack Explorer: stage status reflects weakest dependency
- [ ] Automation Dashboard: strategy status shows RUNNING / PENDING / BLOCKED / DEGRADED
- [ ] Directive Registry: filterable readiness column
- [ ] QA Testing Page: priority queue — alpha directives sorted by "closest to beta"

### Phase 4 — Pending State
- [ ] Strategies waiting for data enter PENDING (not BLOCKED)
- [ ] Auto-queue data fetching for pending strategies
- [ ] Auto-activate when requirements met; escalate to BLOCKED after 24h timeout

## Docs

- `docs/readiness-tiers.md` — Full policy document (already created)

## Related

- Layer B: Capability Contracts & Activation Gates
- Layer C: Hybrid Base+Bonus Scoring
