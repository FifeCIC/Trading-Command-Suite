# SEES Directives, Scoring & Execution Handoff — Structured Backlog

> Generated: 2026-06-10 | Source files: `sees-engine.js`, `directives-manager.seed.js`, `skeleton-rollout.js`, `skeleton-handoff.js`

---

## 1. Directive Implementation Tickets (12)

Each ticket is scoped for a single focused dev session. Dependencies and blocking conditions are listed inline.

---

### D-TICKET-01: Directive Registry Bootstrap

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Phase** | Phase 1 |
| **Depends On** | `DirectivesService` (Nest) exists as placeholder |
| **Blocks** | D-TICKET-02 through D-TICKET-07 |
| **Estimated Effort** | 1 dev session |

**Scope:** Transform the `DirectivesService` from placeholder to a fully operational registry. Implement auto-registration via NestJS `@Injectable()` decorators so each directive implementation is discovered at module init without manual wiring.

**Acceptance Criteria:**
- [ ] `DirectivesService.register()` deduplicates by directive `id` and logs overwrites at WARN level
- [ ] `DirectivesService.list()` returns all registered directives sorted by category
- [ ] `DirectivesService.runAll(input)` executes all directives and returns `Map<string, DirectiveResult>`
- [ ] Errors in one directive do not abort the run — remaining directives still execute
- [ ] Unit test covers: empty registry, single directive, error-throwing directive, duplicate registration

---

### D-TICKET-02: MACD Bullish Crossover Directive (d01)

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Phase** | Phase 1 |
| **Depends On** | D-TICKET-01 |
| **Blocks** | strategy scoring pipeline |
| **Estimated Effort** | 1 dev session |

**Scope:** Implement `MacdBullCrossDirective` implementing `IDirective`. Source: `directives-manager.seed.js` directive `d01`. Category: Momentum.

**Acceptance Criteria:**
- [ ] `calculate(input)` returns `{ score, confidence, reason, evidence }` per `IDirective` contract
- [ ] Crossover detection: MACD line crosses above signal line within last N candles
- [ ] Slope bonus: histogram slope > 0 adds additive boost (up to `baseWeight * 0.3`)
- [ ] Suppression: score capped to neutral (≤ baseWeight/2) when spread regime flag is unstable
- [ ] Inputs consumed: `priceSeries`, `macdLine`, `signalLine`, `histogramSlope`, `timeframe`
- [ ] Evidence output contains: crossover candle index, histogram value at crossover, slope direction
- [ ] See test fixture matrix below for required pass cases

---

### D-TICKET-03: RSI Oversold Reversal Directive (d02)

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Phase** | Phase 1 |
| **Depends On** | D-TICKET-01 |
| **Blocks** | — (parallel with D-TICKET-02) |
| **Estimated Effort** | 1 dev session |

**Scope:** Implement `RsiOversoldReversalDirective` implementing `IDirective`. Source: `directives-manager.seed.js` directive `d02`. Category: Reversion.

**Acceptance Criteria:**
- [ ] `calculate(input)` returns result per contract
- [ ] Exit detection: RSI crosses above 30 from below within lookback window
- [ ] Confirmation boost: candle close > candle open on exit candle adds `+baseWeight * 0.25`
- [ ] Support zone: score amplified when price is within 3% of nearest support zone
- [ ] No multiplier output (multiplierEnabled=false) — omit from aggregation
- [ ] Trend filter: score suppressed when companion trend directive reports bearish
- [ ] Evidence output: RSI value on entry/exit, support zone distance, candle confirmation flag
- [ ] See test fixture matrix below for required pass cases

---

### D-TICKET-04: Panic Exhaustion Absorption Directive (d03)

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Phase** | Phase 1 |
| **Depends On** | D-TICKET-01 |
| **Blocks** | — |
| **Estimated Effort** | 2 dev sessions (high complexity) |

