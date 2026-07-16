import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });

const DIAGRAMS = [
  {
    id: 'sees-research',
    label: 'SEES Research Phase',
    desc: 'Data from 10 providers feeds 99+ directives grouped into Technical, Sentiment, and Risk categories. Risk directives multiplicatively gate Tech+Sentiment scores (0.3x–1.2x). Calibration applies symbol-specific weight overrides. Output is a normalized percentage of maxPossibleScore (unbounded, not capped at 100).',
    code: `flowchart LR
    subgraph Sources["Data Sources (10 Providers)"]
        A[MT5 Bridge]
        B[Finnhub / Alpha Vantage]
        C[DB — MarketBar, Earnings]
    end
    subgraph Groups["Directive Groups (99+)"]
        D[Technical 40%<br/>momentum, patterns, volume]
        E[Sentiment 35%<br/>news, earnings, analyst]
        F[Risk 25%<br/>budget, liquidity, session]
    end
    subgraph Calibration["Calibration"]
        G[Symbol Overrides<br/>weightMultiplier, decay]
    end
    subgraph Gating["Multiplicative Risk Gating"]
        H[Tech × RiskGate]
        I[Sent × RiskGate]
        J[totalScore = gatedTech + gatedSent]
    end
    subgraph Output["Output"]
        K[Normalized %<br/>totalScore / maxPossibleScore]
        L[Research Dashboard]
        M[SEES Rankings]
    end
    Sources --> Groups
    D --> G
    E --> G
    F --> H
    F --> I
    G --> H
    G --> I
    H --> J
    I --> J
    J --> K
    K --> L
    K --> M`,
  },
  {
    id: 'sees-trading',
    label: 'M.E.T.A. Stack Trading Lifecycle',
    desc: 'M.E.T.A. Stack orchestrates the full trading lifecycle. Automation tick: Timeline risk check → fetch bars → per-tick directive memoization cache (100 directives scored once per symbol, reused across rankAll + protocol-gating + evaluateStrategy) → dual-protocol gated scoring via SEES (LONG vs SHORT) → threshold + cooldown + duplicate guard → mode dispatch (manual/semi-auto/auto) → broker execution via AdapterFactory → trade recording. Monitoring and feedback loops are planned but not yet automated.',
    code: `flowchart TB
    subgraph Tick["1. Automation Tick (5min)"] 
        A[clearTickCache] --> B[Timeline Risk Check]
        B --> C[Global Risk Multiplier]
        C --> D[Fetch Bars per Symbol]
    end
    subgraph Cache["2. Directive Memoization #408"]
        D --> E[directivesService.runAll<br/>100 directives per symbol]
        E --> F[Tick-scoped Map cache<br/>key: symbol + bar-signature]
        F --> G[Subsequent callers get<br/>cached result — no re-execution]
    end
    subgraph SEES["3. SEES Scoring Engine"]
        G --> H[rankAll: global ranking]
        G --> I[protocol-gating scoreWithGating<br/>Groups directives per protocol]
        G --> J[evaluateStrategy<br/>Reuses cached directive results]
        I --> K{LONG vs SHORT?}
        H --> K
        K -->|long wins| L[BUY signal]
        K -->|short wins| M[SELL signal]
        K -->|both low| N[HOLD]
    end
    subgraph Gates["4. M.E.T.A. Safety Gates"]
        L --> O{Score >= Threshold?}
        M --> O
        O -->|No| P[SKIP]
        O -->|Yes| Q{Cooldown active?}
        Q -->|Yes| P
        Q -->|No| R{Duplicate position?}
        R -->|Yes| S[BLOCKED]
        R -->|No| T{Mode?}
    end
    subgraph Dispatch["5. Mode Dispatch"]
        T -->|manual| U[LOG only]
        T -->|semi-auto| V[QUEUED<br/>await confirm]
        T -->|auto| W[Execute]
    end
    subgraph Execution["6. Broker Execution"]
        W --> X[AdapterFactory<br/>MT5 or T212]
        X --> Y[placeOrder]
        Y --> Z[Trade Recorded]
    end
    style Cache fill:#0f3460,stroke:#e94560,color:#e94560
    style SEES fill:#16213e,stroke:#0f3460`,
  },
  {
    id: 'sees-automation',
    label: 'M.E.T.A. Stack — Setup to Execution',
    desc: 'End-to-end user journey through the M.E.T.A. Stack (Modular Expert Trading Architecture). Setup: providers → watchlists → protocols. Automation: ScoringStrategy pairs a watchlist+protocol, the loop ticks and invokes SEES for scoring only. Decision and execution are M.E.T.A. responsibilities.',
    code: `flowchart TB
    subgraph SETUP["1. SETUP (User)"]
        A1["Configure Providers"] --> A2["Import Market Data"]
        A2 --> A3["Create Watchlists"]
        A3 --> A4["Build Protocols<br/>(directive groups + weights)"]
        A4 --> A5["ScoringStrategy =<br/>Watchlist + Protocol + Broker + Mode"]
    end
    subgraph AUTOMATION["2. AUTOMATION LOOP (M.E.T.A.)"]
        B1["Start Loop"] --> B2["Enable Broker<br/>(MT5 or T212)"]
        B2 --> B3["TradingStrategy =<br/>Protocol + Symbol + Entry Rules"]
        B3 --> B4["Tick: fetch bars,<br/>invoke SEES per symbol"]
    end
    subgraph SEES["3. SEES SCORING ENGINE"]
        C1["MT5 / DB bars"] --> C2["99+ Directives"]
        C2 --> C3["Protocol Gating<br/>(multiplicative risk)"]
        C3 --> C4["Composite Score<br/>+ signal class"]
    end
    subgraph DECISION["4. DECISION (M.E.T.A.)"]
        D1{"Score >= Threshold?"} -->|No| D2["Watch"]
        D1 -->|Yes| D3{"Cooldown + Duplicate?"}
        D3 -->|Blocked| D4["Rejected"]
        D3 -->|Passed| D5{"Mode?"}
        D5 -->|manual| D6["Log"]
        D5 -->|semi-auto| D7["Queue for confirm"]
        D5 -->|auto| D8["Auto-execute"]
    end
    subgraph EXECUTION["5. EXECUTION"]
        E1["AdapterFactory"] --> E2["Order Placed"]
    end
    subgraph MONITOR["6. MONITOR (planned)"]
        F1["Position Tracker"] --> F2["P/L Updates"]
    end
    A5 --> B3
    B4 --> C1
    C4 --> D1
    D7 --> E1
    D8 --> E1
    E2 --> F1
    F2 -.->|Planned: adjust| B3
    style SEES fill:#111827,stroke:#22c55e,color:#e5e7eb
    style MONITOR fill:#1a1a2e,stroke:#f59e0b,stroke-dasharray:5 5,color:#f59e0b`,
  },
  {
    id: 'data-arch',
    label: 'Data Architecture',
    desc: 'End-to-end data flow: 10 providers → AdapterFactory (rate-limited, failover) → normalized storage (MarketBar, Earnings, News, Macro) → SEES directives → scoring → M.E.T.A. trading → analytics. No raw/transform split — adapters normalize on ingest.',
    code: `flowchart TB
    subgraph Ingest["Data Ingest (10 Providers)"]
        A[MT5 Bridge]
        B[Finnhub / Alpha Vantage]
        C[Yahoo / Polygon / Twelve]
        D[Trading212 / FMP]
        E[FRED / ECB]
    end
    subgraph Import["Import Layer"]
        F[AdapterFactory<br/>priority + failover]
        G[RateLimitGovernor]
        H[FreshnessService<br/>stale? → re-import]
    end
    subgraph Storage["Storage (Prisma — 70+ models)"]
        I[(MarketBar)]
        J[(EarningsEvent)]
        K[(NewsArticle)]
        L[(Symbol + Calibration)]
        M[(ScoreSnapshot)]
        N[(Trade + Position + Order)]
    end
    subgraph SEES["SEES Processing"]
        O[99+ Directives]
        P[ProtocolGatingService]
        Q[Composite Score]
    end
    subgraph META["M.E.T.A. Trading"]
        R[AutomationLoop]
        S[AdapterFactory<br/>MT5 or T212]
        T[DuplicateGuard + Timeline]
    end
    subgraph Analytics["Analytics"]
        U[CacheInterceptor<br/>TTL per endpoint]
        V[StackPerformance<br/>MetaStack ratings]
        W[API Responses → React]
    end
    Ingest --> F
    F --> G --> H
    H --> I
    H --> J
    H --> K
    H --> L
    I --> O
    J --> O
    K --> O
    L --> P
    O --> P --> Q
    Q --> M
    Q --> R
    R --> T --> S --> N
    M --> U --> W
    N --> V --> W`,
  },
  {
    id: 'component-arch',
    label: 'Component & Route Architecture',
    desc: 'React component tree: BrowserRouter → AppShell → panels → 80+ pages. Zustand stores (useUiStore, useCurrentSymbolStore) + TanStack Query for server state. Routes: /:area/:view, /research/symbol/:symbolId, /.',
    code: `flowchart TB
    A[BrowserRouter] --> B[AppShell]
    B --> C[TopBar]
    B --> D[LeftRail]
    B --> E[MainStage]
    B --> F[RightRail]
    B --> G[Footer]
    E --> H[Breadcrumbs]
    E --> I[ErrorBoundary]
    I --> J[renderMainContent]
    J --> K[80+ Page Components]
    subgraph State["Client State (Zustand)"]
        L[useUiStore<br/>theme, devOverlay, bookmarks]
        M[useCurrentSymbolStore]
        N[featureFlags<br/>localStorage]
    end
    subgraph Data["Server State (TanStack Query)"]
        O[apiGet / apiPost]
        P[NestJS API :3201]
    end
    subgraph Routes["Route Structure"]
        Q[/:area/:view]
        R[/research/symbol/:symbolId]
        S[/ → HomeDashboard]
    end
    D --> T[NAV_TREE Config<br/>15 areas]
    F --> U[Area Nav]
    G --> V[Dev Overlay<br/>flags + log + info]
    O --> P
    B --> W[PwaInstallPrompt]
    B --> X[ApiOfflineBanner]`,
  },
  {
    id: 'deployment',
    label: 'Deployment & Infrastructure',
    desc: 'Local development infrastructure: WAMP (Apache + MySQL), NestJS with Prisma + BullMQ, Vite PWA, MT5 Python bridge, Redis queue, Intranet task runner (PHP on Apache), and Google Drive documentation. NestJS also acts as process manager (ServerControlsPage → /api/processes). GitHub Actions CI runs on push to master.',
    code: `flowchart TB
    subgraph Frontend["Frontend :5173"]
        A[Vite + React 18 PWA]
        B[TanStack Query + Zustand]
        C[ServerControlsPage]
    end
    subgraph Backend["NestJS :3201"]
        D[API /api prefix]
        E[46 Modules]
        F[Prisma ORM]
        G[Swagger /docs]
        H[Process Manager<br/>/api/processes]
        I[BullMQ Workers]
    end
    subgraph WAMP["WAMP Stack :80"]
        J[Apache + PHP 8.x]
        K[(MySQL — Prisma datasource)]
        L[Intranet /intranet<br/>api-tasks.php]
    end
    subgraph Queue["Redis :6379"]
        M[Memurai / Redis]
        N[QUEUE_MODE=local]
    end
    subgraph Bridge["MT5 Bridge :5000"]
        O[Python Flask]
        P[MetaTrader 5]
    end
    subgraph Docs["Google Drive"]
        Q[DOCUMENTATION-INDEX.md]
        R[.agenticmemory/SPRINT.md]
    end
    subgraph CI["GitHub Actions"]
        S[ci.yml — build + lint]
        T[Frontend + Backend jobs]
    end
    A -->|/api proxy| D
    A -->|/intranet proxy| L
    C -->|start/stop| H
    D --> F --> K
    I --> M
    D -->|POST /order| O
    O --> P
    L -->|start/stop services| H
    style Queue fill:#1a1a2e,stroke:#ef4444,color:#e5e7eb
    style CI fill:#1a1a2e,stroke:#3b82f6,color:#e5e7eb`,
  },
  {
    id: 'activation-gate',
    label: 'Activation Gate & Conditions',
    desc: 'Pre-scoring condition detection: ConditionDetectorService produces a ConditionVector (regime, hurst, ADX, ATR percentile, session, preEvent). DirectivesService.evaluateGate() checks each directive\'s SuitabilityProfile (90+ entries) against the vector. Outcomes: muted (score=0 in live), or weight-reduced (−30% regime/volatility, −50% session mismatch). Demo mode reduces weight instead of muting.',
    code: `flowchart TB
    subgraph Input["Market Data (DirectiveInput)"]
        A[Price Bars<br/>highs, lows, closes]
        B[Symbol + Timeframe]
    end
    subgraph Detector["ConditionDetectorService.detect()"]
        C[ADX 14-period<br/>Wilder smoothing]
        D[Hurst Exponent<br/>lag-1 autocorrelation proxy]
        E[ATR Percentile<br/>90-period distribution]
        F[Session Classifier<br/>US · London · Asian · off-hours]
        G[Ensemble Score<br/>0.40×Hurst + 0.35×ADX + 0.25×Vol]
    end
    subgraph Vector["ConditionVector"]
        H[regime: trending · ranging · chaotic]
        I[regimeStrength: 0–1]
        J[volatility: low · normal · high]
        K[activeSession: US · London · Asian · off-hours]
        L[adx + atrPercentile + hurstExponent]
        M[preEvent: boolean<br/>within 30min of FOMC]
    end
    subgraph Gate["evaluateGate() in DirectivesService"]
        N[Suitability Registry<br/>90+ directives]
        O{Regime match?}
        P{Volatility match?}
        Q{Session match?}
    end
    subgraph Outcomes["Gate Outcomes"]
        R[MUTED score=0<br/>regime mismatch in live mode]
        S[REDUCED −30%<br/>volatility mismatch]
        T[REDUCED −50%<br/>session mismatch]
        U[PASS weight=1.0<br/>all conditions match]
    end
    A --> C
    A --> D
    A --> E
    B --> F
    C --> G
    D --> G
    E --> G
    G --> H
    G --> I
    E --> J
    F --> K
    C --> L
    D --> L
    E --> L
    H --> O
    J --> P
    K --> Q
    N --> O
    N --> P
    N --> Q
    O -->|mismatch live| R
    O -->|match or demo| P
    P -->|mismatch| S
    P -->|match| Q
    Q -->|mismatch| T
    Q -->|match| U
    U --> SCORING[Directive calculate]
    S --> SCORING
    T --> SCORING
    style R fill:#ef4444,color:#fff
    style S fill:#f59e0b,color:#000
    style T fill:#f59e0b,color:#000
    style U fill:#22c55e,color:#000`,
  },
  {
    id: 'exit-signals',
    label: 'Exit Signal System',
    desc: '5 exit-focused directives contribute scores to the composite — they do NOT trigger position closes automatically. Exit monitoring is planned but not yet automated. These directives run alongside entry directives in the same scoring pipeline.',
    code: `flowchart TB
    subgraph Market["Market Data (same DirectiveInput)"]
        A[Price Bars<br/>closes, highs, lows]
        B[Volume]
        C[ATR 14-period]
    end
    subgraph ExitDirectives["Exit Directives (5)"]
        F[momentum-exhaustion<br/>P65 maxScore=100<br/>bias: bullish]
        G[target-achieved<br/>P60 maxScore=100<br/>bias: bullish]
        H[regime-shift-exit<br/>P80 maxScore=100<br/>bias: neutral]
        I[time-stop<br/>P50 maxScore=100<br/>bias: neutral]
        J[chandelier-exit<br/>P64 maxScore=100<br/>bias: neutral]
    end
    subgraph Logic["Scoring Logic"]
        K[RSI >= 70 + vol declining<br/>score 65-95]
        L[Price > swingLow + 1.5xATR<br/>score 60-100]
        M[Entropy spike > 25%<br/>score 70-100]
        N[Momentum decay > 2%<br/>score 40-80]
        O[Price below highest22 - 3xATR<br/>score 25 bearish]
    end
    subgraph Output["Output (scores only)"]
        P[Scores feed into<br/>composite via protocol groups]
        Q[signalClass: bullish/bearish/neutral]
        R[No automated close<br/>planned, not built]
    end
    A --> K --> F
    B --> K
    A --> L
    C --> L
    L --> G
    A --> M --> H
    A --> N --> I
    A --> O
    C --> O
    O --> J
    F --> P
    G --> P
    H --> P
    I --> P
    J --> P
    P --> Q
    Q -.-> R
    style R fill:#1a1a2e,stroke:#f59e0b,stroke-dasharray:5 5,color:#f59e0b`,
  },
  {
    id: 'alert-center',
    label: 'Alert Center Architecture',
    desc: 'AlertTriggerService polls 9 conditions every 60s with per-trigger cooldowns. AlertsService stores up to 200 alerts in-memory (no DB). 8 pre-configured AlertConfigs with throttle settings. Frontend polls /api/alerts/active every 30s via TanStack Query. 3 categories: system, data, trading.',
    code: `flowchart TB
    subgraph Triggers["AlertTriggerService (60s poll)"]
        A[mt5-disconnected<br/>critical · 120s cooldown]
        B[provider-degraded<br/>high · 600s cooldown]
        C[data-staleness<br/>warning · 600s cooldown]
        D[position-pnl<br/>warning · 300s cooldown]
        E[margin-utilization<br/>high · 300s cooldown]
        F[market-close<br/>info · 900s cooldown]
        G[weekend-gap-risk<br/>warning · 3600s cooldown]
        H[earnings-proximity<br/>info · 7200s cooldown]
        I[swap-accrual<br/>warning · 3600s cooldown]
    end
    subgraph Service["AlertsService (in-memory)"]
        J[addAlert]
        K[200 alert max]
        L[8 AlertConfigs<br/>channels + throttle]
    end
    subgraph Severity["4 Severity Levels"]
        M[🔴 critical]
        N[🟠 high]
        O[🟡 warning]
        P[🔵 info]
    end
    subgraph Lifecycle["Lifecycle"]
        Q[active]
        R[acknowledged]
        S[dismissed]
        T[snoozed<br/>configurable minutes]
    end
    subgraph API["Controller /api/alerts"]
        U[GET /active]
        V[GET /history]
        W[GET /count]
        X[POST /:id/acknowledge]
        Y[POST /:id/dismiss]
        Z[POST /:id/snooze]
    end
    subgraph UI["Frontend (30s refetch)"]
        AA[AlertCenterPage]
        AB[Badge Counter]
    end
    A & B & C & D & E & F & G & H & I --> J
    J --> K
    J --> M & N & O & P
    Q --> R
    Q --> T
    T -->|expires| Q
    R --> S
    U --> AA
    W --> AB
    style Triggers fill:#1a1a2e,stroke:#ef4444,color:#e5e7eb
    style Service fill:#1a1a2e,stroke:#3b82f6,color:#e5e7eb`,
  },
  {
    id: 'calibration',
    label: 'Calibration Pipeline',
    desc: 'Symbol-specific weight overrides applied in ScoringService between directive calculation and aggregation. 16 seeded calibrations (DOGEUSD, XAUUSD, NVDA, BTCUSD, EURUSD, TECH100). Only weightMultiplier is applied (decayModifier and volatilityAdjustment are stored but not yet used in scoring logic). Formula: adjustedScore = min(100, round(raw × multiplier)).',
    code: `flowchart TB
    subgraph Input["Raw Directive Scores"]
        A[news-sentiment: 45]
        B[rsi-oversold: 72]
        C[volume-surge: 60]
        D[earnings-proximity: 30]
    end
    subgraph Load["CalibrationService (OnModuleInit)"]
        E[(SymbolCalibration<br/>DB Table)]
        F[Memory Cache<br/>Map symbol:directiveId → multiplier]
    end
    subgraph Apply["applyCalibrations(symbol, results)"]
        G[Lookup multiplier<br/>flatCache.get symbol:directiveId]
        H[adjusted = min 100<br/>round raw × multiplier]
    end
    subgraph Seeded["16 Seeded Calibrations"]
        I[DOGEUSD: news-sentiment 3.0x<br/>volume-surge 1.5x · panic-exhaustion 2.0x]
        J[XAUUSD: news-sentiment 1.5x<br/>rsi-oversold 0.7x]
        K[NVDA: earnings-proximity 2.5x<br/>momentum-roc 1.3x · volume 1.2x · news 1.8x]
        L[BTCUSD: session-timing 0.6x<br/>volume-surge 1.4x · entropy 1.2x]
        M[EURUSD: session-timing 1.3x<br/>ema-structure 1.1x]
        N[TECH100: momentum-roc 1.3x<br/>volume-surge 1.2x]
    end
    subgraph Output["Output"]
        O[adjustedScores Map]
        P[applied Array<br/>directiveId + multiplier + reason]
        Q[Fed into ScoringService<br/>breakdown building]
    end
    subgraph Planned["Stored but not yet used"]
        R[decayModifier]
        S[volatilityAdjustment]
    end
    E --> F
    A & B & C & D --> G
    F --> G
    G --> H
    H --> O
    H --> P
    O --> Q
    style Planned fill:#1a1a2e,stroke:#f59e0b,stroke-dasharray:5 5,color:#f59e0b`,
  },
  {
    id: 'scoring-gating',
    label: 'Scoring with Protocol Gating',
    desc: 'ProtocolGatingService.scoreWithGating(): Run all directives → group by protocol → compute group % (rawSum/maxSum×100) → weighted combine (Tech×0.40 + Sent×0.35) → RiskGatingEngine applies tiered rules (hard gates veto, soft modifiers compound, regime overrides). Floor at 0.5× cumulative. Output: composite 0-100, signal BUY/HOLD/SELL, rarity band.',
    code: `flowchart TB
    subgraph Directives["1. Run All Directives"]
        A[DirectivesService.runAll]
        B[Activation Gate filters]
        C[Time window checks]
    end
    subgraph Groups["2. Group by Protocol"]
        D[Technical group<br/>groupPct = rawSum/maxSum × 100]
        E[Sentiment group<br/>groupPct = rawSum/maxSum × 100]
        F[Risk group<br/>breakouts extracted]
    end
    subgraph Combine["3. Weighted Combine"]
        G[rawBeforeRisk =<br/>tech% × 0.40 + sent% × 0.35]
    end
    subgraph RiskEngine["4. RiskGatingEngine.apply()"]
        H{Hard Gate?<br/>budget-gate · position-concentration<br/>· liquidity-check}
        I[Soft Modifiers<br/>correlation-drag · dilution-impact<br/>· volatility-regime]
        J[Regime Override<br/>dxy-regime → directional bias]
        K[Cascading multiply<br/>floor at 0.5×]
    end
    subgraph Output["5. Output"]
        L[composite = clamp 0-100]
        M{signal?}
        N[🟢 BUY ≥ 65]
        O[🟡 HOLD ≥ 35]
        P[🔴 SELL < 35 SHORT_ONLY]
        Q[Rarity Band<br/>from ScoreSnapshot history]
    end
    A --> B --> C
    C --> D & E & F
    D --> G
    E --> G
    F --> H
    G --> H
    H -->|severity ≥ 0.8| VETO[score = 0<br/>HARD GATE]
    H -->|pass| I
    I --> K
    J --> K
    K --> L
    L --> M
    M --> N & O & P
    L --> Q
    style VETO fill:#ef4444,color:#fff
    style RiskEngine fill:#1a1a2e,stroke:#ef4444,color:#e5e7eb
    style N fill:#22c55e,color:#000
    style O fill:#f59e0b,color:#000
    style P fill:#ef4444,color:#fff`,
  },
  {
    id: 'provider-adapters',
    label: 'Provider Adapter Architecture',
    desc: '8 registered adapters via AdapterFactory (Binance, Trading212, MT5, Polygon, Finnhub [disabled], FMP, Twelve Data, Yahoo). Rate-limit-aware selection picks highest-headroom provider. RateLimitGovernor + ProviderDegradationService + CryptoProviderRouter. FRED/ECB/Alpaca adapters exist as files but are not registered.',
    code: `flowchart TB
    subgraph Registered["Registered Adapters (8)"]
        A[Binance pri=15<br/>crypto primary, no auth]
        B[Trading212 pri=30<br/>quotes, candles, trades]
        C[MT5 pri=40<br/>quotes, candles, trades]
        D[Polygon pri=45<br/>quotes, candles, profiles]
        E[Finnhub pri=50<br/>DISABLED — key expires]
        F[FMP pri=50<br/>quotes, candles, fundamentals]
        G[Twelve Data pri=55<br/>quotes, candles]
        H[Yahoo pri=60<br/>no auth, quotes, candles]
    end
    subgraph Unregistered["Adapter Files (not registered)"]
        I[Alpaca]
        J[FRED]
        K[ECB]
    end
    subgraph Factory["AdapterFactory"]
        L[register id, ctor, config]
        M[create id → cached instance]
        N[getActive preferredId?<br/>rate-limit-aware selection]
        O[getBrokerageAdapters]
    end
    subgraph RateLimit["Rate Limiting"]
        P[RateLimitTracker<br/>per-adapter state]
        Q[RateLimitGovernor<br/>global coordination]
        R[Skip if tripped or < 5 remaining]
        S[Sort by remaining DESC]
    end
    subgraph Degradation["ProviderDegradationService"]
        T[Track provider status<br/>healthy · degraded · failed]
        U[Notify on state change]
    end
    subgraph API["Controller /api/providers"]
        V[GET /health]
        W[GET /rate-limits]
        X[GET /degradation]
        Y[GET /governor]
        Z[GET /test/:provider/:symbol]
    end
    A & B & C & D & E & F & G & H --> L
    L --> M --> N
    N --> P --> R --> S
    Q --> P
    T --> U
    style E fill:#ef4444,color:#fff
    style Unregistered fill:#1a1a2e,stroke:#f59e0b,stroke-dasharray:5 5,color:#f59e0b`,
  },
  {
    id: 'automation-orchestration',
    label: 'Automation & Protocol Orchestration',
    desc: 'Planned multi-protocol automation system. Protocol Scheduler dispatches scoring runs through a rate-limit-aware cache that deduplicates Finnhub/T212 API calls. ProtocolRunner executes parallel pipelines, results stream to a dashboard (stack view / grid view). SEES ranks all symbols scored across protocols.',
    code: `flowchart TB
    subgraph Scheduler["Protocol Scheduler"]
        A[Cron / Manual Trigger]
        B[Symbol Batcher]
        C[Rate-Limit Guard]
    end
    subgraph Cache["Rate-Limit-Aware Cache"]
        D[(Symbol Data Cache<br/>TTL: 60s)]
        E[Finnhub Throttle<br/>60 calls/min]
        F[T212 Throttle<br/>per-symbol dedup]
    end
    subgraph Runner["Multi-Protocol Runner"]
        G[Protocol A<br/>Momentum/Short-Term]
        H[Protocol B<br/>Mean Reversion]
        I[Protocol C<br/>Swing/Long-Term]
        J[Protocol N...]
    end
    subgraph Scoring["Parallel Scoring"]
        K[Directive Execution]
        L[Condition Detection]
        M[Activation Gate]
        N[Calibration Overrides]
    end
    subgraph SEES["SEES Ranker"]
        O[Composite Score<br/>per protocol]
        P[Cross-Protocol Ranking]
        Q[Top Symbols Sorted]
    end
    subgraph Dashboard["Automation Dashboard"]
        R[Stack View<br/>running protocols]
        S[Grid View<br/>symbol scores]
        T[Execution Queue<br/>queue/complete/failed]
    end
    subgraph Actions["Decision Layer"]
        U[Alerts & Notifications]
        V[Trade Execution<br/>MT5 / T212]
        W[Position Monitor]
    end

    A --> B --> C --> D
    D --> E
    D --> F
    D --> G
    D --> H
    D --> I
    D --> J
    G --> K
    H --> K
    I --> K
    J --> K
    K --> L --> M --> N --> O
    O --> P --> Q
    Q --> R
    Q --> S
    Q --> T
    T --> U --> V --> W`,
  },
  {
    id: 'speed-scanner',
    label: 'Speed Trading — Best Symbol Scanner',
    desc: 'On-demand batch scanner via POST /api/speed/scan. 23 default symbols scored against their mapped protocol (60+ symbol→protocol entries in SYMBOL_PROTOCOL_MAP). Includes MicroTrendDetector analysis and seasonal affinity multiplier. Route-to-trade supports quick-trade (confirm), one-click (execute), and automation (create strategy) modes.',
    code: `flowchart TB
    subgraph Trigger["Scan Trigger (on-demand)"]
        A[POST /api/speed/scan]
        B[Frontend button / interval]
    end
    subgraph Symbols["DEFAULT_SPEED_SYMBOLS (23)"]
        C[XAUUSD · BTCUSD · EURUSD · GBPUSD]
        D[USDJPY · USOIL · ETHUSD · SPX500]
        E[TECH100 · VIX · AUDUSD · NZDUSD]
        F[USDCAD · USDCHF · SPY · QQQ]
        G[TSLA · DOGEUSD · DJI30 · UK100...]
    end
    subgraph Scanner["SpeedScanService.scan()"]
        H[SYMBOL_PROTOCOL_MAP<br/>60+ symbol→protocol entries]
        I[Fetch bars per symbol<br/>5s → fallback 1d]
        J[Higher TF bars<br/>1d · 1h · 15m]
        K[ProtocolGatingService.scoreWithGating]
        L[SeasonalAffinityService<br/>multiply composite]
        M[MicroTrendDetector.analyze<br/>ADX · clarity · direction · patterns]
        N[Rank by composite DESC]
    end
    subgraph Output["ScanResult"]
        O[topPick + topPickTrend]
        P[nextBestSymbol]
        Q[scan: SymbolScore array]
        R[skipped: reason per symbol]
    end
    subgraph Trade["Route-to-Trade (POST /api/speed/trade)"]
        S[quick-trade → confirm UI]
        T[one-click → MT5 execute]
        U[automation → create TradingStrategy]
    end
    A --> H
    B --> A
    C & D & E & F & G --> I
    I --> J --> K
    K --> L --> M --> N
    N --> O & P & Q & R
    O --> S & T & U
    style Trade fill:#1a1a2e,stroke:#22c55e,color:#e5e7eb`,
  },
  {
    id: 'protocol-calendar',
    label: 'Protocol Calendar — Seasonal Prioritization',
    desc: 'SeasonalAffinityService applies date-driven weight adjustments to protocol composite scores. Each protocol declares a seasonalAffinity with monthly weights (0-11) and optional dateRanges (take precedence). Formula: adjustedScore = baseScore × (1 + weight). Weight range: -1.0 to +1.0. Used by ScoringService.rankAll() and SpeedScanService.scan(). 20+ protocols have seasonal affinity defined across 32 total protocols.',
    code: `flowchart TB
    subgraph Input["Date Input"]
        A[Current Date]
        B[month: 0-11]
        C[day: 1-31]
    end
    subgraph Lookup["SeasonalAffinityService.getAffinity()"]
        D[PROTOCOL_REGISTRY lookup]
        E{dateRanges defined?}
        F{Date in range?}
        G[Use dateRange weight<br/>takes precedence]
        H[Use monthly weight<br/>affinity.monthly month]
        I[No affinity defined<br/>weight = 0]
    end
    subgraph Formula["Multiplier Calculation"]
        J[multiplier = 1.0 + weight]
        K[adjustedScore =<br/>baseScore × multiplier]
    end
    subgraph DateRanges["Date Range Overrides (examples)"]
        L[Santa Claus Rally<br/>Dec 24 → Jan 2: +0.20]
        M[Pre-halving rally<br/>Apr 15 → Jun 15: +0.10]
        N[Summer driving season<br/>Jun 1 → Sep 30: +0.10]
        O[Sep/Oct vol season<br/>Sep 1 → Oct 31: +0.15]
        P[Chinese New Year<br/>Jan 20 → Feb 15: −0.10]
    end
    subgraph Monthly["Monthly Weights (June examples)"]
        Q[oil-speed-v1: +0.15]
        R[spy-day-v1: −0.10]
        S[btc-scalp-v1: −0.05]
        T[momentum-stock-v1: −0.10]
        U[xau-speed-v1: −0.10]
        V[leverage-v2: −0.10]
    end
    subgraph Consumers["Consumers"]
        W[ScoringService.rankAll<br/>seasonal weight on composite]
        X[SpeedScanService.scan<br/>seasonal weight on scan results]
    end
    A --> B & C
    B --> D
    C --> D
    D --> E
    E -->|yes| F
    E -->|no| H
    F -->|yes| G
    F -->|no| H
    D -->|no seasonalAffinity| I
    G --> J
    H --> J
    I --> J
    J --> K
    K --> W & X
    style DateRanges fill:#1a1a2e,stroke:#8b5cf6,color:#e5e7eb
    style Formula fill:#1a1a2e,stroke:#22c55e,color:#e5e7eb
    style I fill:#64748b,color:#fff`,
  },
  {
    id: 'seasonality-heatmap',
    label: 'Seasonality Heatmap — Hour x Day Win Rates',
    desc: 'SeasonalityService computes a 7×24 grid of bullish win rates from MT5 1m candles (2000 bar limit). Fetches via NestJS proxy to MT5 bridge. Frontend: SeasonalityHeatmapPage at /analysis/seasonality-heatmap with TanStack Query, color-coded grid, tooltip, and legend. Note: session-timing-filter directive is independent — it uses hardcoded session quality values, not this heatmap data.',
    code: `flowchart TB
    subgraph Data["Data Source"]
        A[GET /api/trading/mt5/candles<br/>symbol + timeframe=1m + limit=2000]
        B[NestJS proxy → MT5 Bridge :5001]
    end
    subgraph Compute["SeasonalityService.compute()"]
        C[Parse bar timestamps]
        D[Group by UTC day 0-6<br/>× UTC hour 0-23]
        E[Count bullish: close > open]
        F[Win rate = bullish / samples<br/>per cell, rounded to 2dp]
    end
    subgraph Output["SeasonalityResult"]
        G[heatmap: number 7x24<br/>0.0 to 1.0 per cell]
        H[samples: number 7x24<br/>count per cell]
        I[totalBars + computedAt]
    end
    subgraph API["Controller"]
        J[GET /api/speed/seasonality/:symbol]
    end
    subgraph UI["SeasonalityHeatmapPage"]
        K[Symbol input + Analyse button]
        L[7×24 color grid<br/>green >=70% · red <=30%]
        M[Tooltip: day, hour, %, samples]
        N[Best/Worst cell summary]
        O[Legend: bearish → bullish]
    end
    subgraph Independent["Separate System"]
        P[session-timing-filter directive<br/>hardcoded session quality<br/>US=0.9 London=0.8 Asian=0.4]
    end
    A --> B --> C
    C --> D --> E --> F
    F --> G & H & I
    G --> J --> K
    K --> L & M & N & O
    style Independent fill:#1a1a2e,stroke:#64748b,stroke-dasharray:5 5,color:#94a3b8`,
  },
  {
    id: 'provider-failover',
    label: 'Provider Failover & Rate Limiting',
    desc: 'AdapterFactory.getActive() uses rate-limit-aware selection across 8 registered providers (Finnhub disabled). RateLimitTracker per adapter: circuit breaker trips after 3 consecutive 429s for 2min cooldown. isUsable() = !tripped && remaining > 0. Selection: collect usable instances → sort by remaining DESC → pick highest headroom. Only falls back to failoverPriority order when no instances are cached.',
    code: `flowchart TB
    subgraph Request["getActive(preferredId?)"]
        A[Incoming data request]
    end
    subgraph Preferred["1. Preferred Check"]
        B{preferredId provided?}
        C[create preferredId]
        D{Instance created?}
    end
    subgraph Selection["2. Rate-Limit-Aware Selection"]
        E[Scan all cached instances]
        F{tracker.isUsable?<br/>!tripped AND remaining > 0}
        G[Skip provider]
        H[Add to candidates<br/>with remaining count]
        I[Sort candidates by<br/>remaining DESC]
        J[Pick highest headroom]
    end
    subgraph Fallback["3. Registry Priority Fallback"]
        K[No cached instances usable]
        L[Sort registry by<br/>failoverPriority ASC]
        M[Try create in order<br/>until one succeeds]
    end
    subgraph CircuitBreaker["RateLimitTracker"]
        N[recordResponse status, headers]
        O{status === 429?}
        P[consecutive429s++]
        Q{>= 3 consecutive?}
        R[TRIP for 2min<br/>tripped=true]
        S[Reset consecutive429s]
        T[Parse ratelimit-remaining header]
    end
    subgraph Registered["8 Registered (failoverPriority)"]
        U[Binance pri=15]
        V[Trading212 pri=30]
        W[MT5 pri=40]
        X[Polygon pri=45]
        Y[Finnhub pri=50 DISABLED]
        Z[FMP pri=50]
        AA[TwelveData pri=55]
        AB[Yahoo pri=60]
    end
    A --> B
    B -->|yes| C --> D
    D -->|yes| RETURN[Return adapter]
    D -->|no| E
    B -->|no| E
    E --> F
    F -->|no| G
    F -->|yes| H
    H --> I --> J --> RETURN
    G -.->|all skipped| K
    K --> L --> M --> RETURN
    N --> O
    O -->|yes| P --> Q
    Q -->|yes| R
    Q -->|no| G
    O -->|no| S --> T
    style R fill:#ef4444,color:#fff
    style Y fill:#ef4444,color:#fff
    style RETURN fill:#22c55e,color:#000
    style CircuitBreaker fill:#1a1a2e,stroke:#f59e0b,color:#e5e7eb`,
  },
  {
    id: 't212-portfolio-flow',
    label: 'Trading212 Portfolio Data Flow',
    desc: 'Trading212ImportService fetches positions from live.trading212.com/api/v0 (equity/portfolio + equity/account/cash). Ticker normalization via cleanT212Ticker() (strips _US_EQ, _EQ, handles modifiers). Positions persisted to Position table (delete stale + insert fresh). Separate /scores endpoint integrates with ScoringService. Frontend PortfolioPage queries /api/portfolio/trading212/mode, /api/portfolio/holdings, /api/portfolio/scores. Also supports order execution (buy/sell/cancel) with pre-trade safety gates.',
    code: `flowchart TB
    subgraph External["Trading212 API"]
        A[GET equity/account/cash<br/>balance, free, invested, ppl]
        B[GET equity/portfolio<br/>positions array]
        C[GET equity/orders<br/>filled orders for history]
    end
    subgraph Controller["Trading212PortfolioController<br/>/api/portfolio/trading212"]
        D[POST /import]
        E[GET /validate]
        F[GET /history?days=N]
        G[POST /orders/buy]
        H[POST /orders/sell]
        I[POST /close-profitable]
        J[GET /mode]
    end
    subgraph Service["Trading212ImportService"]
        K[importPortfolio]
        L[cleanT212Ticker<br/>strip _US_EQ, _EQ, modifiers]
        M[Upsert Symbol in DB]
        N[Delete stale Position rows<br/>provider=trading212]
        O[Insert fresh positions]
    end
    subgraph Execution["Order Execution"]
        P[validatePreTrade<br/>account + position + funds gates]
        Q[Trading212Adapter<br/>placeMarketOrder / placeLimitOrder]
        R[TradeRecorderService<br/>audit trail to DB]
    end
    subgraph Scoring["Portfolio Scoring"]
        S[GET /api/portfolio/scores]
        T[PortfolioService.getPortfolioScores]
        U[ScoringService integration]
    end
    subgraph UI["Frontend (PortfolioPage)"]
        V[GET /api/portfolio/trading212/mode]
        W[GET /api/portfolio/holdings]
        X[GET /api/portfolio/scores]
        Y[Position table + P&L + signals]
    end
    A --> K
    B --> K
    C --> F
    D --> K
    K --> L --> M
    K --> N --> O
    G --> P --> Q --> R
    H --> P
    I --> Q
    S --> T --> U
    V & W & X --> Y
    style Execution fill:#1a1a2e,stroke:#22c55e,color:#e5e7eb
    style External fill:#1a1a2e,stroke:#3b82f6,color:#e5e7eb`,
  },
  {
    id: 'earnings-pipeline',
    label: 'Earnings Calendar Data Pipeline',
    desc: 'EarningsService.importCalendar() fetches from Alpha Vantage EARNINGS_CALENDAR (single source, single API call for all symbols). Upserts to EarningsEvent table by symbol+reportDate. Staleness check: >7 days since last fetch triggers auto-import. Two directives consume: earnings-proximity (reads earningsDate from DirectiveInput, mock-first) and earnings-momentum (reads EarningsEvent directly from DB via Prisma). Frontend calls /api/research/earnings/calendar (read from DB, zero API calls).',
    code: `flowchart TB
    subgraph Source["Data Source"]
        A[Alpha Vantage<br/>EARNINGS_CALENDAR endpoint<br/>single API call for all symbols]
    end
    subgraph Import["EarningsService.importCalendar()"]
        B[POST /api/earnings/import?horizon=3]
        C[ProvidersService.getAdapter alphavantage]
        D[getEarningsCalendar<br/>horizonMonths=3]
        E[Upsert by symbol+reportDate<br/>findFirst → update or create]
        F[Record to DataImportLog<br/>status, counts, duration]
    end
    subgraph Staleness["Auto-Refresh"]
        G[isStale: >7 days since last?]
        H[refreshIfStale on startup]
    end
    subgraph Storage["EarningsEvent Table"]
        I[(symbol, reportDate, epsEstimate<br/>epsActual, surprisePercent<br/>revenueEstimate, timeOfDay, source)]
    end
    subgraph Directives["Directive Consumers"]
        J[earnings-proximity<br/>reads input.earningsDate<br/>mock-first: score=45 if no data]
        K[earnings-momentum<br/>reads EarningsEvent via Prisma<br/>surprise + revision + recency]
    end
    subgraph ReadAPI["Read Endpoints (zero API calls)"]
        L[GET /api/earnings/calendar?days=90]
        M[GET /api/earnings/symbol/:symbol]
        N[GET /api/research/earnings/calendar<br/>frontend proxy]
    end
    subgraph UI["Frontend"]
        O[EarningsCalendarPage<br/>fetchEarningsCalendar via TanStack Query<br/>staleTime: 15min]
    end
    A --> C --> D
    B --> C
    D --> E --> I
    E --> F
    G --> H --> B
    I --> J
    I --> K
    I --> L & M & N
    N --> O
    style Staleness fill:#1a1a2e,stroke:#f59e0b,color:#e5e7eb
    style J fill:#1a1a2e,stroke:#64748b,color:#94a3b8`,
  },
  {
    id: 'data-flow-architecture',
    label: 'Data Flow Architecture',
    desc: 'End-to-end data flow from 8 registered providers through DataImportOrchestrator (freshness-triggered, demand-triggered, rate-limit aware) into normalized storage (70+ Prisma models). Directives consume DB data — only 1 directive (crypto-fear-greed) bypasses the DB with a direct API call. MacroSnapshot, SocialMention, InsiderTransaction models exist in schema but have zero usage.',
    code: `flowchart TB
    subgraph PROVIDER["🔌 PROVIDER LAYER (8 registered)"] 
        MT5["MT5 Bridge<br/>unlimited, candles+quotes"]
        BIN["Binance<br/>no auth, crypto"]
        T212["Trading212<br/>portfolio+trades"]
        POLY["Polygon<br/>quotes+candles"]
        FMP["FMP<br/>fundamentals"]
        TD["Twelve Data<br/>quotes+candles"]
        YAH["Yahoo<br/>no auth, fallback"]
        AV["Alpha Vantage<br/>earnings calendar"]
    end
    subgraph IMPORT["📥 IMPORT LAYER"]
        DIR["DataImportOrchestrator<br/>· Freshness-triggered<br/>· Demand-triggered<br/>· Rate-limit aware"]
        FRESH["FreshnessService<br/>overallFreshness per symbol"]
        PRICE["PriceRefreshService<br/>candle import"]
    end
    subgraph STORAGE["💾 STORAGE (70+ Prisma models)"]
        BARS["✅ MarketBar"]
        EARN["✅ EarningsEvent"]
        NEWS["✅ NewsArticle"]
        SCORE["✅ ScoreSnapshot"]
        TRADE["✅ Trade + Position + Order"]
        LOG["✅ DataImportLog"]
        MACRO["⚠️ MacroSnapshot<br/>schema only, zero usage"]
        MENTION["⚠️ SocialMention<br/>schema only, zero usage"]
        INSIDER["⚠️ InsiderTransaction<br/>schema only, zero usage"]
    end
    subgraph DIRECTIVE["🎯 DIRECTIVE LAYER (99+)"]
        GOOD["✅ 98 directives<br/>DB-only or bar input"]
        BAD["❌ 1 directive<br/>crypto-fear-greed<br/>calls fetch directly"]
    end
    subgraph PROTOCOL["📊 PROTOCOL LAYER"]
        PG["32 Protocols<br/>PROTOCOL_REGISTRY"]
        DEGRAD["✅ ProviderDegradationService<br/>healthy · degraded · failed"]
    end
    subgraph STRATEGY["⚡ STRATEGY LAYER"]
        TS["TradingStrategy + ScoringStrategy"]
        AL["Automation Loop"]
        SFRESH["✅ FreshnessService<br/>stale check before scoring"]
    end
    subgraph UI["🖥 PRESENTATION"]
        DE["80+ React pages"]
        CM["Capability Map"]
    end
    PROVIDER --> DIR
    DIR --> FRESH
    FRESH --> PRICE
    PRICE --> BARS
    DIR --> EARN
    DIR --> NEWS
    DIR --> LOG
    BARS --> GOOD
    EARN --> GOOD
    NEWS --> GOOD
    BAD -.->|"❌ bypasses DB"| PROVIDER
    GOOD --> PG
    BAD --> PG
    PG --> TS
    TS --> AL
    AL --> TRADE
    SCORE --> UI
    TRADE --> UI
    style BAD fill:#ef4444,color:#fff
    style MACRO fill:#f59e0b,color:#000
    style MENTION fill:#f59e0b,color:#000
    style INSIDER fill:#f59e0b,color:#000`,
  },
  {
    id: 'mt5-execution',
    label: 'MT5 Execution Pipeline',
    desc: 'Full trace from automation tick through scoring, evaluation, safety gates, bridge, to MT5 order execution. 36 decision gates across 20 files.',
    code: `flowchart TD
    TICK["Automation Tick 5-min"] --> SCORE["Scoring Pipeline 99 Directives"]
    SCORE --> RANK["Ranked Symbols score/signal"]

    RANK --> G1{"Score below threshold?"}
    G1 -->|yes| SKIP1["SKIP"]
    G1 -->|no| G2{"Cooldown active?"}
    G2 -->|yes| SKIP2["SKIP"]
    G2 -->|no| G3{"Duplicate position?"}
    G3 -->|yes| BLOCK["BLOCKED"]
    G3 -->|no| G4{"Mode = auto?"}
    G4 -->|semi-auto| QUEUE["QUEUED needs confirm"]
    G4 -->|auto| EVAL["StrategyService.evaluate"]

    EVAL --> G5{"Symbol in DB?"}
    G5 -->|no| F1["SKIP no symbol"]
    G5 -->|yes| G6{"30+ bars?"}
    G6 -->|no| F2["SKIP no data"]
    G6 -->|yes| DIR["Run Directives Gated Scoring"]
    DIR --> G7{"composite >= min?"}
    G7 -->|no| F3["SKIP score low"]
    G7 -->|yes| G8{"Rarity band OK?"}
    G8 -->|no| F4["SKIP rarity"]
    G8 -->|yes| EXEC["StrategyService.execute"]

    EXEC --> G9{"Manual mode?"}
    G9 -->|yes| LOG["LOG ONLY"]
    G9 -->|no| G10["Safety Gates"]
    G10 --> G11{"Size OK?"}
    G11 -->|no| F5["BLOCKED"]
    G11 -->|yes| G12{"Position limit?"}
    G12 -->|no| F6["BLOCKED"]
    G12 -->|yes| G13{"Daily loss?"}
    G13 -->|no| F7["BLOCKED"]
    G13 -->|yes| G14{"Risk OK?"}
    G14 -->|no| F8["BLOCKED"]
    G14 -->|yes| MT5["POST :5000/order"]

    MT5 --> B1{"Bridge up?"}
    B1 -->|no| F9["FAILED"]
    B1 -->|yes| B2{"MT5 connected?"}
    B2 -->|no| F10["FAILED"]
    B2 -->|yes| B3{"AutoTrading on?"}
    B3 -->|no| FAIL["AutoTrading disabled"]
    B3 -->|yes| B4{"Vol Spread Margin OK?"}
    B4 -->|no| REJ["REJECTED"]
    B4 -->|yes| TRADE["TRADE EXECUTED mt5.order_send"]

    style TRADE fill:#27ae60,color:#fff
    style FAIL fill:#c0392b,color:#fff
    style TICK fill:#8e44ad,color:#fff
    style SCORE fill:#2980b9,color:#fff
    style RANK fill:#2980b9,color:#fff
    style EVAL fill:#2980b9,color:#fff
    style EXEC fill:#27ae60,color:#fff
    style MT5 fill:#e67e22,color:#fff`,
  },

  // ── MetaStack System ────────────────────────────────────

  {
    id: 'metastack-product',
    label: 'M.E.T.A. Product Hierarchy',
    desc: 'Trading Command Suite delivers SEES signals layered into M.E.T.A. (Modular Expert Trading Architecture). Each protocol now has dedicated LONG and SHORT variants — direction is encoded in protocol selection, not an API parameter.',
    code: `flowchart TB
    subgraph TCS["Trading Command Suite"]
        direction TB
        subgraph SEES["SEES — Signal Engine"]
            A["99+ Directives<br/>6 with directionBias<br/>bullish | bearish | neutral"]
            B["32 Protocols<br/>Each with directionMode:<br/>LONG_ONLY | SHORT_ONLY | BOTH"]
            C["Ranked Symbol Output<br/>Composite scores 0-100"]
            A --> B --> C
        end
        subgraph MS["M.E.T.A. — Modular Expert Trading Architecture"]
            direction TB
            subgraph ProtocolPair["Protocol Pair (LONG + SHORT)"]
                PL["🟢 LONG Protocol<br/>e.g. built-in-default<br/>directionMode: LONG_ONLY"]
                PS["🔴 SHORT Protocol<br/>e.g. built-in-short<br/>directionMode: SHORT_ONLY"]
            end
            D["📋 Watchlist<br/>What to trade"]
            E["🎯 Scoring Strategy<br/>Thresholds + Risk Params<br/>shortProtocolId for dual-direction"]
            F["📊 Trading Strategy<br/>Execution Rules<br/>Auto-selects LONG vs SHORT"]
            G["⭐ Performance Rating<br/>★★★★★ per MetaStack"]
            D --> ProtocolPair
            ProtocolPair --> E --> F --> G
        end
        C --> MS
    end

    style TCS fill:#0d1117,stroke:#3b82f6,color:#e5e7eb
    style SEES fill:#111827,stroke:#22c55e,color:#e5e7eb
    style MS fill:#111827,stroke:#f59e0b,color:#e5e7eb
    style ProtocolPair fill:#1a1a2e,stroke:#8b5cf6,color:#e5e7eb
    style A fill:#1e3a5f,color:#e5e7eb
    style B fill:#1e3a5f,color:#e5e7eb
    style C fill:#1e3a5f,color:#e5e7eb
    style PL fill:#22c55e,color:#000
    style PS fill:#ef4444,color:#fff
    style D fill:#5c3d0e,color:#e5e7eb
    style E fill:#5c3d0e,color:#e5e7eb
    style F fill:#5c3d0e,color:#e5e7eb
    style G fill:#f59e0b,color:#000`,
  },

  {
    id: 'metastack-rating',
    label: 'M.E.T.A. Rating Engine',
    desc: 'How each MetaStack earns a 0-100 composite rating from actual trade outcomes. Part of the Modular Expert Trading Architecture. Ratings normalize for runtime, penalize small samples, and fade with inactivity.',
    code: `flowchart LR
    subgraph Inputs["Trade Data"]
        A["Trade Records<br/>scoringStrategyId"]
    end
    subgraph Metrics["Raw Metrics"]
        B["Total PnL"]
        C["Win Rate<br/>wins / total"]
        D["Profit Factor<br/>grossProfit / grossLoss"]
        E["Max Drawdown<br/>peak - trough"]
        F["Runtime Hours<br/>first → last trade"]
    end
    subgraph Formula["Rating Formula"]
        G["Effectiveness Rate<br/>PnL / runtimeHours"]
        H["Confidence Factor<br/>clamp(trades/100, 0.1, 1.0)"]
        I["Recency Decay<br/>exp(-days/30)"]
        J["Consistency Factor<br/>1 - abs(winRate-0.5) × 0.3"]
        K["Composite Rating<br/>0-100"]
    end
    subgraph Bands["Star Bands"]
        L["★★★★★ Elite > 80"]
        M["★★★★☆ Strong > 60"]
        N["★★★☆☆ Average > 40"]
        O["★★☆☆☆ Weak > 20"]
        P["★☆☆☆☆ Untested ≤ 20"]
    end
    A --> B
    A --> C
    A --> D
    A --> E
    A --> F
    B --> G
    C --> J
    G --> K
    H --> K
    I --> K
    J --> K
    K --> L
    K --> M
    K --> N
    K --> O
    K --> P

    style Inputs fill:#1e3a5f,stroke:#3b82f6,color:#e5e7eb
    style Metrics fill:#1a1a2e,stroke:#6366f1,color:#e5e7eb
    style Formula fill:#1a1a2e,stroke:#8b5cf6,color:#e5e7eb
    style Bands fill:#1a1a2e,stroke:#f59e0b,color:#e5e7eb
    style A fill:#2563eb,color:#fff
    style B fill:#475569,color:#e5e7eb
    style C fill:#475569,color:#e5e7eb
    style D fill:#475569,color:#e5e7eb
    style E fill:#475569,color:#e5e7eb
    style F fill:#475569,color:#e5e7eb
    style G fill:#7c3aed,color:#fff
    style H fill:#7c3aed,color:#fff
    style I fill:#7c3aed,color:#fff
    style J fill:#7c3aed,color:#fff
    style K fill:#a855f7,color:#fff
    style L fill:#22c55e,color:#000
    style M fill:#4ade80,color:#000
    style N fill:#f59e0b,color:#000
    style O fill:#f97316,color:#000
    style P fill:#ef4444,color:#fff`,
  },

  {
    id: 'metastack-signature',
    label: 'M.E.T.A. Configuration Signature',
    desc: 'SHA-256 hash of MetaStack components detects configuration drift. When a watchlist symbol, protocol, or risk parameter changes, the signature changes — warning users that performance history may be stale.',
    code: `flowchart TB
    subgraph Components["MetaStack Components"]
        direction LR
        A["📋 Watchlist<br/>symbols JSON"]
        B["⚙️ Protocol<br/>protocolId"]
        C["🎯 Scoring<br/>threshold · SL% · TP% · size"]
        D["🏦 Broker<br/>brokerId"]
        E["🎛️ Mode<br/>manual | semi-auto | auto"]
    end
    subgraph Hash["Signature Generation"]
        F["JSON.stringify<br/>all components"]
        G["SHA-256 Hash<br/>first 16 chars"]
        H["Signature<br/>dab799be07b0b2e6"]
    end
    subgraph Detection["Change Detection"]
        I["Current Signature"]
        J["Last Persisted<br/>StackPerformance.signature"]
        K{"Match?"}
        L["✅ Performance<br/>history valid"]
        M["⚠️ Warning<br/>MetaStack changed<br/>since last trade"]
    end
    A --> F
    B --> F
    C --> F
    D --> F
    E --> F
    F --> G --> H
    H --> I
    J --> K
    I --> K
    K -->|yes| L
    K -->|no| M

    style Components fill:#1e3a5f,stroke:#3b82f6,color:#e5e7eb
    style Hash fill:#1a1a2e,stroke:#8b5cf6,color:#e5e7eb
    style Detection fill:#1a1a2e,stroke:#f59e0b,color:#e5e7eb
    style A fill:#475569,color:#e5e7eb
    style B fill:#475569,color:#e5e7eb
    style C fill:#475569,color:#e5e7eb
    style D fill:#475569,color:#e5e7eb
    style E fill:#475569,color:#e5e7eb
    style F fill:#7c3aed,color:#fff
    style G fill:#7c3aed,color:#fff
    style H fill:#a855f7,color:#fff
    style I fill:#2563eb,color:#fff
    style J fill:#2563eb,color:#fff
    style K fill:#f59e0b,color:#000
    style L fill:#22c55e,color:#000
    style M fill:#ef4444,color:#fff`,
  },

  {
    id: 'metastack-lifecycle',
    label: 'MetaStack Lifecycle',
    desc: 'A MetaStack from creation to rating to iteration. Dual-protocol (LONG + SHORT) scoring determines trade direction automatically. Fingerprints track when configuration drifts.',
    code: `flowchart TD
    A["✨ Create MetaStack<br/>Name + watchlist + protocol<br/>+ shortProtocolId + scoring + trading"] --> B["🔬 Test Phase<br/>Manual LONG/SHORT trading<br/>via Speed Scanner"]
    B --> C["🤖 Automation Phase<br/>ScoringStrategy enabled<br/>Dual-protocol: LONG vs SHORT"]
    C --> D["📊 Data Collection<br/>Trades accumulate<br/>scoringStrategyId recorded"]
    D --> E["⭐ Rating Computed<br/>GET /api/scoring/<br/>metastacks/ratings"]
    E --> F{"Satisfied with<br/>performance?"}
    F -->|yes| G["✅ Keep Running<br/>Monitor fingerprint<br/>for drift"]
    F -->|no| H["🔧 Tweak Parameters<br/>Adjust SL%, threshold,<br/>swap LONG/SHORT protocols"]
    H --> I{"Fingerprint<br/>changed?"}
    I -->|yes| J["⚠️ New fingerprint<br/>Performance history<br/>may not apply"]
    I -->|no| K["Same config<br/>Continue collecting<br/>data"]
    G --> L["🔄 Periodic Review<br/>Re-rate via API<br/>Compare stacks"]
    J --> D
    K --> D
    L --> F

    style A fill:#2563eb,color:#fff
    style B fill:#6366f1,color:#fff
    style C fill:#8b5cf6,color:#fff
    style D fill:#475569,color:#e5e7eb
    style E fill:#f59e0b,color:#000
    style F fill:#f59e0b,color:#000
    style G fill:#22c55e,color:#000
    style H fill:#f97316,color:#000
    style I fill:#f59e0b,color:#000
    style J fill:#ef4444,color:#fff
    style K fill:#22c55e,color:#000
    style L fill:#3b82f6,color:#fff`,
  },

  {
    id: 'protocol-direction',
    label: 'Protocol Direction Architecture',
    desc: 'Protocols encode trading direction via directionMode (LONG_ONLY | SHORT_ONLY | BOTH). The automation loop compares LONG vs SHORT scores to determine trade direction. No direction query parameter — direction is selected by choosing the right protocol.',
    code: `flowchart TB
    subgraph Registry["PROTOCOL_REGISTRY"]
        direction LR
        R1["built-in-default<br/>directionMode: LONG_ONLY<br/>groups: DIRECTIVE_GROUPS"]
        R2["built-in-short<br/>directionMode: SHORT_ONLY<br/>groups: SHORT_DIRECTIVE_GROUPS"]
        R3["mt5-technical-core-v1<br/>directionMode: LONG_ONLY"]
        R4["mt5-technical-short<br/>directionMode: SHORT_ONLY"]
    end

    subgraph Directives["Directive Filtering (protocol-gating.service.ts)"]
        D1["6 directives with directionBias"]
        D2["bullish (4): momentum-exhaustion, target-achieved, volume-surge, vwap"]
        D3["bearish (2): cci, williams-r"]
        D4["LONG_ONLY: exclude bearish directives"]
        D5["SHORT_ONLY: exclude bullish directives"]
        D1 --> D2
        D1 --> D3
        D2 --> D5
        D3 --> D4
    end

    subgraph Scoring["ScoringStrategy (DB)"]
        S1["protocolId: 'built-in-default'"]
        S2["shortProtocolId: 'built-in-short'"]
        S3["Dual-protocol scoring in automation loop"]
        S1 --> S3
        S2 --> S3
    end

    subgraph Decision["Trade Direction Decision"]
        T1["Score with LONG protocol"]
        T2["Score with SHORT protocol"]
        T3{"longScore > shortScore<br/>AND above threshold?"}        
        T4["🟢 BUY signal"]
        T5{"shortScore > longScore<br/>AND above threshold?"}
        T6["🔴 SELL signal"]
        T7["⚪ HOLD — both below threshold"]
        T1 --> T3
        T2 --> T5
        T3 -->|yes| T4
        T3 -->|no| T5
        T5 -->|yes| T6
        T5 -->|no| T7
    end

    Registry --> Directives --> Scoring --> Decision

    style Registry fill:#1e3a5f,stroke:#3b82f6,color:#e5e7eb
    style Directives fill:#1a1a2e,stroke:#8b5cf6,color:#e5e7eb
    style Scoring fill:#1a1a2e,stroke:#6366f1,color:#e5e7eb
    style Decision fill:#1a1a2e,stroke:#f59e0b,color:#e5e7eb
    style R1 fill:#22c55e,color:#000
    style R2 fill:#ef4444,color:#fff
    style R3 fill:#22c55e,color:#000
    style R4 fill:#ef4444,color:#fff
    style D1 fill:#7c3aed,color:#fff
    style D2 fill:#22c55e,color:#000
    style D3 fill:#ef4444,color:#fff
    style D4 fill:#475569,color:#e5e7eb
    style D5 fill:#475569,color:#e5e7eb
    style S1 fill:#22c55e,color:#000
    style S2 fill:#ef4444,color:#fff
    style S3 fill:#6366f1,color:#fff
    style T1 fill:#22c55e,color:#000
    style T2 fill:#ef4444,color:#fff
    style T3 fill:#f59e0b,color:#000
    style T4 fill:#22c55e,color:#000
    style T5 fill:#f59e0b,color:#000
    style T6 fill:#ef4444,color:#fff
    style T7 fill:#64748b,color:#fff`,
  },
  {
    id: 'adaptive-loop-timing',
    label: 'Adaptive Loop Timing',
    desc: 'Automation loop interval adapts to the fastest active protocol. Speed protocols (5s–30s bars) drive 15–30s ticks on a subset of symbols. Swing protocols (1h–1d bars) run at 5min on all symbols. Event-driven execution via webhooks provides an alternative to polling for price-threshold and candle-close triggers.',
    code: `flowchart TD
    subgraph Protocols["Active Protocols"]
        P1["speed-equity-v1<br/>5s bars ⚡"]
        P2["btc-scalp-v1<br/>30s bars ⚡"]
        P3["built-in-default<br/>15m bars 🕐"]
    end

    Protocols --> Check{"Fastest active<br/>protocol?"}

    Check -->|"5s–30s bars"| Fast["⏱ Fast Loop: 15–30s<br/>Score speed symbols only<br/>4–10 symbols, 8–12 directives"]
    Check -->|"15m+ bars only"| Slow["⏱ Standard: 5min<br/>Score all symbols<br/>All 100 directives"]

    Fast --> SpeedLoop["Speed Execution Loop"]
    Slow --> MainLoop["Main Automation Loop"]

    SpeedLoop --> Execute["Execute with tight SL/TP<br/>$1–$10 profit targets<br/>60s inter-trade throttle"]

    subgraph EventDriven["Event-Driven (Webhook)"]
        W1["Price threshold hit"]
        W2["Candle close"]
        W3["News event"]
    end

    EventDriven -->|"POST /api/webhooks/trading-signal"| SpeedLoop

    style P1 fill:#ef4444,color:#fff
    style P2 fill:#f59e0b,color:#000
    style P3 fill:#22c55e,color:#000
    style Fast fill:#7c3aed,color:#fff
    style Slow fill:#475569,color:#e5e7eb
    style SpeedLoop fill:#6366f1,color:#fff
    style MainLoop fill:#475569,color:#e5e7eb
    style Execute fill:#22c55e,color:#000
    style W1 fill:#f59e0b,color:#000
    style W2 fill:#f59e0b,color:#000
    style W3 fill:#f59e0b,color:#000`,
  },
];

