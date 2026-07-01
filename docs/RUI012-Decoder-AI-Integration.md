# RUI012 — Decoder AI Integration & Storage Model

**Agent:** tcs-dev
**Area:** Data / Research
**Priority:** P2 — backend wiring needed
**Depends on:** DecoderPage.jsx (created), /api/directives

## Current State

`DecoderPage.jsx` exists with:
- Textarea input + auto-detection (Earnings Whisper, JSON, CSV, Generic)
- Regex extraction of 17 fields from Earnings Whisper emails
- AI toggle placeholder (not functional)

## Task

### Phase 1: Storage Model
- Determine how parsed earnings data is stored
- Options: new `EarningsEvent` Prisma model, extend `Symbol`, or store as JSON in existing table
- Should parsed data auto-feed Events Calendar?

### Phase 2: AI Backend
- Wire the AI toggle to a backend endpoint (`POST /api/decoder/analyze`)
- Integrate OpenAI/Claude for:
  - Beat/miss probability vs historical accuracy
  - Sector peer comparison
  - Option flow interpretation (bullish/bearish)
  - Historical whisper accuracy per ticker

### Phase 3: Format Library
- Make pattern library extensible (add new formats via config/plugin)
- Candidate formats: Brokerage Research Reports, SEC Filings summaries, News headlines
- Connect parsed data to SEES pipeline (earnings proximity weighting)

### Sample Data
The Earnings Whisper email format sample has been provided. See discussion file for full sample with 10 companies.