**Scope:** Implement `PanicExhaustionAbsorptionDirective`. Source: `directives-manager.seed.js` directive `d03`. Category: Regime. Highest baseWeight (22) with both boost and multiplier — high impact on aggregate score.

**Acceptance Criteria:**
- [ ] Flush detection: `rangeExpansion > 2.5σ` AND `volumeShock > 2.0σ` within same window
- [ ] Absorption: `recoveryVelocity > 0` (price recovering) while volume remains elevated
- [ ] Event intensity multiplier ranges from 1.0 (mild) to 1.4 (extreme flush)
- [ ] `volatilityIndex` input gates the entire calculation — below threshold returns neutral score
- [ ] Event tags stored in `evidence` output: flush start candle, absorption start candle, intensity classification
- [ ] See test fixture matrix below for required pass cases

---

### D-TICKET-05: Overhead Supply Pressure Directive (d04)

| Field | Value |
|---|---|
| **Priority** | should-have |
| **Phase** | Phase 1 |
| **Depends On** | D-TICKET-01 |
| **Blocks** | — |
| **Estimated Effort** | 1 dev session |

**Scope:** Implement `OverheadSupplyPressureDirective`. Source: `directives-manager.seed.js` directive `d04`. Category: Structure. Only uses multiplier — no additive boost. Reduces aggressive long scoring.

**Acceptance Criteria:**
- [ ] Rejection detection: price approaches a swing high zone (within 2%) then closes below it
- [ ] Rejection count: multi-rejection zones apply steeper penalty than single-rejection
- [ ] `attemptVelocity` input: faster approach = less penalty (suggests conviction)
- [ ] Pressure multiplier ranges from 0.65 (heavy multi-rejection) to 1.0 (no rejections)
- [ ] Regime override: validated regime shift from companion directive bypasses penalty
- [ ] Evidence output: rejection zone price, rejection count, attempt velocity
- [ ] See test fixture matrix below for required pass cases

---

### D-TICKET-06: Volume Conviction Burst Directive (d05)

| Field | Value |
|---|---|
| **Priority** | could-have |
| **Phase** | Phase 1 |
| **Depends On** | D-TICKET-01 |
| **Blocks** | — |
| **Estimated Effort** | 1 dev session |

**Scope:** Implement `VolumeConvictionBurstDirective`. Source: `directives-manager.seed.js` directive `d05`. Category: Participation. Status: draft — lowest test coverage. Implementation should include telemetry hooks for validation.

**Acceptance Criteria:**
- [ ] Burst detection: `volumeZScore > 1.8` relative to 20-period baseline
- [ ] `relativeVolume > 1.5` confirms participation is anomalous
- [ ] `breakoutContext` flag must be true for burst score to be applied
- [ ] Anti-news-spike filter: suppress if news event detected within ±2 candles
- [ ] Participation multiplier: 1.0-1.25 based on volume z-score
- [ ] Telemetry: log `{directiveId, symbolId, burstDetected, volumeZScore, suppressed}` per run
- [ ] See test fixture matrix below for required pass cases

---

### D-TICKET-07: Directive Aggregation Pipeline

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Phase** | Phase 1 |
| **Depends On** | D-TICKET-01, D-TICKET-02 |
| **Blocks** | D-TICKET-10 (ranked endpoint) |
| **Estimated Effort** | 1 dev session |

**Scope:** Build the aggregation layer that combines individual directive results into composite per-symbol scores. Must match the formula in `sees-engine.js` `buildSeesRanking()`: `(baseScore + boostTotal) * multiplier` with directive weights from `SEES_DIRECTIVES`.

**Acceptance Criteria:**
- [ ] Accepts `DirectiveInput` and strategy config (active directives + weights)
- [ ] Runs only active directives from the strategy config
- [ ] Computes `baseScore = Σ(directiveScore × directiveWeight)` for each directive
- [ ] Aggregates boosts additively, multipliers multiplicatively (order: boosts then multipliers)
- [ ] Returns per-symbol: `{ symbolId, score, baseScore, boostScore, scoreMultiplier, directives: {}, moments: [] }`
- [ ] Significant moment detection matches `detectSignificantMoments()` logic
- [ ] Unit test: empty directive set → score 0; single directive → correct weighted score; all directives → matches manual calculation

