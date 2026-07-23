# Handoff: Speed Scanner Protocol ID + Pattern Detection (#459)

**Date:** 2026-07-22
**Issue:** [#459](https://github.com/FifeCIC/Trading-Command-Suite/issues/459)
**Files changed:**
- `nest/src/modules/scoring/speed-scan.service.ts` — protocol resolution fix + pattern detection
- `src/pages/SpeedScannerPage.jsx` — inactive protocols filter
- `src/components/ScreenOptions.jsx` — toggle already existed, now wired

## What changed

1. **Protocol ID UUID → slug:** `resolveProtocolForSymbol()` was returning the raw UUID from `symbolProtocolAssignment.protocolId` (FK). Changed `select: { protocolId: true }` to `include: { protocol: { select: { slug: true, active: true } } }`. Now returns human-readable slugs like `cad-sniper-v1` instead of `42f2ec59-...`.

2. **Pattern detection activated:** `MicroTrendDetector.aggregatePatterns()` was never called with real data. Added `detectCandlestickPatterns()` function that identifies doji, hammer, shooting star, engulfing patterns from 20 trend bars (body/range ratio logic). Wired to `analyze(trendBars, detectedPatterns)`.

3. **Inactive protocols filter:** Screen Options toggle (`ss-include-inactive`) already existed. Backend now returns `protocolActive` boolean per symbol in scan results. Frontend filters out `protocolActive === false` rows unless toggle is ON.

## Verification
- Both builds pass (NestJS tsc + Vite)
- Speed Scanner ladder shows protocol slugs (not UUIDs)
- Pattern column populated with detected patterns
