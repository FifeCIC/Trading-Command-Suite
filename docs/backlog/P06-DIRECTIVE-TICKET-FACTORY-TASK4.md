# P06 — Directive Ticket Factory: Task 4 Implementation Plan

> Generated: 2026-06-10 | Target: Task 4 (Five-Directive Scoring Engine)  
> Source: `03-MVP-DIRECTIVE-PACK.md`, `directive.interface.ts`, `scoring.service.ts`

---

## 12 Directive Implementation Tickets

Each ticket targets a single dev session. Order respects dependency chains.

---

### T4-01: Directive Math Utility Library

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Depends On** | — (no dependencies) |
| **Blocks** | T4-02 through T4-06 |
| **Effort** | 1 session |

**Scope:** Build shared math utilities all 5 directives will consume. The `IDirective` contract requires directives be stateless and pure — these utilities enable that without duplication.

**Acceptance Criteria:**
- [ ] `computeRSI(bars: MarketBar[], period: number): number` — Wilder's smoothing, returns 0–100
- [ ] `computeEMA(bars: MarketBar[], period: number): number[]` — returns EMA series same length as input
- [ ] `computeMACD(bars: MarketBar[], fast: number, slow: number, signal: number)` — returns `{ macdLine: number[], signalLine: number[], histogram: number[] }`
- [ ] `computeATR(bars: MarketBar[], period: number): number` — single latest ATR value
- [ ] `computeAverageVolume(bars: MarketBar[], period: number): number`
- [ ] `clamp(value: number, min: number, max: number): number`
- [ ] `linearScale(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number`
- [ ] All functions handle short input (fewer bars than period) gracefully: return neutral/0, don't throw
- [ ] Unit test: RSI=50 for flat prices, EMA warmup period, MACD zero-cross detection, ATR with known range

**Files to create:**
- `nest/src/modules/directives/utils/math.utils.ts`
- `nest/src/modules/directives/utils/math.utils.spec.ts`

---

### T4-02: RSI Oversold Reversion Directive

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Depends On** | T4-01 (math utils) |
| **Blocks** | T4-07 (registration) |
| **Effort** | 1 session |

**Scope:** Implement `RsiOversoldDirective` per `03-MVP-DIRECTIVE-PACK.md` Directive 1. RSI(14) below threshold and curling up signals bullish mean reversion.

**Acceptance Criteria:**
- [ ] Implements `IDirective` with `id: 'rsi-oversold'`
- [ ] `calculate(input)` returns `{ score, confidence, reason }`
- [ ] Score logic:
  - RSI(14) ≤ 30: base score 70, scaling up as RSI drops to 20 (max 90)
  - RSI curling up (current > previous): +10 score boost
  - RSI 30–35 exiting oversold: score 50–70 (transition zone)
  - RSI > 35: score descends toward 30 (no oversold signal)
- [ ] Confidence: `1.0 - (RSI_distance_from_30 / 50)` clamped 0.3–0.95
- [ ] Reason includes: RSI value, direction ("curling up"/"still falling"/"neutral"), threshold status
- [ ] Short input (< 14 bars): returns `{ score: 0, confidence: 0, reason: "Insufficient data: need 14+ bars" }`
- [ ] Unit test fixtures below

**Files to create:**
- `nest/src/modules/directives/implementations/rsi-oversold.directive.ts`
- `nest/src/modules/directives/implementations/rsi-oversold.directive.spec.ts`

---

### T4-03: MACD Bullish Crossover Directive

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Depends On** | T4-01 (math utils) |
| **Blocks** | T4-07 (registration) |
| **Effort** | 1 session |

**Scope:** Implement `MacdCrossoverDirective` per Directive 2. MACD line crossing above signal line with improving histogram confirms trend momentum shift.

**Acceptance Criteria:**
- [ ] Implements `IDirective` with `id: 'macd-crossover'`
- [ ] Uses default periods: fast=12, slow=26, signal=9
- [ ] Score logic:
  - Crossover detected (MACD crosses above signal in last 3 bars): base score 75
  - Histogram improving (current > previous): +10 boost
  - Histogram positive AND improving: additional +5 boost
  - MACD line below zero during cross: -15 penalty (counter-trend)
  - No crossover: score descends to 30 based on MACD-signal distance