---

### D-TICKET-08: Strategy Configuration Service

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Phase** | Phase 1 |
| **Depends On** | — |
| **Blocks** | D-TICKET-07, D-TICKET-10 |
| **Estimated Effort** | 1 dev session |

**Scope:** Implement the strategy configuration service that stores and retrieves strategy definitions. Each strategy specifies active directives, weights, thresholds, and risk profiles. Seed the `direct-route-core` strategy from `sees-engine.js` `SEES_STRATEGY`.

**Acceptance Criteria:**
- [ ] `GET /api/strategies` returns all strategies
- [ ] `GET /api/strategies/:id` returns single strategy with active directives
- [ ] `POST /api/strategies` validates strategy schema (directives must exist in registry)
- [ ] `PUT /api/strategies/:id` updates strategy, re-validates directive references
- [ ] `DELETE /api/strategies/:id` soft-deletes (archives) a strategy
- [ ] Seed data includes `direct-route-core` with correct thresholds (entry:112, watch:86, defense:58)
- [ ] Strategy DTO validated via class-validator decorators
- [ ] Unit test: create valid strategy, create invalid (bad directive ref), update thresholds

---

### D-TICKET-09: SEES Scoring Service (Nest)

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Phase** | Phase 2 |
| **Depends On** | D-TICKET-01, D-TICKET-07, D-TICKET-08 |
| **Blocks** | D-TICKET-10 |
| **Estimated Effort** | 2 dev sessions |

**Scope:** Replace the placeholder `ScoringService` with the full implementation. Consumes directives registry and strategy config to produce ranked symbol lists. Mirrors `buildSeesRanking()` logic server-side.

**Acceptance Criteria:**
- [ ] `rankAll(strategyId, limit)` returns `{ strategy, directives, marketAverageChange, ranked[] }`
- [ ] Ranked items sorted by score descending
- [ ] Each ranked item includes: `symbolId, ticker, name, industry, price, changePercent, score, baseScore, boostScore, scoreMultiplier, confidence, signal, freshness, directives, moments`
- [ ] Signal classification: `entry` (≥threshold), `watch` (≥watchThreshold), `defensive` (< watchThreshold)
- [ ] Confidence computed via logistic function: `1/(1+e^(-(score-85)/18))` clamped to [0.28, 0.99]
- [ ] Market average change computed from all symbols in the batch
- [ ] Defaults to 20 results when no limit specified
- [ ] Unit test: single symbol scoring, multi-symbol ranking, edge case empty symbol list

---

### D-TICKET-10: Ranked Symbols API Endpoint

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Phase** | Phase 2 |
| **Depends On** | D-TICKET-09 |
| **Blocks** | UI consumption (SeesLiveStackMockPage) |
| **Estimated Effort** | 1 dev session |

**Scope:** Complete the placeholder `ScoringController` endpoint `GET /api/scoring/ranked`. Add Swagger documentation, error handling, and response DTOs. Add score breakdown variant endpoint.

**Acceptance Criteria:**
- [ ] `GET /api/scoring/ranked?strategy_id=direct-route-core&limit=20` returns ranked payload
- [ ] `GET /api/scoring/ranked/:symbolId/breakdown?strategy_id=direct-route-core` returns per-directive score breakdown
- [ ] Response includes `mode: 'local-direct-route'` metadata
- [ ] Swagger `@ApiOkResponse` decorator with response schema
- [ ] 400 on invalid strategy_id, 404 on unknown symbol for breakdown
- [ ] 429 when rate limit exceeded (queue-backed)
- [ ] `limit` clamped to [1, 100], defaults to 20
- [ ] Integration test: end-to-end from HTTP request through scoring pipeline to response

