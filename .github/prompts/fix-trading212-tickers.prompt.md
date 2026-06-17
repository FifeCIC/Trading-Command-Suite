---
description: "Fix Trading212 ticker decoding — normalize instrument codes like 3LNVl_EQ, AIRp_EQ, 8XPd_EQ to standard symbols. Use when: portfolio imports show unknown tickers, Trading212 codes need mapping, ticker normalization is broken."
argument-hint: "List of tickers to decode..."
---
Fix the Trading212 ticker normalization pipeline to properly decode instrument codes.

## Problem
Trading212 returns tickers with suffixes and modifier characters:

| Raw Ticker | Current `stripTicker` Result | Actual Symbol | Issue |
|------------|------------------------------|---------------|-------|
| `NVDA_US_EQ` | `NVDA` | **NVDA** ✅ | Works |
| `MSTR_US_EQ` | `MSTR` | **MSTR** ✅ | Works |
| `3LNVl_EQ` | `3LNVl` | **3LNV** (3x Long NVDA ETP) | `l` = long modifier |
| `3NVDl_EQ` | `3NVDl` | **3NVD** (3x NVDA) | `l` = long modifier |
| `AIRp_EQ` | `AIRp` | **AIR** (Airbus, Paris) | `p` = Paris exchange |
| `8XPd_EQ` | `8XPd` | **8XPD**? | `d` modifier |
| `R3NKd_EQ` | `R3NKd` | **R3NKD**? | `d` modifier |
| `EEEl_EQ` | `EEEl` | **EEE**? | `l` = long modifier |

## Root Cause
- `portfolio.service.ts` `stripTicker()`: splits on `_` — keeps trailing modifier char
- `trading212-import.service.ts` `cleanTicker`: only strips `_US_EQ` and `_EQ` suffixes
- No mapping table exists for Trading212 instrument codes → standard symbols

## What to Implement

### 1. Create Ticker Mapping Table
Create `nest/src/modules/providers/t212-ticker-map.ts`:

```typescript
// Known Trading212 modifier suffixes and their meanings
export const T212_SUFFIX_MAP: Record<string, { strip: string; meaning: string }> = {
  'l': { strip: 'l', meaning: 'Long (leveraged)' },
  'd': { strip: 'd', meaning: 'Unknown modifier' },
  'p': { strip: 'p', meaning: 'Paris/Euronext exchange' },
};

// Explicit overrides for known instruments
export const T212_TICKER_OVERRIDES: Record<string, string> = {
  '3LNVl': '3LNV',  // 3x Long NVDA
  '3NVDl': '3NVD',  // 3x NVDA (GraniteShares)
  'AIRp': 'AIR',    // Airbus (Paris)
  // Add more as discovered
};

export function normalizeT212Ticker(rawTicker: string): { symbol: string; exchange: string; modifier?: string } {
  // 1. Split off exchange suffix (_US_EQ, _EQ, etc.)
  // 2. Check overrides table
  // 3. Apply suffix stripping rules
  // 4. Return clean symbol + metadata
}
```

### 2. Update All Ticker Processing Points
- `trading212.adapter.ts` `getPositions()` — normalize tickers at fetch time
- `portfolio.service.ts` `stripTicker()` — use the new normalizer
- `trading212-import.service.ts` `importPortfolio()` — use the new normalizer

### 3. Store Raw + Clean Ticker
When importing positions, store both:
- `rawTicker`: The original Trading212 code (for debugging)
- `cleanSymbol`: The normalized standard symbol (for cross-referencing)

### 4. Add Admin UI
Add a ticker mapping admin section to Settings or Admin that shows:
- All encountered raw tickers
- Their normalized forms
- Any unmapped tickers (flag for manual review)

## Related Files
- `nest/src/modules/portfolio/portfolio.service.ts` — `stripTicker()`
- `nest/src/modules/portfolio/trading212-import.service.ts` — `importPortfolio()`
- `nest/src/modules/providers/adapters/trading212.adapter.ts` — `getPositions()`
