# P08 — SEES Scoring QA Matrix

> Generated: 2026-06-10 | Target: Deterministic QA for scoring/ranking behavior  
> Sources: `sees-engine.js`, `scoring.service.ts`, `SeesLiveStackMockPage.jsx`, `SeesScoringPanel.jsx`

---

## QA Scenario 1: Happy Path — Normal Operation

### 1.1 Local Engine (`buildSeesRanking`)

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| HP-L01 | 6 symbols (AAPL, MSFT, NVDA, TSLA, META, AMD), tick=0 | 6 ranked symbols, sorted by score desc | Run `buildSeesRanking(INITIAL_SYMBOLS, 0)` — verify `ranked.length === 6`, `ranked[0].score > ranked[5].score` |
| HP-L02 | Same symbols, tick=0 vs tick=1 | Scores differ between ticks (non-trivial oscillation) | Compare scores — no two consecutive ticks produce identical rank orders |
| HP-L03 | Same symbols, same tick | Identical output (deterministic) | Call twice with same tick — objects deep-equal |
| HP-L04 | All 6 symbols at tick=0 | All 5 directives present per symbol | Verify each ranked item has keys: `trend`, `momentum`, `volatility`, `breadth`, `conviction` |
| HP-L05 | Mixed bias symbols (positive + negative) | Score spread > 20 between top and bottom | Verify `ranked[0].score - ranked[5].score > 20` (diverse inputs → diverse outputs) |
| HP-L06 | Tick=0 | Signal classification correct | Verify entry (≥112) / watch (≥86) / defensive (<86) thresholds respected |
| HP-L07 | Tick=0 | Confidence in range [0.28, 0.99] | All confidences within logistic function bounds |
| HP-L08 | Tick=0 | Moments detected for high-change symbols | Verify NVDA (bias=0.68) likely gets `breakout-acceleration` or `broad-risk-on` moment |
| HP-L09 | Tick=0 | `marketAverageChange` computed correctly | Average of all 6 `changePercent` values matches within 0.01 |
| HP-L10 | Tick=0 | Freshness labels correct | `abs(changePercent) < 0.45 → fresh`, `< 0.95 → watch`, `≥ 0.95 → stale` |

### 1.2 Backend Service (`ScoringService.rankAll`)

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| HP-B01 | 3 active symbols in DB (AAPL, NVDA, TSLA), limit=20 | Returns 3 ranked items | `curl /api/scoring/ranked` → `ranked.length === 3` |
| HP-B02 | Same symbols, called 30s apart | Scores may shift (time-bucket changes every 30s) | Call twice with >30s gap — `deterministicScore` bucket changes cause different scores |
| HP-B03 | Same symbols, called within same 30s bucket | Identical scores | Two rapid calls — scores identical (same bucket) |
| HP-B04 | limit=1 | Returns 1 symbol | `curl /api/scoring/ranked?limit=1` → `ranked.length === 1` |
| HP-B05 | limit=100 | Clamped to 100 | Passes limit through, no error |
| HP-B06 | limit=0 | Clamped to 1 (safe minimum) | Returns 1 symbol, no empty array |
| HP-B07 | Response shape | `mode`, `services`, `ranked[]` present | Verify all three keys in JSON |
| HP-B08 | Ranked items shape | `symbolId`, `ticker`, `score`, `confidence`, `freshness`, `timestamp` present | Verify all six keys per item |
| HP-B09 | Active symbols sorted | Descending by score | `ranked[0].score >= ranked[1].score >= ranked[2].score` |
| HP-B10 | `freshness` field | Value is `"deterministic"` | Current implementation label — will change to `"fresh"/"stale"` when real directives ship |

### 1.3 UI (`SeesLiveStackMockPage`)

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| HP-U01 | Page loads with default state | 6 ranked cards visible, strategy summary, directive grid | Visual check: all sections render without errors |
| HP-U02 | Click "Refresh Data" | `tick` increments, scores recalculate, `lastUpdated` changes | Click button, verify new scores and updated timestamp |
| HP-U03 | Click "Start Auto-Re-Sorting" | 4s interval starts, scores update every 4s | Button text changes to "Stop Auto-Re-Sorting", scores change after 4s wait |
| HP-U04 | Click "Stop Auto-Re-Sorting" | Interval stops, scores freeze | Button text changes back, scores stop changing |
| HP-U05 | API available with real data | `useApi === true`, `dataSource === 'api'`, API data used for status bar | Verify API mode badge shown, status reflects API source |
| HP-U06 | API query returns data | Ranking shows API metadata (mode, strategy) in header | Verify mode badge and strategy name from API response |
| HP-U07 | Directive cards render | 5 directive cards with label, indicator, weight, description | All 5 from `SEES_DIRECTIVES` visible |
| HP-U08 | Score pills with correct tone | entry=green, watch=yellow, defensive=red | CSS class `signal-entry`, `signal-watch`, `signal-defensive` applied correctly |
| HP-U09 | Calculation chain section | 4-step ordered list | Steps 1-4 visible in order |
| HP-U10 | Status card updates | Shows mode, source, auto-sort state, last updated time | All 4 fields present and updating |