---

### D-TICKET-11: Execution Handoff Contract — Risk Gate

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Phase** | Phase 3 |
| **Depends On** | D-TICKET-09, D-TICKET-10 |
| **Blocks** | live trading execution |
| **Estimated Effort** | 2 dev sessions |

**Scope:** Implement the risk gate that sits between scoring output and execution dispatch. Source: `skeleton-handoff.js` `riskControls` section. Must enforce circuit breaker, rate limits, and session locks before any order reaches the broker adapter.

**Acceptance Criteria:**
- [ ] Circuit breaker state machine: `ready → warning → blocked` with configurable thresholds
- [ ] `GET /api/risk/status` returns `{ state, reason, blockedActions[] }`
- [ ] `POST /api/risk/check` accepts `{ symbolId, action, score }` returns `{ allowed: boolean, reason? }`
- [ ] Actions blocked when circuit state is `blocked`
- [ ] Per-endpoint rate limit enforcement from `skeleton-handoff.js` rate limit rules
- [ ] Queue-based retry with exponential backoff instead of direct rapid resubmits
- [ ] Risk profiles per strategy: conservative blocks below defenseThreshold, aggressive uses watchThreshold
- [ ] Integration test: circuit trip scenario, rate limit exhaustion, session lock behavior

---

### D-TICKET-12: Execution Queue Dispatch

| Field | Value |
|---|---|
| **Priority** | must-have |
| **Phase** | Phase 3 |
| **Depends On** | D-TICKET-11 |
| **Blocks** | broker integration |
| **Estimated Effort** | 2 dev sessions |

**Scope:** Build the execution queue that receives scored signals, validates against risk gate, and dispatches to broker adapters. Source: `skeleton-handoff.js` `executionQueue` section.

**Acceptance Criteria:**
- [ ] `POST /api/execution/enqueue` accepts `{ symbolId, signal, score, strategyId }`
- [ ] Each enqueue validates against risk gate before accepting
- [ ] Queue items have states: `pending → risk-check → approved → dispatched → confirmed` or `rejected`
- [ ] `GET /api/execution/queue` returns `{ queue[], dispatchStats: { pending, retries }, lastError }`
- [ ] Retry with backoff: 1s, 2s, 4s, 8s, then dead-letter
- [ ] Idempotency key per dispatch to prevent duplicate orders
- [ ] Broader adapter interface: `dispatch(order): Promise<DispatchResult>` with mock implementation
- [ ] Audit log: every state transition recorded with timestamp and reason
- [ ] Integration test: enqueue → risk pass → dispatch → confirm lifecycle

---

## 2. Test Fixture Matrix Per Directive

### d01 — MACD Bullish Crossover

| Fixture ID | Type | Input Profile | Expected Score Range | Validation Rule |
|---|---|---|---|---|
| d01-happy-01 | Happy path | Clear bull cross with positive slope, stable spread | 14–18 | Score ≥ baseWeight * 0.7 |
| d01-happy-02 | Happy path | Bull cross with histogram acceleration, tight spread | 16–22 | Score ≥ baseWeight (boost adds) |
| d01-edge-01 | Edge | Cross at exactly signal line (zero delta) | 9–14 | Score near baseWeight, no slope bonus |
| d01-edge-02 | Edge | Cross on last candle of input window | 9–14 | Cross still detected, recency doesn't break |
| d01-fail-01 | Failure | No cross (MACD below signal entire window) | 3–8 | Score < baseWeight * 0.5 |
| d01-fail-02 | Failure | Cross detected but spread unstable | 4–9 | Suppression active, score capped |
| d01-fail-03 | Failure | Empty price series input | 0 | Returns neutral with reason "insufficient data" |

### d02 — RSI Oversold Reversal

