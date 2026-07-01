---
description: "Fix all directive implementations that hardcode Math.min(100, ...) instead of using this.maxScore. Also fix the volume-confirmation bug where score can exceed declared maxScore. Use when: auditing directive scoring, fixing directive clamps, or changing directive maxScore values."
argument-hint: "Fix all 29 clamps or just the critical ones?"
appliesTo: "nest/src/modules/directives/implementations/**"
---

# Fix Directive maxScore Clamps — Replace Hardcoded 100

## Problem
29 directive implementations hardcode `Math.min(100, score)` in their `calculate()` methods instead of clamping to `this.maxScore`. This means:

1. **If a directive's `maxScore` is ever changed** (e.g., from 100 to 200), the clamp silently caps at 100, producing incorrect scores.
2. **The volume-confirmation directive** declares `maxScore = 85` but its `calculate()` method can produce scores up to 100 (`85 + Math.min(15, ...)`) — a data contract violation that inflates normalized scores by up to 17.6%.
3. **The system's variable-weight architecture** (where different protocols can have different directive maxScores) is undermined — any directive with a non-100 maxScore that uses `Math.min(100, ...)` will silently produce wrong results.

## Design Principle
From the project's architecture:
> "Directives are not restricted to 100 so that one directive can have much lesser or greater weight in different scenarios than another and so that a protocol can have a clear score size difference from another protocol."

Every directive MUST clamp to `this.maxScore`, not to a hardcoded `100`.

## Affected Files

### Real Implementations (12 files):

| File | Lines | Pattern |
|------|-------|---------|
| `analyst-adjustments.directive.ts` | ~108 | `Math.max(0, Math.min(100, score))` |
| `bollinger-bands.directive.ts` | ~51 | `Math.min(100, score)` |
| `bollinger-percent-b.directive.ts` | ~44, ~54 | `Math.min(100, score)` ×2 |
| `chaikin-money-flow.directive.ts` | ~42 | `Math.min(100, score)` |
| `confluence-reversal.directive.ts` | ~120 | `Math.min(100, score + bonus)` |
| `price-action.directive.ts` | ~62 | `Math.min(100, score)` |
| `price-time-gap.directive.ts` | ~135 | `Math.min(100, score)` |
| `session-open-effect.directive.ts` | ~187 | `Math.min(100, score)` |
| `session-timing-filter.directive.ts` | ~129 | `Math.min(100, adjustedScore)` |
| `volume-surge.directive.ts` | ~64 | `Math.min(100, score)` |
| `williams-percent-r.directive.ts` | ~44, ~54 | `Math.min(100, score)` ×2 |
| `mt5-indicators.directives.ts` | ~40 | `clamp(v, 0, 100)` — 17 directives |

### Bug: `volume-confirmation.directive.ts`
```typescript
readonly maxScore = 85;  // Declared

// But calculate() does:
if (ratio >= 2.0) {
    score = 85 + Math.min(15, (ratio - 2) * 10);  // Can reach 85 + 15 = 100!
}
```
**Fix:** Either cap at 85 OR raise `maxScore` to 100. Recommendation: raise `maxScore` to 100 since the logic is intentionally bonus-based.

## Solution

### Fix Pattern (All 12 Real Files)

For every file listed above, replace:
```typescript
Math.min(100, score)     →  Math.min(this.maxScore, score)
Math.max(0, Math.min(100, score))  →  Math.max(0, Math.min(this.maxScore, score))
Math.min(100, score + bonus)  →  Math.min(this.maxScore, score + bonus)
Math.min(100, adjustedScore)  →  Math.min(this.maxScore, adjustedScore)
```

### Fix MT5 Directives (1 file, 17 directives)

In `mt5-indicators.directives.ts`, the `clamp()` helper has:
```typescript
function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}
```

Change the default to use the directive's actual `maxScore`:
```typescript
// Option A: Remove default, always pass maxScore
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
// Call sites: clamp(score, 0, this.maxScore)

// Option B: Make clamp a method on the directive class
private clamp(v: number, min = 0): number {
  return Math.max(min, Math.min(this.maxScore, v));
}
```

Recommend Option B — less churn at call sites.

### Fix volume-confirmation
```typescript
readonly maxScore = 100;  // Changed from 85 to 100
```

The `calculate()` method already produces scores in range 0–100, which is appropriate for the bonus structure (`85 + min(15, ...)`). Just align the declaration.

### Existing Non-100 Directives (NO changes needed)
These already clamp correctly:
- `rsi-oversold` (maxScore: 120) — no hardcoded clamp ✅
- `macd-crossover` (maxScore: 110) — no hardcoded clamp ✅
- `atr-dip` (maxScore: 95) — no hardcoded clamp ✅
- `fx-timing` (maxScore: 80) — stub, no clamp issue ✅

## Verification

After fixing all 29 directives:
1. Run `npm --prefix nest run build` — should compile clean
2. Verify: `GET /api/scoring/gated/NVDA` returns valid scores
3. Verify: no directive produces `normalizedScore > 100` in the breakout
4. Verify: `volume-confirmation` normalized score never exceeds 100%

## References
- Theory document: `docs/BTC-SPEED-PROTOCOL-THEORY.md`
- Directive interface: `nest/src/modules/directives/interfaces/directive.interface.ts`
- Gating service: `nest/src/modules/scoring/protocol-gating.service.ts`
- Group definitions: `nest/src/modules/directives/directive-groups.ts`
