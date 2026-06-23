---
description: "Implement IANA timezone-aware directive gating — replace hardcoded UTC offsets with timezone strings. Use when: working on directives, scoring, session timing, or any time-based trading logic. Every UTC offset in the codebase is broken 8 months/year due to DST."
argument-hint: "Which time-sensitive code needs IANA migration?"
---

# IANA Timezone-Aware Directive Gating

**Source:** Q291 (Google Drive: `.agenticmemory/prompts/Q291-Timeframe-Aware-Directives.md`)  
**Status:** DESIGNED — NOT IMPLEMENTED  
**Priority:** High (current UTC offsets are wrong for DST transitions)

## Problem

Every time-based check in the codebase uses hardcoded UTC offsets:

| File | Current Approach | DST Breakage |
|------|-----------------|--------------|
| `TradingGatesService` | `UTC-4` hardcoded | Wrong Mar-Nov (should be UTC-5) |
| `SessionTimingFilterDirective` | UTC hour ranges (0-9, 8-17, 13-21) | No DST awareness at all |
| `SessionOpenEffectDirective` | UTC ±30min around 00:30, 08:30, 13:30 | Window shifts by 1hr in DST |
| `FreshnessService` | "13:30-20:00 UTC = US hours" | Hardcoded, no holidays |

US markets open at 09:30 Eastern regardless of DST. A UTC offset like `-05:00` is wrong for 8 months of the year.

## Design Decision (Confirmed 2026-06-18)

Use **full IANA timezone strings** (e.g. `"America/New_York"`), NOT UTC offsets.

**Library:** `date-fns-tz` or `luxon` to resolve "what time is it now in timezone X?"

**UI:**
- Primary: `Intl.supportedValuesOf('timeZone')` (modern browsers)
- Fallback: Curated list of major trading timezones

## Implementation Tasks

### 1. Extend IDirective Interface

```typescript
interface TimeWindow {
  start: string;         // "09:30"
  end: string;           // "16:00"
  timezone: string;      // IANA string, e.g. "America/New_York"
  daysOfWeek?: number[]; // [1,2,3,4,5] = Mon-Fri (1=Mon in JS getDay())
}

interface TimeModifier {
  after: string;         // "14:30"
  before?: string;       // "09:30" (optional range)
  adjustment: number;    // positive = bonus, negative = deduction
  reason: string;        // "Pre-US close — position-squaring pressure"
}

// Add to existing IDirective interface:
readonly activeWindow?: TimeWindow;
readonly timeModifiers?: TimeModifier[];
```

### 2. Implement Time Evaluation in DirectivesService.runAll()

- Before `directive.calculate(input)`, check `activeWindow`
- If outside window → return `{ score: 0, confidence: 0, reason: "Outside active window (09:30-16:00 ET)", signalClass: 'neutral' }`
- After calculating, apply `timeModifiers` — adjust score, append reason

### 3. Update DirectiveResult

```typescript
timeGated: boolean;          // true if suppressed by activeWindow
timeModifiersApplied: { adjustment: number; reason: string }[];
```

### 4. Reference Implementation

Apply time config to `SessionOpenEffectDirective`:

```typescript
activeWindow: {
  start: "09:00", end: "10:00",
  timezone: "America/New_York",
  daysOfWeek: [1, 2, 3, 4, 5]
}
```

### 5. Migrate Existing Hardcoded UTC Checks

| File | Migration |
|------|-----------|
| `TradingGatesService.checkScope()` | Replace `UTC-4` with IANA-resolved check |
| `SessionTimingFilterDirective` | Convert UTC hour ranges to IANA-aware windows |
| `SessionOpenEffectDirective` | Use `activeWindow` from interface instead of manual UTC math |
| `FreshnessService` | Use IANA-resolved market hours |

### 6. Strategy Config

```json
{
  "timezone": "Europe/London",
  "tradingHours": { "start": "08:00", "end": "16:30" }
}
```

## UI Warning (Strategy Builder)

When a directive has `activeWindow` or `timeModifiers`:
> ⚠️ This directive is time-gated. It will score zero outside ${activeWindow.start}-${activeWindow.end} ${activeWindow.timezone}.

## Acceptance Criteria
- [ ] `IDirective` interface extended with `activeWindow` and `timeModifiers`
- [ ] `DirectivesService.runAll()` respects `activeWindow` (returns zero outside)
- [ ] `DirectivesService.runAll()` applies `timeModifiers` (adjusts score after calculation)
- [ ] `SessionOpenEffectDirective` includes reference time config
- [ ] `TradingGatesService` migrated to IANA timezone
- [ ] `SessionTimingFilterDirective` migrated to IANA windows
- [ ] `FreshnessService` migrated to IANA-resolved market hours
- [ ] Strategy config supports `timezone` and `tradingHours`
- [ ] No hardcoded UTC offsets remain in time-sensitive code

## Design Boundaries

This prompt describes the **automated gating layer**. The `7-day-market-awareness.prompt.md` prompt is the **agent context layer**. They are complementary:

```
AUTOMATED (this prompt)              AGENT (7-day-market-awareness)
────────────────────────             ─────────────────────────────
activeWindow blocks scores           Prompt tells agent what to check
timeModifiers adjust scores          Prompt provides day-of-week context
TradingGatesService blocks trades    Prompt gives decision rules
DirectivesService enforces windows   Prompt loads session-specific data
```

When this is implemented, the agent prompt should delegate to these automated gates where they exist.

## Related
- `7-day-market-awareness.prompt.md` — agent-facing day-of-week context (complementary, different layer)
- `session-timing-filter.directive.ts` — current UTC-based implementation to migrate
- `session-open-effect.directive.ts` — current UTC-based implementation to migrate
- `trading-gates.service.ts` — current hardcoded UTC-4 to fix
- `freshness.service.ts` — current hardcoded market hours to fix
- [#39](https://github.com/FifeCIC/trading-command-suite/issues/39) — Market Calendar Service (holidays, DST, early close — necessary companion)
- Q294 (Google Drive, Decision Lab) — Timezone Visual Comparison demo