| Fixture ID | Type | Input Profile | Expected Score Range | Validation Rule |
|---|---|---|---|---|
| d02-happy-01 | Happy path | RSI crosses 30↓→↑, bullish candle confirmation, near support | 10–16 | Score ≥ baseWeight * 0.7 |
| d02-happy-02 | Happy path | RSI exits oversold, strong close, support zone hit | 12–18 | Full boost applied |
| d02-edge-01 | Edge | RSI touches exactly 30, no cross below | 7–12 | Exit detected but no oversold depth bonus |
| d02-edge-02 | Edge | Exit candle doji (open ≈ close) | 7–12 | Confirmation boost not applied |
| d02-fail-01 | Failure | RSI oversold but trend directive reports strong bearish | 4–8 | Suppressed by trend filter |
| d02-fail-02 | Failure | RSI stays oversold entire window, no exit | 3–7 | No exit signal, low score |
| d02-fail-03 | Failure | Exit but price >10% from any support zone | 4–9 | Missing support amplification |

### d03 — Panic Exhaustion Absorption

| Fixture ID | Type | Input Profile | Expected Score Range | Validation Rule |
|---|---|---|---|---|
| d03-happy-01 | Happy path | rangeExpansion=3.2σ, volumeShock=2.8σ, recoveryVelocity=0.4 | 18–28 | Both flush and absorption detected, multiplier active |
| d03-happy-02 | Happy path | rangeExpansion=2.6σ, volumeShock=2.1σ, clear recovery candle | 16–24 | Event intensity ~moderate |
| d03-edge-01 | Edge | rangeExpansion=2.4σ (just below threshold) | 6–12 | Flush not detected, low score |
| d03-edge-02 | Edge | Flush detected but recoveryVelocity=0 (still falling) | 6–12 | No absorption, flush score only |
| d03-fail-01 | Failure | volatilityIndex below gate threshold | 5–10 | Entire calculation bypassed |
| d03-fail-02 | Failure | volumeShock=2.5σ but rangeExpansion=1.2σ | 5–10 | High vol without range expansion = not a panic |
| d03-fail-03 | Failure | Fake panic: flush then immediate V-reversal (no absorption period) | 8–14 | Absorption window insufficient |

### d04 — Overhead Supply Pressure

| Fixture ID | Type | Input Profile | Expected Score Range | Validation Rule |
|---|---|---|---|---|
| d04-happy-01 | Happy path | Single rejection zone, price approaches and reverses | 10–14 | Base weight minus single-rejection penalty |
| d04-happy-02 | Happy path | Multi-rejection zone (3 touches), price approaching again | 6–10 | Heavier penalty from multi-rejection |
| d04-edge-01 | Edge | Price within 2% of zone, no close below | 12–16 | Approaching but not yet rejected |
| d04-edge-02 | Edge | attemptVelocity high (>0.8), approaching fast | 12–16 | Reduced penalty due to conviction |
| d04-fail-01 | Failure | Validated regime shift context active | 14–18 | Penalty fully bypassed |
| d04-fail-02 | Failure | No swing high zones in input data | 14–18 | Nothing to reject against, full score |
| d04-fail-03 | Failure | Price >5% from nearest zone | 14–18 | Too far to be under pressure |

### d05 — Volume Conviction Burst

| Fixture ID | Type | Input Profile | Expected Score Range | Validation Rule |
|---|---|---|---|---|
| d05-happy-01 | Happy path | volumeZScore=2.3, relativeVolume=1.8, breakoutContext=true | 9–15 | Burst boost + participation multiplier |
| d05-happy-02 | Happy path | volumeZScore=3.1, relativeVolume=2.5, strong breakout | 11–18 | Max multiplier applied |
| d05-edge-01 | Edge | volumeZScore=1.75 (just below threshold) | 5–10 | Below detection, near base weight only |
| d05-edge-02 | Edge | breakoutContext=false, all other conditions met | 5–10 | Burst irrelevant without breakout |
| d05-fail-01 | Failure | News event detected within ±2 candles | 4–8 | Anti-news-spike filter suppresses |
| d05-fail-02 | Failure | volumeZScore=1.2, relativeVolume=0.9 | 3–7 | No burst detected |
| d05-fail-03 | Failure | volumeZScore=2.5 but breakoutContext=false and news event flagged | 4–8 | Double suppression |