- [ ] Confidence: based on crossover recency and histogram strength, 0.3–0.9
- [ ] Reason includes: crossover detected (yes/no), histogram direction, trend context
- [ ] Short input (< 26 bars): graceful degradation with shorter periods
- [ ] Unit test fixtures below

**Files to create:**
- `nest/src/modules/directives/implementations/macd-crossover.directive.ts`
- `nest/src/modules/directives/implementations/macd-crossover.directive.spec.ts`

---

### T4-04: Price Above EMA Structure Directive

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Depends On** | T4-01 (math utils) |
| **Blocks** | T4-07 (registration) |
| **Effort** | 1 session |

**Scope:** Implement `EmaStructureDirective` per Directive 3. Price above EMA20 and EMA20 above EMA50 signals bullish trend alignment.

**Acceptance Criteria:**
- [ ] Implements `IDirective` with `id: 'ema-structure'`
- [ ] Score logic:
  - Price > EMA20 > EMA50 (perfect alignment): score 85
  - Price > EMA20 but EMA20 ≤ EMA50: score 65 (bullish but weak structure)
  - Price ≤ EMA20 but EMA20 > EMA50: score 45 (pullback in uptrend)
  - Price ≤ EMA20 ≤ EMA50: score 25 (bearish alignment)
- [ ] Price distance from EMA20 as percentage: modulates score ±10
- [ ] Trend duration bonus: if EMA20 > EMA50 for 5+ consecutive bars, +5 score
- [ ] Confidence: based on EMA separation ratio, 0.4–0.9
- [ ] Reason includes: alignment label ("bullish aligned"/"bullish weak"/"pullback"/"bearish"), EMA values, separation %
- [ ] Short input (< 50 bars): uses available bars, confidence reduced proportionally
- [ ] Unit test fixtures below

**Files to create:**
- `nest/src/modules/directives/implementations/ema-structure.directive.ts`
- `nest/src/modules/directives/implementations/ema-structure.directive.spec.ts`

---

### T4-05: ATR Normalized Dip Directive

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Depends On** | T4-01 (math utils) |
| **Blocks** | T4-07 (registration) |
| **Effort** | 1 session |

**Scope:** Implement `AtrDipDirective` per Directive 4. ATR-normalized pullback quality scoring — rewards dips that are significant enough to matter but not breakdown-level.

**Acceptance Criteria:**
- [ ] Implements `IDirective` with `id: 'atr-dip'`
- [ ] ATR(14) computed from input bars
- [ ] Dip detection: recent low relative to 20-bar high, expressed in ATR multiples
- [ ] Score logic:
  - Dip 0.5–1.5 ATR: optimal buy zone, score 75–90 (scaled linearly)
  - Dip 0–0.5 ATR: shallow, score 45–65 (not enough discount)
  - Dip 1.5–2.5 ATR: deep, score 40–60 (caution: may be breakdown, not dip)
  - Dip > 2.5 ATR: score 20–35 (likely breakdown, not a dip)
- [ ] Recovery signal bonus: if last bar closed above its midpoint, +8 score
- [ ] Confidence: 0.3 when dip is extreme, 0.85 in optimal zone, scaled
- [ ] Reason includes: dip size in ATR terms, zone label ("optimal"/"shallow"/"deep"/"breakdown"), recovery flag
- [ ] Short input (< 20 bars): reduced confidence
- [ ] Unit test fixtures below

**Files to create:**
- `nest/src/modules/directives/implementations/atr-dip.directive.ts`
- `nest/src/modules/directives/implementations/atr-dip.directive.spec.ts`

---

### T4-06: Volume Confirmation Directive

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Depends On** | T4-01 (math utils) |
| **Blocks** | T4-07 (registration) |
| **Effort** | 1 session |

**Scope:** Implement `VolumeConfirmationDirective` per Directive 5. Bullish setups score higher when recent volume supports the move — filters weak, low-participation entries.

**Acceptance Criteria:**
- [ ] Implements `IDirective` with `id: 'volume-confirmation'`
- [ ] Compares recent volume (3-bar avg) to baseline (20-bar avg)
- [ ] Score logic:
  - Volume ratio ≥ 1.5 (strong participation): score 85
  - Volume ratio 1.0–1.5 (normal participation): score 60–85 (linear scale)
  - Volume ratio 0.7–1.0 (below average): score 40–60
  - Volume ratio < 0.7 (weak participation): score 20–40