export default function DiagramsPage() {
  const [active, setActive] = useState(DIAGRAMS[0].id);
  const containerRef = useRef(null);

  const diagram = DIAGRAMS.find((d) => d.id === active) || DIAGRAMS[0];

  useEffect(() => {
    if (!containerRef.current) return;
    const id = `mermaid-${diagram.id}`;
    const el = containerRef.current.querySelector(`#${id}`);
    if (!el) return;
    // Always re-render on diagram switch (React key forces DOM remount so innerHTML is always fresh)
    mermaid.render(`${id}-svg`, diagram.code).then(({ svg }) => {
      el.innerHTML = svg;
    }).catch(() => {
      el.innerHTML = '<p style="color:var(--ink-soft);padding:1rem">Diagram rendering failed. Check Mermaid syntax.</p>';
    });
  }, [active, diagram]);

  return (
    <div className="pf-page" style={{ maxWidth: '100%' }}>
      <div className="pf-header">
        <div>
          <h1>System Diagrams</h1>
          <p className="pf-hint" style={{ margin: '0.25rem 0 0' }}>Architecture and workflow diagrams for the Trading Command Suite. 26 diagrams covering all major subsystems.</p>
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <a href="/builder/architecture-framework" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 4 }}>⬡ Architecture Framework</a>
            <a href="/status/capability-map" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 4 }}>🗺️ Capability Map</a>
          </div>
        </div>
      </div>

      {/* ── Diagram Tabs ───────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {DIAGRAMS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={active === d.id ? 'cta' : ''}
            onClick={() => setActive(d.id)}
            style={{
              padding: '0.35rem 0.7rem',
              fontSize: '0.78rem',
              borderRadius: '6px',
              border: active === d.id ? 'none' : '1px solid var(--line)',
              background: active === d.id ? 'var(--accent)' : 'var(--panel)',
              color: active === d.id ? '#fff' : 'var(--ink-soft)',
              cursor: 'pointer',
            }}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* ── Diagram Content ─────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          padding: '1rem 1.5rem',
          overflowX: 'auto',
        }}
      >
        <div key={diagram.id} id={`mermaid-${diagram.id}`} style={{ minHeight: '200px' }} />
      </div>

      {/* ── Description ─────────────────────────────────────── */}
      <div style={{ marginTop: '0.75rem', padding: '0.5rem 0' }}>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem', margin: 0 }}>{diagram.desc}</p>
      </div>
    </div>
  );
}