---

## 3. Scoring Strategy Rollout Plan (Phase 0–4)

### Phase 0 — Foundation (Current)

| # | Tab / Milestone | Status | Deliverable |
|---|---|---|---|
| 0.1 | API Endpoints | **Active** | Nest controllers scaffolded; endpoint catalog populated |
| 0.2 | API Activity | **Active** | Provider health endpoints; import job status pipeline |
| 0.3 | Data Elements | **Active** | `DirectiveInput` / `DirectiveResult` interfaces finalized |
| 0.4 | Active Symbols | **Active** | Symbol CRUD + market data freshness endpoint operational |

### Phase 1 — Decision Layer (Directives + Strategies)

| # | Tab / Milestone | Status | Deliverable |
|---|---|---|---|
| 1.1 | Configure Directives | **Next** | D-TICKET-01 through D-TICKET-07 — directive registry + all 5 seed directives implemented |
| 1.2 | Algorithm Lab | **Parallel** | D-TICKET-08 — strategy configuration CRUD; seed `direct-route-core` |
| 1.3 | Create Scoring Strategies | **Parallel** | Strategy preset library; validation against directive registry |

**Scoring rollout step in Phase 1:**
- Ship `DirectivesService.runAll()` with all 5 directives
- Ship `SEES_STRATEGY` as default strategy config
- Client-side `buildSeesRanking()` continues to work with local data for mock/offline mode
- Server-side scoring via `ScoringService.rankAll()` becomes canonical source

### Phase 2 — Execution Layer (Scoring ↔ Trading)

| # | Tab / Milestone | Status | Deliverable |
|---|---|---|---|
| 2.1 | Trading Strategies | **Queued** | Strategy-to-directive binding; multi-strategy support |
| 2.2 | SEES Ready | **Queued** | D-TICKET-09 — full ScoringService implementation |
| 2.3 | SEES Pro | **Queued** | D-TICKET-10 — ranked + breakdown API endpoints |
| 2.4 | Manual Trading | **Queued** | UI consumes `/api/scoring/ranked` via TanStack Query |

**Scoring rollout step in Phase 2:**
- API endpoint `GET /api/scoring/ranked` returns live scored symbols
- API endpoint `GET /api/scoring/ranked/:symbolId/breakdown` returns directive-level detail
- Mock page (`SeesLiveStackMockPage`) transitions from `buildSeesRanking()` to API fetch
- Signal classification (entry/watch/defensive) flows through to UI badges

### Phase 3 — Controls Layer (Risk + Execution)

| # | Tab / Milestone | Status | Deliverable |
|---|---|---|---|
| 3.1 | Trade History | **Future** | Audit log for all scored → executed transitions |
| 3.2 | Platform Comparisons | **Future** | Cross-broker scoring comparison views |
| 3.3 | Risk Controls | **Future** | D-TICKET-11 — risk gate + circuit breaker |
| 3.4 | Execution Queue | **Future** | D-TICKET-12 — queue dispatch + broker adapter |

**Scoring rollout step in Phase 3:**
- Risk gate validates score thresholds against risk profiles before dispatch
- Execution queue translates `entry` signals into broker orders
- `defensive` signals block dispatch entirely; `watch` signals require manual confirmation

### Phase 4 — Intelligence Layer

| # | Tab / Milestone | Status | Deliverable |
|---|---|---|---|
| 4.1 | Focus Priority | **Future** | ML-assisted signal ranking overlay |
| 4.2 | Performance Lab | **Future** | Backtesting framework; score accuracy validation |

**Scoring rollout step in Phase 4:**
- Directive weight tuning via backtesting feedback loop
- Performance metrics: score → realized return correlation, signal precision/recall
- Confidence calibration against actual trade outcomes