- [ ] Price-volume alignment check: if price up AND volume up (bullish confirmation), +10 score
- [ ] If price up but volume down (divergence): -15 score penalty
- [ ] Confidence: based on how many recent bars exceed baseline, 0.3–0.85
- [ ] Reason includes: volume ratio, participation label, price-volume alignment
- [ ] Short input (< 20 bars): uses available bars, confidence floor 0.25
- [ ] Unit test fixtures below

**Files to create:**
- `nest/src/modules/directives/implementations/volume-confirmation.directive.ts`
- `nest/src/modules/directives/implementations/volume-confirmation.directive.spec.ts`

---

### T4-07: Directive Registration & Module Wiring

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Depends On** | T4-02 through T4-06 (all directives implemented) |
| **Blocks** | T4-08 (aggregation), T4-10 (scoring pipeline) |
| **Effort** | 1 session |

**Scope:** Register all 5 directives into the `DirectivesService` registry and wire the NestJS module so they're available at runtime. Seed directive metadata into the database `Directive` model.

**Acceptance Criteria:**
- [ ] `DirectivesModule` imports all 5 directive classes and registers them via `OnModuleInit`
- [ ] Each directive registered with `DirectivesService.register()` at module init
- [ ] `DirectivesService.list()` returns all 5 directives with their `id`, `name`, `description`
- [ ] `DirectivesService.get(id)` returns a single directive by id
- [ ] Database `Directive` table seeded with all 5 directives including MVP pack metadata:
  - `id`, `code`, `name`, `category`, `status: 'active'`, `baseWeight`
- [ ] Seed respects existing entries — uses `upsert` to avoid duplicates
- [ ] `GET /api/directives` returns all registered directives with metadata
- [ ] Integration test: module loads, all directives resolve from registry

**Files to create/modify:**
- `nest/src/modules/directives/directives.module.ts` (update)
- `nest/src/modules/directives/directives.controller.ts` (create if missing)
- `nest/prisma/seed.ts` (update with directive seed data)
- `nest/src/modules/directives/directives.module.spec.ts`

---

### T4-08: Directive Aggregation & Weighting Service

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Depends On** | T4-07 (directives registered) |
| **Blocks** | T4-10 (scoring pipeline) |
| **Effort** | 1 session |

**Scope:** Build the aggregation layer that runs all directives and combines results into a weighted composite score. The MVP strategy is "Conviction Dip Accumulation" — a soft long-only profile.

**Acceptance Criteria:**
- [ ] `DirectivesService.runAll(input)` executes all registered directives against the same `DirectiveInput`
- [ ] Returns `Map<string, DirectiveResult>` — one result per directive
- [ ] Errors in one directive do not abort others (try/catch per directive)
- [ ] Failed directive returns `{ score: 0, confidence: 0, reason: "Error: <message>" }`
- [ ] Default MVP weights (configurable):
  - RSI Oversold: 0.24
  - MACD Crossover: 0.22
  - EMA Structure: 0.20
  - ATR Dip: 0.18
  - Volume Confirmation: 0.16
- [ ] Aggregate score = `Σ(directive.score × weight)` — produces 0–100
- [ ] Aggregate confidence = weighted average of individual confidences
- [ ] Result includes per-directive breakdown: `{ id, name, score, weight, contribution, confidence, reason }`
- [ ] Unit test: all directives, single directive, erroring directive, empty registry

**Files to modify:**
- `nest/src/modules/directives/directives.service.ts` (implement `runAll` + aggregation)
- `nest/src/modules/directives/directives.service.spec.ts`

---

### T4-09: Scoring Configuration & Thresholds

| Field | Value |
|---|---|
| **Priority** | should-have |
| **Depends On** | T4-07 (directives registered) |
| **Blocks** | — (parallel with T4-08) |
| **Effort** | 1 session |

**Scope:** Make directive thresholds and strategy weights configurable rather than hardcoded. Store in database `Directive` model, load at runtime. This enables the Algorithm Lab (Phase 1.2) to tune parameters.

