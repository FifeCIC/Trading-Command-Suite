# Discussion: Profit-Taking & Exit Signal System

## Core Question
SEES is heavily focused on entry signals. What about exits? When should a trader take profit?

## Current Gap
- Directives primarily score bullish/bearish bias for ENTRY
- No directive explicitly says "exit now"
- No directive tracks "profit quality" — is this profit worth taking or letting run?

## Proposed Exit Signal Types

### 1. Momentum Exhaustion
- RSI crosses above 70 (overbought — consider taking profit)
- Volume declining while price rising (divergence — momentum fading)
- MACD histogram shrinking (trend weakening)
- These ALREADY EXIST as directives — they just need an "exit mode"

### 2. Target Achievement
- Price reaches measured move target (from pattern directives)
- Price reaches ATR-based target (1.5x ATR from entry = take half)
- Price reaches round number / psychological level

### 3. Regime Shift
- Market entropy suddenly spikes (structure breaking)
- Hurst exponent crosses below 0.5 (trend ending)
- Session ending + position still open

### 4. Portfolio-Level Exits
- Total position exposure exceeds threshold
- Daily P&L target reached
- Correlation between positions spikes (concentrated risk)

## Implementation Approach

### Option A: "Exit Score" Column in SEES
Alongside entry score, show exit urgency:
```
Symbol  Entry Score  Exit Urgency  Action
NVDA    82           LOW           Hold / Add
EURUSD  65           HIGH          Consider taking profit
XAUUSD  58           MEDIUM        Tighten stop
```

### Option B: Separate Exit Directive Category
New directive category: `exit-timing`
- `momentum-exhaustion`: score 0-100 urgency to exit
- `target-achieved`: binary — is price at target?
- `regime-shift`: binary — has regime changed against position?
- `time-stop`: position age exceeds optimal hold period

### Option C: Dual-Mode Directives
Existing directives get an optional `calculateExit()` method:
- Same directive, different perspective
- `rsi-oversold.calculate()` → bullish entry score
- `rsi-oversold.calculateExit()` → "RSI no longer oversold — exit signal"

## Recommendation
Start with Option A (simplest) — add an "Exit Urgency" column to SEES. Build 3 exit-focused directives. If the concept proves valuable, expand to Option C.

## Open Questions
1. Should exit signals trigger automatic position closure?
   → No initially. Informational only with manual confirmation.
2. How does exit scoring interact with stop-loss management?
   → Exit urgency can suggest "tighten SL to breakeven" vs "close now"
3. Should exits be strategy-specific? (Day trading exits differ from position trading)
   → Yes. Strategy configuration should include exit rules.

## Related
- SPEED-TRADING-SAFETY.md (Risk Timer for speed trading)
- Q136: Risk Management (existing SL/TP infrastructure)
- PREDICTIVE-SEES.md (future-state scoring)