---

## QA Scenario 2: Stale / Missing Data

### 2.1 Local Engine

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| SD-L01 | Empty symbols array `[]` | `ranked: []`, `marketAverageChange: 0` (division by zero guarded) | `buildSeesRanking([], 0)` — no throw, empty response |
| SD-L02 | Single symbol | Works with 1 symbol | `buildSeesRanking([oneSymbol], 0)` — 1 result, no errors |
| SD-L03 | Symbol with `basePrice: 0` | Clamped to min=1 in `deriveLiveState` | Price never goes below 1 |
| SD-L04 | Symbol with `baseQuality` out of range | Clamped to [0, 100] | Quality always in valid range |
| SD-L05 | Symbol with `baseBias` undefined | `changePercent` defaults with `(baseBias ?? 0)` | Works without bias field |
| SD-L06 | Symbol missing `industry` | `industry` is `undefined` but doesn't break ranking | Row still renders with empty industry |
| SD-L07 | Very high tick value (2147483647) | Sine/cos oscillate normally (no overflow) | Scores still within [0, ~130] range |
| SD-L08 | Negative tick value (-1) | Oscillation works with negative input | Math.sin/cos handle negative fine — scores still deterministic |

### 2.2 Backend Service

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| SD-B01 | Database unavailable (`prisma.isAvailable === false`) | Returns `ranked: []` with mode info, no error | Kill MySQL, call endpoint — 200 with empty ranked |
| SD-B02 | No active symbols in database | Returns `ranked: []` | Empty `symbol` table → empty ranked array |
| SD-B03 | `FreshnessService` unavailable (null) | Graceful degradation — fallback to deterministic scoring | Mock null freshness service — scoring still returns results |
| SD-B04 | `DirectivesService` has no registered directives | `runAll` returns empty Map, aggregation produces 0 scores | Empty registry → zero scores → ranked at bottom |
| SD-B05 | `StrategiesService` throws on `calculateScore` | Caught, logged, directive scores returned without strategy aggregation | Try/catch in `rankAll` prevents cascade failure |
| SD-B06 | Symbol deleted mid-scoring (DB race) | Individual symbol skipped, others still ranked | Stale symbol ID → skip, continue with remaining |
| SD-B07 | Market data stale (>5 min since last refresh) | `freshness: 'stale'` flag, confidence reduced by 0.2 multiplier | Verify freshness label and reduced confidence |
| SD-B08 | Market data completely missing (no bars) | Falls back to deterministic scoring, `freshness: 'deterministic'` | Current behavior — transparent fallback |

### 2.3 UI Components

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| SD-U01 | API query returns `ranked: []` | `useApi === false`, falls back to local engine | Local ranking displayed as fallback |
| SD-U02 | API query fails (network error) | `apiQuery.isError === true`, `useApi === false` | Local engine used, error swallowed gracefully |
| SD-U03 | `SeesScoringPanel` — `isLoading` state | "Loading rankings..." message displayed | Component renders loading text |
| SD-U04 | `SeesScoringPanel` — `isError` state | "Failed to load rankings. Is the backend running?" | Error message with actionable hint |
| SD-U05 | `SeesScoringPanel` — empty ranked array | "No ranked symbols yet." with mode hint | Empty state message + mode badge |
| SD-U06 | `SeesScoringPanel` — `rankQuery.data` is null/undefined | Defaults to `{}`, `ranked` defaults to `[]` | No crash on null data |
| SD-U07 | `SeesScoringPanel` — `data.mode` is undefined | Mode badge shows `"..."` | Graceful default for missing mode |
| SD-U08 | `SeesLiveStackMockPage` — API returns scores of 0 | `useApi === false` (`some(r => r.score > 0)` check) | Falls back to local engine |
| SD-U09 | `SeesLiveStackMockPage` — localStorage corrupted | `JSON.parse` fails, defaults used | Try/catch in state initializer prevents crash |
| SD-U10 | `SeesLiveStackMockPage` — auto-sort with stale API | Refetch continues, local engine still works | Independent fallback paths |

---