**Acceptance Criteria:**
- [ ] `Directive` Prisma model includes: `thresholds` (JSON), `weight` (Float), `config` (JSON)
- [ ] `DirectivesService` loads config from database on init, falls back to defaults
- [ ] `GET /api/directives/:id/config` returns current config with defaults annotated
- [ ] `PATCH /api/directives/:id/config` updates thresholds/weights, validates ranges
- [ ] Threshold validation: RSI oversold range 20–40, MACD periods 5–50, ATR period 5–30, volume period 5–50
- [ ] Weight validation: each weight 0.0–1.0, all weights sum to ≤ 1.0
- [ ] Config changes take effect on next `calculate()` call (no restart needed)
- [ ] Unit test: valid config update, invalid threshold rejected, weight sum validation

**Files to create/modify:**
- `nest/prisma/schema.prisma` (add fields to Directive model)
- `nest/src/modules/directives/dto/update-directive-config.dto.ts`
- `nest/src/modules/directives/directives.controller.ts` (add config endpoints)
- `nest/src/modules/directives/directives.service.ts` (load config)

---

### T4-10: Scoring Pipeline — Directives → Ranked Output

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Depends On** | T4-07, T4-08 |
| **Blocks** | T4-11 (API endpoint) |
| **Effort** | 1 session |

**Scope:** Replace the deterministic ticker-hash placeholder in `ScoringService.rankAll()` with real directive execution. The pipeline: fetch symbols → build `DirectiveInput` from market data → run directives → aggregate → rank.

**Acceptance Criteria:**
- [ ] `rankAll(strategyId?, limit)` fetches active symbols from DB
- [ ] For each symbol, builds `DirectiveInput` with `MarketBar[]` from market-data service
- [ ] Runs `DirectivesService.runAll(input)` for each symbol
- [ ] Aggregates per T4-08 weights into composite score
- [ ] Returns `RankedResult` with `ranked[]` sorted by score descending
- [ ] Each ranked entry includes: `symbolId, ticker, name, score, confidence, signal, freshness, directives (breakdown)`
- [ ] Signal classification: score ≥ 70 → "entry", ≥ 50 → "watch", < 50 → "defensive"
- [ ] When market bars unavailable (fallback mode): falls back to deterministic scoring with `freshness: 'deterministic'`
- [ ] When market bars are stale: uses stale data with `freshness: 'stale'` flag, confidence reduced
- [ ] Timeframe guidance included per `03-MVP-DIRECTIVE-PACK.md` requirement:
  - Signal horizon label: "short swing", "multi-day", or "position"
  - Data timeframe used for each directive
  - Warning when timeframe mismatch risk is high

**Files to modify:**
- `nest/src/modules/scoring/scoring.service.ts`
- `nest/src/modules/scoring/scoring.service.spec.ts`

---

### T4-11: SEES Ranked API Endpoint

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Depends On** | T4-10 (scoring pipeline) |
| **Blocks** | T4-12 (UI integration) |
| **Effort** | 1 session |

**Scope:** Complete the `ScoringController` with the ranked endpoint and add a per-symbol breakdown endpoint for UI drill-down.

**Acceptance Criteria:**
- [ ] `GET /api/scoring/ranked?strategy_id=mvp-conviction-dip&limit=20` returns ranked payload
- [ ] `GET /api/scoring/ranked/:ticker/breakdown` returns per-directive score decomposition
- [ ] Response DTO matches `RankedResult` interface shape with full directive breakdown per symbol
- [ ] `mode` and `services` metadata included in every response
- [ ] Swagger `@ApiOperation` and `@ApiOkResponse` decorators on both endpoints
- [ ] 400 on invalid `strategy_id`, 404 on unknown ticker for breakdown
- [ ] `limit` clamped to [1, 100]
- [ ] Rate limit: 30 req/min per IP (scoring is compute-heavy)
- [ ] Integration test: HTTP GET → controller → service → directives → response

**Files to modify:**
- `nest/src/modules/scoring/scoring.controller.ts`
- `nest/src/modules/scoring/dto/ranked-symbols.dto.ts` (create)

---

### T4-12: End-to-End Integration Test Suite

| Field | Value |
|---|---|
| **Priority** | should-have |
| **Depends On** | T4-07 through T4-11 |
| **Blocks** | — (validates all prior tickets) |
| **Effort** | 1 session |