---

## 4. API Contract Drafts

### 4.1 `GET /api/scoring/ranked`

**Query Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `strategy_id` | string | No | `direct-route-core` | Strategy identifier from strategies registry |
| `limit` | integer | No | 20 | Max results (clamped 1–100) |
| `signal_filter` | enum | No | — | Filter by signal: `entry`, `watch`, `defensive` |
| `min_confidence` | float | No | — | Minimum confidence threshold (0.0–1.0) |

**Response 200:**
```json
{
  "mode": "local-direct-route",
  "strategy": {
    "id": "direct-route-core",
    "name": "Direct Route Core Strategy",
    "entryThreshold": 112,
    "watchThreshold": 86,
    "defenseThreshold": 58,
    "activeDirectives": ["trend", "momentum", "volatility", "breadth", "conviction"]
  },
  "directives": [
    {
      "id": "trend",
      "label": "Trend Strength",
      "weight": 0.28,
      "category": "trend"
    }
  ],
  "marketAverageChange": 0.34,
  "computedAt": "2026-06-10T14:30:00Z",
  "ttlSeconds": 30,
  "ranked": [
    {
      "symbolId": "AAPL-42-0",
      "ticker": "AAPL",
      "name": "Apple Inc.",
      "industry": "Technology",
      "price": 198.45,
      "changePercent": 1.23,
      "score": 128.7,
      "baseScore": 112.3,
      "boostScore": 8.2,
      "scoreMultiplier": 1.068,
      "confidence": 0.91,
      "signal": "entry",
      "freshness": "fresh",
      "directives": {
        "trend": 78,
        "momentum": 82,
        "volatility": 71,
        "breadth": 68,
        "conviction": 85
      },
      "moments": [
        {
          "id": "breakout-acceleration",
          "label": "Breakout Acceleration",
          "boost": 14,
          "multiplier": 1.08
        }
      ],
      "baseQuality": 87.3,
      "stability": 84.1
    }
  ]
}
```

**Error Responses:**
| Code | Condition |
|---|---|
| 400 | Invalid `strategy_id` (not found in registry) |
| 422 | `limit` out of range or non-numeric |
| 429 | Rate limit exceeded; `Retry-After` header set |
| 503 | Scoring pipeline unavailable (no directives registered) |

---

### 4.2 `GET /api/scoring/ranked/:ticker/breakdown`

**Path Parameters:**
| Param | Type | Description |
|---|---|---|
| `ticker` | string | Ticker symbol (e.g., `AAPL`) |

**Query Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `strategy_id` | string | No | `direct-route-core` | Strategy for directive selection and weights |

**Response 200:**
```json
{
  "ticker": "AAPL",
  "strategyId": "direct-route-core",
  "computedAt": "2026-06-10T14:30:00Z",
  "aggregate": {
    "score": 128.7,
    "baseScore": 112.3,
    "boostScore": 8.2,
    "scoreMultiplier": 1.068,
    "confidence": 0.91,
    "signal": "entry",
    "freshness": "fresh"
  },
  "directiveBreakdown": [
    {
      "id": "trend",
      "label": "Trend Strength",
      "weight": 0.28,
      "rawScore": 78.0,
      "weightedContribution": 21.84,
      "confidence": 0.88,
      "evidence": {
        "emaSlope": 0.042,
        "pricePosition": "above",
        "sustainedBars": 12
      }
    },
    {
      "id": "momentum",
      "label": "Momentum",
      "weight": 0.24,
      "rawScore": 82.0,
      "weightedContribution": 19.68,
      "confidence": 0.91,
      "evidence": {
        "rateOfChange": 1.23,
        "acceleration": 0.15,
        "expanding": true
      }
    }
  ],
  "significantMoments": [
    {
      "id": "breakout-acceleration",
      "label": "Breakout Acceleration",
      "boost": 14,
      "multiplier": 1.08,
      "triggerConditions": {
        "changePercentAbove": true,
        "trendAbove78": true,
        "momentumAbove75": true
      }
    }
  ],
  "riskFlags": [],
  "dataFreshness": {
    "priceAge": "2s",
    "directiveComputeAge": "1s",
    "status": "fresh"
  }
}
```

