## Source

`/automation/speed-scanner`

## ⚠️ This is a discussion-heavy issue. The Speed Scanner is described as "the meeting point for all data and outcomes of calculations" — a critical view. Changes should be cautious.

## Issues to Discuss & Resolve

### 1. Info icon missing
The page title is missing the ℹ information icon. The subtitle has a dynamic value that may be interfering.

### 2. Purpose & terminology
The subtitle says "trade/pause recommendations" — what's the right framing? Suggested term: **"signal generator"**. There may be 2-3 approaches to providing signals; they should share terminology.

### 3. Protocol vs Scoring Strategy confusion
Cards show protocol names like "forex-session-v1" but not the scoring strategy that passed them. Is this view showing ALL scored symbols or only signals (passed by scoring strategy)?

Cards should indicate both protocol AND scoring strategy for clarity:
```html
<div class="ss-row">
  #5  GBPUSD  forex-session-v1  HOLD  weak ↑  ADX 23.44  consecutive up...
</div>
```

### 4. Scoring Strategy management
There may not be a list view for managing scoring strategies in the Scoring area. Investigate and create one if missing.

### 5. Signal labels
Current labels show conflicts:
- All entries show "HOLD"
- Some show "BEARISH" pattern
- Most show "caution" recommendation
- A few show "pause"

Discussion needed on the rating/bracketing system:
- BUY/HOLD/SELL?
- STRONG BUY, BUY, HOLD, SELL, STRONG SELL?
- How are these decisions made? Is there an algorithm for each label?

### 6. Score display
Scores appear percentage-based (e.g., "15.8"). Is there a full/raw score available?

### 7. Candle pattern accuracy
The view identifies candle patterns — how accurate is this? Is "NEUTRAL"/"BEARISH" based only on candles or everything?

### 8. A/B testing potential
This could be a prime view for A/B testing. The hidden decision-making could be broken into modules to see each step and value.

### 9. Filtering
- Option to include protocols not used by a scoring strategy?
- Limit on number of scored symbols? (currently shows 19)
- Should be configurable

## Expected

1. **Discuss first** — don't rush into changes
2. Design the signal labeling/bracketing system
3. Clarify protocol vs scoring strategy display
4. Make the view strict with scoring strategies, but offer option to include unassigned protocols