**Scope:** Integration test that exercises the full pipeline: directive registration → market data fetch (mocked) → directive execution → aggregation → ranking → API response.

**Acceptance Criteria:**
- [ ] E2E test: Nest test module with all directives registered
- [ ] Mock `MarketDataService` returns known OHLCV bars for a test symbol
- [ ] `ScoringService.rankAll()` returns ranked results with real directive scores (not deterministic)
- [ ] Verify RSI directive fires when mock data includes oversold condition
- [ ] Verify MACD directive fires when mock data includes crossover
- [ ] Verify EMA directive reports correct alignment
- [ ] Verify ATR directive scores dips correctly
- [ ] Verify Volume directive scores participation correctly
- [ ] Aggregate score is within expected range for known input
- [ ] `GET /api/scoring/ranked` returns HTTP 200 with valid JSON matching DTO
- [ ] `GET /api/scoring/ranked/TEST/breakdown` returns per-directive detail
- [ ] Test: empty symbol set → empty ranked array, no errors
- [ ] Test: single symbol with insufficient bars → low confidence, reason explains

**Files to create:**
- `nest/test/scoring-pipeline.e2e-spec.ts`

---

## Test Fixture Matrix Per Directive

### T4-02: RSI Oversold Reversion

| Fixture ID | Type | Bars Profile | RSI(14) | Direction | Expected Score | Expected Confidence |
|---|---|---|---|---|---|---|
| rsi-happy-01 | Happy | 20 bars, steady downtrend then leveling | 24, curling to 26 | Curling up | 80–90 | 0.80–0.90 |
| rsi-happy-02 | Happy | 20 bars, V-bottom recovery | 28→32 | Crossing up out of oversold | 70–80 | 0.75–0.85 |
| rsi-edge-01 | Edge | Exactly 14 bars, flat prices | 50 | Flat | 30–40 | 0.55–0.65 |
| rsi-edge-02 | Edge | 20 bars, RSI exactly at 30 | 30 | Flat | 65–75 | 0.70–0.80 |
| rsi-fail-01 | Failure | 5 bars (insufficient) | N/A | N/A | 0 | 0 |
| rsi-fail-02 | Failure | 20 bars, strong uptrend | 72 | Curling down | 20–30 | 0.30–0.40 |

### T4-03: MACD Bullish Crossover

| Fixture ID | Type | Bars Profile | Crossover | Histogram | Expected Score | Expected Confidence |
|---|---|---|---|---|---|---|
| macd-happy-01 | Happy | 35 bars, downtrend reversing | Yes (bar 33) | Improving, positive | 85–95 | 0.80–0.90 |
| macd-happy-02 | Happy | 35 bars, consolidation breakout | Yes (bar 34) | Improving, crossing zero | 75–85 | 0.75–0.85 |
| macd-edge-01 | Edge | 35 bars, crossover at exactly signal line | Yes (zero delta) | Flat | 70–80 | 0.65–0.75 |
| macd-edge-02 | Edge | 26 bars (minimum warmup) | Yes (bar 25) | Positive | 75–85 | 0.70–0.80 |
| macd-fail-01 | Failure | 35 bars, sustained downtrend | No | Negative, worsening | 25–35 | 0.30–0.45 |
| macd-fail-02 | Failure | 10 bars (insufficient) | N/A | N/A | 0–30 | 0–0.30 |

### T4-04: EMA Structure

| Fixture ID | Type | Bars Profile | Alignment | Expected Score | Expected Confidence |
|---|---|---|---|---|---|
| ema-happy-01 | Happy | 60 bars, steady uptrend | Price > EMA20 > EMA50 | 80–90 | 0.80–0.90 |
| ema-happy-02 | Happy | 60 bars, trend with EMA20/50 wide separation | Price > EMA20 > EMA50 (wide) | 85–95 | 0.85–0.95 |
| ema-edge-01 | Edge | 60 bars, EMA20 ≈ EMA50 (just crossed) | Price > EMA20 ≈ EMA50 | 60–70 | 0.55–0.70 |
| ema-edge-02 | Edge | 60 bars, price riding EMA20 | Price ≈ EMA20 > EMA50 | 55–70 | 0.50–0.65 |
| ema-fail-01 | Failure | 60 bars, sustained downtrend | Price < EMA20 < EMA50 | 20–30 | 0.40–0.55 |
| ema-fail-02 | Failure | 30 bars (reduced warmup) | Price > EMA20 > EMA50 | 70–85 | 0.55–0.70 |

