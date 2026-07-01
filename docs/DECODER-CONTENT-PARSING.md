# Decoder — Content Parsing & AI Integration

**Created**: 2026-06-30
**Status**: Discussion / Planning
**Page**: `/data/decoder`

---

## Current State
The Decoder page has been created with:
- Textarea input for pasting structured content
- Auto-detection of format (Earnings Whisper, JSON, CSV, Generic)
- Regex-based extraction of key fields from Earnings Whisper emails
- AI toggle placeholder (not yet functional)

## Sample Format: Earnings Whisper
The Earnings Whisper email format has been pasted as a sample. Key fields extracted include:
- Ticker, company name, report date/time
- Consensus EPS, Whisper EPS, revenue estimate, rev growth
- Investor sentiment, beat expectations %
- Short interest change, price drift, vs 200-day MA
- Option-implied move, avg quarterly move
- Notable options activity (contracts, strike, type)

## Open Questions

### Storage & Usage
- How should parsed earnings data be stored? New `EarningsEvent` table? Extend existing `Symbol`?
- Should parsed data feed into the Events Calendar automatically?
- Should it trigger SEES scoring adjustments (earnings proximity weighting)?

### AI Integration
- The AI toggle exists but needs backend integration
- What AI insights would be most valuable?
  - Beat/miss probability vs historical accuracy
  - Sector peer comparison
  - Option flow interpretation (bullish/bearish)
  - Historical whisper accuracy for this ticker

### Format Support
- Currently only Earnings Whisper has regex patterns
- Should we add: Brokerage Research Reports, SEC Filings summaries, News headlines?
- Pattern library should be extensible

## Next Steps
1. Determine storage model for parsed earnings data
2. Wire AI analysis backend (OpenAI/Claude integration)
3. Add more format parsers as needed
4. Connect parsed data to Events Calendar and SEES pipeline
