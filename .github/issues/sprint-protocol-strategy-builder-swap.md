## Source

Two views with swapped identities:

### View A: `/scoring/create-protocols` (file: `StrategyBuilderPage.jsx`)
- Title says "Create Protocols"
- Has fields: Direction (Long/Short), Timeframe (Scalp/Speed/Day Trade), Watchlist selector
- Has "Directive Groups" section with GATE gating — this is a **scoring strategy** feature
- The URL says "create-protocols" but the functionality is mixed

### View B: `/scoring/strategy-builder` (file: unconfirmed)
- Title says "Protocol Name"
- Requires Watchlist selection
- This is actually a **protocol builder**, not a strategy builder
- Less polished than View A

## Problem

The URLs and file names are swapped relative to what each view actually does. The better UX (View A with Directive Palette) is on the wrong URL.

## Expected

1. **Discuss and clarify** which view should be the Protocol Builder and which should be the Strategy Builder
2. The user likes the "Directive Palette" approach from View A — use that design pattern
3. Likely approach:
   - Duplicate View A as the new Protocol Builder at the correct URL
   - Remove "Directive Groups" (GATE gating) from the Protocol Builder — that belongs in Strategy Builder
   - Move Direction (Long/Short) field to Protocol Builder
   - Decide where Timeframe field belongs
   - Rebuild Strategy Builder at the correct URL with Directive Groups + GATE functionality

## Discussion needed

- Should Direction (Long/Short) be on Protocol or Strategy?
- Should Timeframe (Scalp/Speed/Day Trade) be on Protocol or Strategy?
- Final URL/file naming for both views