### T4-05: ATR Normalized Dip

| Fixture ID | Type | Bars Profile | Dip (ATR) | Recovery | Expected Score | Expected Confidence |
|---|---|---|---|---|---|---|
| atr-happy-01 | Happy | 25 bars, 1.0 ATR pullback in uptrend | 1.0 | Yes (close > mid) | 80–90 | 0.80–0.90 |
| atr-happy-02 | Happy | 25 bars, 0.7 ATR shallow dip + recovery | 0.7 | Yes | 70–80 | 0.75–0.85 |
| atr-edge-01 | Edge | 25 bars, 1.5 ATR (boundary of optimal) | 1.5 | Yes | 70–80 | 0.65–0.75 |
| atr-edge-02 | Edge | 25 bars, 0.4 ATR (very shallow) | 0.4 | No | 45–55 | 0.50–0.60 |
| atr-fail-01 | Failure | 25 bars, 3.0 ATR plunge (breakdown) | 3.0 | No | 15–25 | 0.25–0.35 |
| atr-fail-02 | Failure | 10 bars (insufficient) | N/A | N/A | 0–30 | 0–0.30 |

### T4-06: Volume Confirmation

| Fixture ID | Type | Bars Profile | Vol Ratio | Alignment | Expected Score | Expected Confidence |
|---|---|---|---|---|---|---|
| vol-happy-01 | Happy | 25 bars, volume spike on up day | 1.8 | Bullish (price↑, vol↑) | 85–95 | 0.80–0.90 |
| vol-happy-02 | Happy | 25 bars, sustained above-average volume | 1.3 | Bullish | 70–80 | 0.70–0.80 |
| vol-edge-01 | Edge | 25 bars, volume exactly at baseline | 1.0 | Neutral | 55–65 | 0.55–0.65 |
| vol-edge-02 | Edge | 25 bars, price up but volume down (divergence) | 0.6 | Bearish divergence | 25–35 | 0.35–0.45 |
| vol-fail-01 | Failure | 25 bars, very low volume on up move | 0.4 | Weak | 15–25 | 0.25–0.35 |
| vol-fail-02 | Failure | 10 bars (insufficient) | N/A | N/A | 0–30 | 0–0.25 |

---

## Dependency Graph

```
T4-01 (Math Utils)
 ├── T4-02 (RSI Oversold)
 ├── T4-03 (MACD Crossover)
 ├── T4-04 (EMA Structure)
 ├── T4-05 (ATR Dip)
 └── T4-06 (Volume Confirmation)
       │
       └── T4-07 (Registration & Module Wiring)
             ├── T4-08 (Aggregation & Weighting)
             │     └── T4-10 (Scoring Pipeline)
             │           └── T4-11 (Ranked API Endpoint)
             │                 └── T4-12 (E2E Test Suite)
             └── T4-09 (Config & Thresholds — parallel)
```

---

## Priority Labels

| Label | Tickets | Rationale |
|---|---|---|
| **must-have** | T4-01, T4-02, T4-03, T4-04, T4-05, T4-06, T4-07, T4-08, T4-10, T4-11 | Core directive engine — Task 4 is P0 for MVP |
| **should-have** | T4-09, T4-12 | Configurability and E2E tests enhance quality but don't block first scoring run |

---

## Blocking Conditions

| Blocker | Affects | Resolution |
|---|---|---|
| `DirectiveInput` only has `bars` — no support for multi-timeframe data | T4-02–T4-06 | MVP runs on single timeframe; multi-timeframe is a follow-on task |
| `MarketDataService` / `FreshnessService` must provide `MarketBar[]` for live symbols | T4-10 | Fallback: use deterministic scoring when bars unavailable (already implemented) |
| `StrategiesService` placeholder — strategy weights needed for aggregation | T4-08 | Hardcode MVP weights in T4-08; T4-09 makes them configurable |
| Database `Directive` model needs `thresholds` JSON field for T4-09 | T4-09 | Add in T4-09's Prisma migration |
