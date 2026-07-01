# Q505 — SEES Multi-Protocol Integration

**Type:** Feature — Backend + Frontend  
**Depends on:** Q502 (ProtocolRunner), Q503 (Cache), Q504 (Queue), Q501 (Dashboard)  
**Status:** CLAIM__

## Context

Currently, SEES (Scoring Engine Evaluation System) ranks symbols within a single protocol run. With the Automation subsystem, multiple protocols will score overlapping symbol sets independently. SEES needs to be extended to:

1. Aggregate scores across protocols for the same symbol
2. Show which protocol contributed what score
3. Allow cross-protocol comparison ("symbol X scores 82 on momentum, 45 on mean reversion — best fit is momentum")

This is the "integration layer" between Automation and the existing SEES presentation.

## Steps

### 1. Create MultiProtocolRankingService
- Path: `nest/src/modules/automation/multi-protocol-ranking.service.ts`
- Consumes results from ProtocolRunner (via ExecutionQueue)
- Key method: `rankAcrossProtocols(symbols: string[], results: Map<string, RunResult[]>): CrossProtocolRanking[]`

```typescript
interface CrossProtocolRanking {
  symbol: string;
  protocolScores: { protocolId: string; protocolName: string; score: number; signalClass: string }[];
  bestProtocol: { protocolId: string; score: number };
  averageScore: number;
  scoreSpread: number;  // max - min across protocols
}
```

### 2. API endpoint
- `POST /api/automation/rankings/cross-protocol`
  - Body: `{ symbols: string[] }`
  - Response: `CrossProtocolRanking[]` sorted by bestProtocol.score descending
- This runs protocol scoring for the requested symbols and aggregates

### 3. SEES Dashboard Integration
Add an "Automation" tab to the SEES Rankings page that shows:
- Symbol rows with multi-protocol score columns
- Color-coded cells (green/yellow/red per score)
- Best-fit protocol highlighted
- Click a row to expand: see directive-level breakdown per protocol

### 4. Protocol-to-Symbol Affinity
As a bonus insight, calculate which protocol "owns" which symbol type:
- If NVDA scores consistently highest on momentum → label NVDA as "momentum-leaning"
- Store in DB: `SymbolProtocolAffinity { symbol, protocolId, affinityScore, lastUpdated }`
- Display on symbol detail pages: "Best protocol: Momentum (avg score 78 over 12 runs)"

### 5. Backward compatibility
- Existing SEES single-protocol scoring MUST continue to work unchanged
- Multi-protocol is additive — new endpoints, new UI tab
- The `POST /api/scoring/run` endpoint stays as-is for single-symbol research

## Design Notes

- This is the "why" layer — it answers "which strategy fits this symbol best?"
- The cross-protocol view is the primary value proposition of the Automation system
- Score normalization: protocols may have different maxScore ranges. Normalize to 0-100 before cross-protocol comparison.

## Files to Create/Modify

| File | Action |
|------|--------|
| `nest/src/modules/automation/multi-protocol-ranking.service.ts` | Create |
| `nest/src/modules/automation/automation.controller.ts` | Modify (add ranking endpoints) |
| `nest/src/modules/automation/automation.module.ts` | Modify (register service) |
| `nest/prisma/schema.prisma` | Modify (add SymbolProtocolAffinity model) |
| `src/pages/SEESRankingsPage.jsx` | Modify (add Automation tab) |