## QA Scenario 3: Provider Degradation

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| PD-01 | Trading212 API returns 429 (rate limited) | Backend logs rate limit, uses cached/stale data | Verify `freshness: 'stale'` not `'error'` |
| PD-02 | Trading212 API returns 503 (down) | Provider marked degraded, other providers used if available | Multi-provider config → switch to IBKR/Alpaca |
| PD-03 | All providers degraded/unavailable | Falls back to deterministic scoring | `freshness: 'deterministic'`, confidence floor applied |
| PD-04 | Provider returns partial data (e.g., missing volume) | Directive that needs volume (Volume Confirmation) returns neutral score | `score: 0, confidence: 0, reason: "Missing required data: volume"` |
| PD-05 | Provider returns malformed JSON | Parsed safely, individual bar skipped | Log warning, continue with valid bars |
| PD-06 | Provider returns fewer bars than directive minimum | Directive returns low confidence with explanation | RSI(14) with 10 bars → `confidence: 0.25, reason: "Insufficient data..."` |
| PD-07 | Provider latency exceeds SLA (freshness threshold) | Data marked stale, `freshness: 'stale'`, confidence reduced | SLA breach → stale tag |
| PD-08 | Provider returns duplicate bars (same timestamp) | Deduplicated, last bar wins | No duplicate timestamps in `MarketBar[]` |
| PD-09 | Provider returns bars out of order | Sorted by timestamp (oldest→newest) before directive execution | `DirectiveInput.bars` always chronological |
| PD-10 | Provider auth token expired | Backend returns cached data + degradation notice | Graceful — no 500 error to UI |

---

## QA Scenario 4: Tie-Break Scenarios

### 4.1 Local Engine Tie-Breaks

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| TB-L01 | Two symbols with identical scores | Sort is stable — whichever appears first in input stays first | `.sort()` stability depends on engine, but both same-ranked |
| TB-L02 | Two symbols with identical scores, different confidence | Score sort is primary; confidence is tiebreaker only if added | Currently: score-only sort — both share rank position |
| TB-L03 | All symbols have same basePrice, baseBias, baseQuality | Scores differ due to position-dependent oscillation (index param) | Sine drift uses `index*0.35` — position matters |
| TB-L04 | Symbol A: high trend/low momentum vs Symbol B: low trend/high momentum | Weights determine winner: trend(0.28) > momentum(0.24) | A wins if scores otherwise equal |
| TB-L05 | Two symbols with identical directive scores but different moments | Moments affect final score (boost + multiplier) | Moment-bearing symbol ranks higher |
| TB-L06 | Two symbols — one has `breakout-acceleration`, one has `reversion-risk` | Boost: +14 vs -10, multiplier: 1.08 vs 0.93 | Breakout symbol significantly higher |

### 4.2 Backend Tie-Breaks

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| TB-B01 | Two symbols with identical deterministic scores | Sort preserves DB order (insertion order) | `.sort()` stable — first fetched stays first |
| TB-B02 | limit=5 with 7 symbols, bottom 3 tied | Top 5 returned (2 tied symbols cut) | Arbitrary but deterministic which are cut |
| TB-B03 | Same seed produces same score for different tickers | Possible hash collision — different tickers, same score | Rare but handled: both included, sorted adjacently |
| TB-B04 | Time bucket boundary — one symbol scored just before, one just after | Different scores due to bucket change | 30s boundary can cause rank flip — acceptable |

### 4.3 UI Tie-Breaks

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| TB-U01 | Two cards with identical scores | Both show same score pill, adjacent in stack | Visual consistency |
| TB-U02 | Rank numbers for tied symbols | Sequential: #3, #4 (not both #3) | Array index-based, not score-based |
| TB-U03 | Signal classification edge: score exactly 112 | "entry" (≥ threshold, not >) | Non-strict comparison `>=` |

---

## QA Scenario 5: Fallback vs Full Mode Behavior

### 5.1 Mode Transitions

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| FB-01 | App starts with no backend (`fallback` mode) | Local engine used exclusively, API query fails silently | `useApi === false`, `dataSource === 'local-direct-route'` |
| FB-02 | Backend comes online while app running | Next API refetch succeeds, `useApi` transitions to `true` | TanStack Query retry + refetchInterval picks it up |
| FB-03 | Backend goes offline while app running | Next API refetch fails, falls back to local engine | `useApi` transitions to `false` gracefully |
| FB-04 | Backend in `full` mode with database but no market data | Deterministic scoring used, `freshness: 'deterministic'` | Backend returns scores from ticker hash |
| FB-05 | Backend in `full` mode with fresh market data | Real directive scores used, `freshness: 'fresh'` | Future state — current code not yet wired |
| FB-06 | `QUEUE_MODE` enabled but Redis unavailable | Queue degrades gracefully, scoring continues without queue | Mode metadata reflects `redis: false` |
| FB-07 | `QUEUE_MODE` disabled | Queue skipped, scoring runs inline | No async job enqueue — direct call |

