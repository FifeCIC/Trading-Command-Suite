## Source

`/scoring/signals-workbench`

## Problem — Needs Discussion

The Signals Workbench is unclear about what it's meant to output. Current state:

### What shows:
- **Stats bar:** "1 symbols — Comparing 2 protocols" — implies something is about to happen, but nothing else changes
- **Session log:** Shows scan history with timestamps, protocol names, symbols, avg signals
- **Protocol picker:** Shows "Protocols 2/48 — Select All" with a list of protocol toggles

### Ladder mode:
- Ladder tab is selected but no ladder/ranking output appears

### Compare mode:
- Shows a comparison table: "Symbol | Gold Swing 1H | Gold Speed Scalp V1 | XAUUSD | 8HOLD | 8HOLD"

## Questions to resolve:
1. What is this view's primary purpose — protocol comparison? Signal exploration? Scan history?
2. Should the Ladder tab show a real-time ranking when protocols are selected?
3. Is the Compare table functioning correctly (showing HOLD for everything)?
4. Should there be a results/output panel that updates when protocols/symbols are selected?

## Expected

Discussion + clarification of purpose, then fix the view to fulfil that purpose.
