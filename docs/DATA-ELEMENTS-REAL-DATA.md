# Data Elements — Demo Data Cleanup & Real Data Strategy

**Created**: 2026-06-30
**Status**: Discussion
**Page**: `/data/data-elements`

---

## Current Issue
The Data Elements page shows a status "COMPLETE" with 163 symbols, implying all data-elemented indicators are applied to all symbols. This is misleading — not all elements need to apply to all symbols. The current display is demo/placeholder data.

## User Intent
- Stop showing demo data across the app
- Generate small amounts of real test data using the current default watchlist
- Data elements should be tested using the **same mechanism** that SEES uses in automation
- Real data from active providers should flow through the normal pipeline

## Key Questions

### Data Elements Concept
The user describes data elements as: "when a directive requires more than one source, we group it so that we also have a strict way of identifying a complete record that is ready for the more advanced directives."

This suggests data elements are prerequisite-checking units:
- Each element = the data requirements for a directive to produce valid scores
- "Complete" should mean: this symbol has ALL required data for this element
- Not all elements apply to all symbols (e.g., crypto elements don't apply to stocks)

### Real Data Strategy
1. Use the default watchlist symbols as the test set
2. Only show elements as "Complete" when the actual required data exists in the database
3. Freshness, bar count, and provider status should all be real
4. The testing mechanism should mirror what SEES does in automation

### Scope
- Don't change the view until direction is confirmed
- The current display of elements and their requirements is good
- The issue is the fake "COMPLETE" status and the 163-symbol count

## Next Steps
1. Define which symbols are in the default watchlist
2. Query real MarketBar data to check element prerequisites per symbol
3. Update Data Elements page to show real statuses
4. Remove all hardcoded demo status logic