### 5.2 Mode Metadata Consistency

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| FB-08 | Backend `/api/scoring/ranked` response | `mode` and `services` keys always present | Every response includes both, even on error |
| FB-09 | `mode` values consistent | `fallback` when DB unavailable, `full` when all services up | Check against `ModeService.getModeInfo()` |
| FB-10 | `services.database` matches actual DB state | `true` when Prisma connected, `false` when MySQL down | Kill MySQL → `database: false` in next response |
| FB-11 | UI mode badge reflects backend mode | Badge shows `fallback` or `full` matching API response | CSS class `mode-fallback` or `mode-full` applied |
| FB-12 | `SeesScoringPanel` empty state mentions mode | "Mode: fallback. Symbols need price data..." | Helpful context for operator |

### 5.3 Deterministic Scoring Stability

| Test Case | Input | Expected Behavior | Validation Method |
|---|---|---|---|
| FB-13 | Same ticker list, same time bucket → same scores | Deterministic and reproducible | Run twice → identical JSON |
| FB-14 | Ticker hash collision check: "AA" vs "BB" (different tickers) | Different scores (unlikely collision but handled) | Verify `hashTicker` produces distinct values for common inputs |
| FB-15 | Score range: `deterministicScore()` | Always [0, 130] | `Math.max(0, Math.min(130, ...))` enforces bounds |
| FB-16 | Confidence range: score-based | [0.30, 0.95] | `Math.min(0.95, Math.max(0.30, score/120))` |

---

## Cross-Cutting Concerns

### Performance

| Test Case | Expected Behavior | Threshold |
|---|---|---|
| Local engine: 6 symbols | <1ms | Instant — pure math, no I/O |
| Local engine: 1000 symbols | <50ms | O(n) per symbol, O(n log n) sort |
| Backend: 20 symbols, deterministic | <100ms | DB query + hash + sort |
| Backend: 20 symbols, with directives (future) | <500ms | 5 directives × 20 symbols = 100 calculations |
| UI: auto-sort 4s interval | No frame drops, no memory leak | `useMemo` prevents unnecessary recalculations |
| TanStack Query: staleTime 10s | No duplicate fetches within 10s | `staleTime: 10_000` on `SeesLiveStackMockPage` |

### Error Boundary

| Test Case | Expected Behavior |
|---|---|
| `buildSeesRanking` throws | Caught by React error boundary, page shows fallback UI |
| `fetchRankedSymbols` network failure | TanStack Query `isError` flag, retry=1, then show error state |
| `localStorage.setItem` fails (quota exceeded) | Silently caught, UI continues working with in-memory state |
| `JSON.parse` on corrupted localStorage | Caught in state initializer, defaults used |

### Signal Classification Edge Cases

| Score | Signal | Threshold Rule |
|---|---|---|
| 112 | entry | `≥ entryThreshold (112)` |
| 111.9 | watch | `< entryThreshold, ≥ watchThreshold (86)` |
| 86 | watch | `≥ watchThreshold` |
| 85.9 | defensive | `< watchThreshold` |
| 0 | defensive | Any score below watch |
| 150+ | entry | Unrealistic but handled — capped by engine |

---

## Regression Test Commands

```bash
# Frontend build
npm --prefix c:/wamp64/www/trading-command-suite run build

# Backend build
npm --prefix c:/wamp64/www/trading-command-suite/nest run build

# Run backend (verify ranked endpoint)
npm --prefix c:/wamp64/www/trading-command-suite/nest run start:dev
# Then: curl http://localhost:3201/api/scoring/ranked?limit=5

# Local engine smoke test
node -e "
const { buildSeesRanking } = require('./src/core/sees/sees-engine.js');
// (if CJS) or use import in ESM context
"
```

---

## Expected Failure Modes & Operator Guidance

| Symptom | Likely Cause | Operator Action |
|---|---|---|
| All scores identical | All symbols have same basePrice/bias/quality (unlikely with real data) | Verify symbol seed data diversity |
| Scores don't change on refresh | Auto-sort disabled + manual refresh not clicked | Click "Refresh Data" or "Start Auto-Re-Sorting" |
| "Failed to load rankings" in panel | Backend not running on :3201 | Run `npm --prefix c:/wamp64/www/trading-command-suite/nest run start:dev` |
| Empty ranked list | No active symbols in database | Run `npx prisma db seed` to populate test symbols |
| Mode shows "fallback" but backend is running | Database unavailable (MySQL stopped) | Start WAMP MySQL service |
| Scores jump dramatically between ticks | Normal — sine/cos oscillation simulates market movement | Expected behavior in mock/deterministic mode |
| Confidence always 0.30–0.95 | Correct — logistic function clamped range | Expected; real directives will produce more varied confidence |
