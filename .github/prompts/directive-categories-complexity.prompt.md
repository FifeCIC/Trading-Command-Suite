# Directive Complexity & Categories Improvement

Status: discussion
Created: 2026-06-29

## Current State
- All 90 directives currently return "Other" as category from the API
- The controller now derives categories from the PROTOCOL_REGISTRY groups, but ~65 directives aren't in any protocol group
- All directives show "Medium" complexity in the manager UI

## Discussion Points

### 1. Category Coverage
We need to categorize ALL registered directives. The PROTOCOL_REGISTRY only covers ~25 directives. Options:
- Add all directive IDs to DIRECTIVE_GROUPS
- Create a standalone directive category map
- Auto-categorize by naming convention or directive implementation class

### 2. Complexity Factors
Current complexity is always "Medium". Real complexity should consider:
- Number of data sources required (1 = simple, 3+ = complex)
- Real-time vs. batched processing
- External API dependencies (news, social, earnings calendars)
- Computational intensity (ML models, multi-timeframe analysis)
- Failure tolerance / fallback behavior
- Whether the directive is a gate (risk gates are structurally simpler)

### 3. Protocol Count Display
Directives should show "Used in N protocols" in the manager UI. This data is already computed in the controller but not displayed in the manager page.

### 4. Example Scenarios / Chart Visuals
For each directive, we should eventually show example scenarios:
- Standard indicators (RSI, MACD, EMA) can use TradingView chart overlays
- Custom directives need custom Canvas 2D overlays
- Set up a Lab area to experiment with approaches
- Consider a "Directive Visual Test" page per directive

## Actions
- [ ] Add missing directive categories to DIRECTIVE_GROUPS
- [ ] Implement complexity scoring logic
- [ ] Display protocolCount in the directives-manager UI
- [ ] Create Lab experiment for directive chart overlays