**Error Responses:**
| Code | Condition |
|---|---|
| 404 | Ticker not found in active symbol set |
| 400 | Invalid `strategy_id` |
| 503 | Scoring pipeline unavailable |

---

### 4.3 `GET /api/scoring/directives`

Returns the directive registry with metadata for UI configuration panels.

**Response 200:**
```json
{
  "directives": [
    {
      "id": "trend",
      "label": "Trend Strength",
      "category": "trend",
      "weight": 0.28,
      "status": "active",
      "complexity": "low",
      "inputs": ["priceSeries", "emaSlope", "pricePosition"],
      "description": "Rewards sustained directional movement and price staying above the local baseline.",
      "registeredAt": "2026-06-10T12:00:00Z"
    }
  ],
  "count": 5,
  "categories": ["trend", "momentum", "volatility", "breadth", "conviction"]
}
```

---

### 4.4 `POST /api/scoring/evaluate`

On-demand single-symbol evaluation (for UI tooltips and quick checks).

**Request Body:**
```json
{
  "ticker": "AAPL",
  "strategyId": "direct-route-core",
  "includeBreakdown": true
}
```

**Response 200:** Same shape as breakdown endpoint above.

**Rate Limiting:** Stricter than ranked endpoint — 10 requests per 30 seconds per IP.

---

## 5. Priority Labels Summary

### must-have (Block launch of scoring pipeline)

| Ticket | Label | Rationale |
|---|---|---|
| D-TICKET-01 | must-have | No registry = no directives can run |
| D-TICKET-02 | must-have | MACD is the highest-coverage directive (81%); foundational momentum signal |
| D-TICKET-03 | must-have | RSI oversold is most common entry pattern; high test coverage (88%) |
| D-TICKET-04 | must-have | Panic exhaustion is the highest-weight directive (22); significant score impact |
| D-TICKET-07 | must-have | Aggregation pipeline is the bridge between directives and scores |
| D-TICKET-08 | must-have | Strategies define which directives run; no config = no scoring |
| D-TICKET-09 | must-have | Scoring service is the compute engine |
| D-TICKET-10 | must-have | API endpoint is the contract the UI consumes |
| D-TICKET-11 | must-have | Risk gate is non-negotiable before any live execution |
| D-TICKET-12 | must-have | Execution queue gates actual order dispatch |

### should-have (Enhances scoring quality but not launch-blocking)

| Ticket | Label | Rationale |
|---|---|---|
| D-TICKET-05 | should-have | Supply pressure improves false-positive rejection; important but not essential for MVP |

### could-have (Nice to have; can ship post-launch)

| Ticket | Label | Rationale |
|---|---|---|
| D-TICKET-06 | could-have | Volume burst is lowest test coverage (39%), still in draft; ship after validation |

---

## Cross-Reference Map

| Source File | Tickets | API Contracts | Phase |
|---|---|---|---|
| `sees-engine.js` | D-TICKET-07, D-TICKET-08, D-TICKET-09 | 4.1, 4.2, 4.3 | Phase 1–2 |
| `directives-manager.seed.js` | D-TICKET-02 through D-TICKET-06 | 4.3 | Phase 1 |
| `skeleton-rollout.js` | All tickets mapped to phases | — | Phase 0–4 |
| `skeleton-handoff.js` | D-TICKET-11, D-TICKET-12 | — | Phase 3 |
| `scoring.controller.ts` (Nest) | D-TICKET-10 | 4.1, 4.2 | Phase 2 |
| `directives.service.ts` (Nest) | D-TICKET-01 | — | Phase 1 |
| `scoring.js` (client) | D-TICKET-10 (consume) | 4.1 | Phase 2 |
