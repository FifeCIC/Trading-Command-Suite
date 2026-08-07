## Problem

The Directive Impact Audit page (`/protocols/directive-impact-audit`) shows ALL directives for an entered symbol — including directives that have no relevance to that symbol. This clutters the audit table with noise.

Example: entering `EURUSD` still shows "VIX Regime" and "Oil Supply/Demand" directives with scores, when those directives only make sense for VIX and oil symbols respectively.

## Current behavior

- User types a symbol in `input.dia-input`
- All 100+ directives are evaluated and displayed
- No filtering or deprioritization based on symbol relevance

## Proposed

### Relevance classification

Directives should declare `applicableSymbols` — either as:
- A list of regex patterns (`["XAU", "XAG"]` for metals directives)
- An asset class tag (`forex`, `indices`, `commodities`, `crypto`, `stocks`)
- A specific symbol list (`["VIX", "VIX-F"]` for VIX-only directives)

If no constraints are declared, the directive applies to all symbols (current behavior).

### UI behavior

When a symbol is entered:

1. **Matching directives** — display normally at top of table, full color
2. **Non-matching directives** — greyed out row, pushed to bottom, show muted opacity
3. **Add a toggle** `[x] Show irrelevant` to optionally show/hide non-matching rows
4. **Count indicator** — header shows "N relevant / M total directives"

### Examples

| Symbol entered | VIX Regime | Oil Supply | Forex Session | Gold Speed |
|---------------|-----------|------------|---------------|------------|
| EURUSD | No greyed | No greyed | Yes matches | No greyed |
| XAUUSD | No greyed | No greyed | No greyed | Yes matches |
| VIX | Yes matches | No greyed | No greyed | No greyed |
| US500 | No greyed | No greyed | No greyed | No greyed |

## Scope

- [ ] Add `applicableSymbols` or `assetClass` metadata field to directive definitions
- [ ] Backfill existing 35+ directives with relevant constraints
- [ ] Update Directive Impact Audit endpoint to accept symbol parameter
- [ ] Update `DirectiveImpactAudit` component to filter/sort by relevance
- [ ] Add "Show irrelevant" toggle
- [ ] Add N/M count indicator in table header

## Priority

Phase 3 — improves audit workflow but not blocking trading.

## Related

- #537 Surface single/dual protocol state
- #446 META.Stack Pipeline Audit
