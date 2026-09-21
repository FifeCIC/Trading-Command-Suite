import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import mermaid from 'mermaid';
import { annotateSource, claimsFor, evaluateClaims, summarise } from '../core/diagram-claims';
// Shell chrome is shared, not re-invented: the verdict block IS a notice, so it uses the
// canonical notice stylesheet rather than a second colour recipe. See diagrams-page.css.
import '../components/notice-block.css';
import './diagrams-page.css';

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });

const DIAGRAMS = [
  {
    id: 'signal-state-machine',
    label: 'Signal Vocabulary & Direction State Machine',
    desc: 'One vocabulary, three layers. SERVER: directionMode declares what a protocol may emit — LONG_ONLY → BUY only, SHORT_ONLY → SELL only. Classification is percentage-based: >=80% STRONG, >=40% BUY/SELL, below 40% HOLD. HOLD means "no directional edge / no trade right now" — it is NOT position advice. DUAL protocols do not flip by themselves: BUY↔SELL switching comes from PAIRING a LONG and SHORT protocol on a ScoringStrategy (shortProtocolId) — the loop compares both composites and the winner above threshold decides; both below = HOLD. UI states (LIVE/PAUSED/STALE/UNSCORED) are orthogonal to the signal. Database relationships: Protocol.derivedFrom links variants, ScoringStrategy.shortProtocolId pairs long+short for direction validation.',
    code: `flowchart TB
    subgraph Server["1. Server classification (protocol-gating)"]
        PCT["compositePct — directional signal % of max"]
        PCT -->|">= 80"| STRONG["STRONG_BUY / STRONG_SELL"]
        PCT -->|"40 - 79"| TRADE["BUY / SELL"]
        PCT -->|"< 40"| HOLD["HOLD = no trade right now"]
    end
    subgraph Mode["2. directionMode contract (Protocol.directionMode)"]
        LO["LONG_ONLY — emits BUY only"]
        SO["SHORT_ONLY — emits SELL only"]
        BO["BOTH — needs a PAIR (dual)"]
    end
    subgraph Dual["3. Dual-protocol pairing (ScoringStrategy.shortProtocolId)"]
        LS["LONG protocol composite"]
        SS["SHORT protocol composite"]
        LS --> CMP{"long > short<br/>and >= threshold?"}
        SS --> CMP
        CMP -->|"long wins"| BUY["BUY"]
        CMP -->|"short wins"| SELL["SELL"]
        CMP -->|"neither"| WAIT["HOLD — both below threshold"]
    end
    subgraph UI["4. Display states (orthogonal — buildScoreDisplay)"]
        U1["LIVE — fresh, tradable"]
        U2["PAUSED — market closed, frozen at last close"]
        U3["STALE — data older than 30 min"]
        U4["UNSCORED — no score produced"]
    end
    Mode --> Server
    HOLD -. "vocabulary: HOLD = no directional edge,<br/>NOT position advice" .-> WAIT
    style HOLD fill:#16213e,stroke:#f59e0b,color:#fff
    style WAIT fill:#16213e,stroke:#f59e0b,color:#fff
    style STRONG fill:#16213e,stroke:#22c55e,color:#fff
    style TRADE fill:#16213e,stroke:#22c55e,color:#fff`,
  },
  {
    id: 'scoring-dual-score',
    label: 'Dual-Score Scoring Model (Opportunity vs Signal)',
    desc: 'SEES emits TWO scores instead of one muddled number. Opportunity = additive "everything counts" (direction + conditions + forecasts + liquidity) for ranking/screening across the universe — "find the golden needle in a haystack of silver needles". Signal = directional conviction only (which way, how strongly, right now) for timing — drives BUY/HOLD/SELL and the automation loop. Gates multiply/veto the Signal; neutral conditions count only in Opportunity. Full design: docs/scoring-architecture.md (GH #638).',
    code: `flowchart TB
    subgraph Inputs["Directives (all groups)"]
        DIR["Directional<br/>rsi, momentum, S/R, macro,<br/>analyst, earnings"]
        CON["Conditions<br/>session quality, volatility,<br/>volume, squeeze"]
        GATE["Gates<br/>liquidity, budget, regime"]
    end
    subgraph Scores["Two Scores"]
        OPP["OPPORTUNITY<br/>= sum of ALL directive scores<br/>(everything counts)"]
        SIG["SIGNAL<br/>= sum of directional scores only<br/>(signalClass bullish / bearish)"]
    end
    subgraph Use["Two Questions"]
        U1["Which is the best opportunity?<br/>rank / screen the universe"]
        U2["Is now the moment, which way?<br/>timing + BUY / HOLD / SELL"]
    end
    DIR --> OPP
    CON --> OPP
    DIR --> SIG
    GATE -. "multiply / veto" .-> SIG
    OPP --> U1
    SIG --> U2
    style OPP fill:#0f3460,stroke:#0ea5a6,color:#fff
    style SIG fill:#16213e,stroke:#22c55e,color:#fff`,
  },
  {
    id: 'sees-research',
    label: 'SEES Research Phase',
    desc: 'Data from 10 providers feeds 99+ directives grouped into Technical, Sentiment, and Risk categories. Risk directives multiplicatively gate Tech+Sentiment scores (0.3x–1.2x). Calibration applies symbol-specific weight overrides. Output is a normalized percentage of maxPossibleScore (unbounded, not capped at 100).',
    code: `flowchart LR
    subgraph Sources["Data Sources (10 Providers)"]
        A[MT5 Bridge]
        B[Finnhub / Alpha Vantage]
        C[DB -- MarketBar, Earnings]
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
    label: 'META.Stack Trading Lifecycle',
    desc: 'META.Stack orchestrates the full trading lifecycle. Automation tick: Priority Queue check (Hot Stock Picks boost) → Timeline risk check → fetch bars → per-tick directive memoization cache → dual-protocol gated scoring via SEES (LONG vs SHORT) → threshold + cooldown + duplicate guard → mode dispatch (manual/semi-auto/auto) → broker execution via AdapterFactory → trade recording. Priority queue allows manual boosting of cross-protocol hot picks to be evaluated FIRST.',
    code: `flowchart TB
    subgraph Tick["1. Automation Tick (5min)"]
        A[clearTickCache] --> B[Timeline Risk Check]
        B --> C[Global Risk Multiplier]
        C --> D[Fetch Bars per Symbol]
    end
    subgraph Cache["2. Directive Memoization"]
        D --> E[directivesService.runAll]
        E --> F[Tick-scoped Map cache]
        F --> G[Subsequent callers get cached result]
    end
    subgraph SEES["3. SEES Scoring Engine"]
        G --> H[rankAll: global ranking]
        G --> I[protocol-gating scoreWithGating]
        G --> J[evaluateStrategy]
        I --> K["LONG vs SHORT?"]
        H --> K
        K -->|"long wins"| L[BUY signal]
        K -->|"short wins"| M[SELL signal]
        K -->|"both low"| N[HOLD]
    end
    subgraph Gates["4. META.Stack Safety Gates"]
        L --> O["Score >= Threshold?"]
        M --> O
        O -->|No| P[SKIP]
        O -->|Yes| Q["Cooldown active?"]
        Q -->|Yes| P
        Q -->|No| R["Duplicate position?"]
        R -->|Yes| S[BLOCKED]
        R -->|No| T["Mode?"]
    end
    subgraph Dispatch["5. Mode Dispatch"]
        T -->|manual| U[LOG only]
        T -->|"semi-auto"| V[QUEUED await confirm]
        T -->|auto| W[Execute]
    end
    subgraph Execution["6. Broker Execution"]
        W --> X[AdapterFactory MT5 or T212]
        X --> Y[placeOrder]
        Y --> Z[Trade Recorded]
    end
    style Cache fill:#0f3460,stroke:#e94560,color:#e94560
    style SEES fill:#16213e,stroke:#0f3460`,
  },
  {
    id: 'sees-automation',
    label: 'META.Stack -- Setup to Execution',
    desc: 'End-to-end user journey through META.Stack (Modular Expert Trading Architecture). Setup: providers → watchlists → protocols → ScoringStrategy. Automation: the loop invokes SEES for scoring, then evaluates TradingStrategies (each REQUIRES a linked ScoringStrategy via FK). Decision and execution are META.Stack responsibilities. 42 protocols, 7 ScoringStrategies, 35 TradingStrategies — all linked.',
    code: `flowchart TB
    subgraph SETUP["1. SETUP (User)"]
        A1["Configure Providers"] --> A2["Import Market Data"]
        A2 --> A3["Create Watchlists"]
        A3 --> A4["Build Protocols<br/>(directive groups + symbol resolution)"]
        A4 --> A5["Protocol ↔ Symbols<br/>via SymbolProtocolAssignment<br/>or Watchlist link"]
    end
    subgraph AUTOMATION["2. AUTOMATION LOOP (META.Stack)"]
        B1["Start Loop"] --> B2["Enable Broker<br/>(MT5 or T212)"]
        B2 --> B3["TradingStrategy =<br/>Protocol + Symbol + Entry Rules"]
        B3 --> B4["Tick: fetch bars,<br/>invoke SEES per symbol"]
    end
    subgraph SEES["3. SEES SCORING ENGINE"]
        C1["MT5 / DB bars"] --> C2["99+ Directives"]
        C2 --> C3["Protocol Gating<br/>(multiplicative risk)"]
        C3 --> C4["Composite Score<br/>+ signal class"]
    end
    subgraph DECISION["4. DECISION (META.Stack)"]
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
    desc: 'End-to-end data flow: 10 providers → AdapterFactory (rate-limited, failover) → normalized storage (MarketBar, Earnings, News, Macro) → SEES directives → scoring → META.Stack trading → analytics. No raw/transform split -- adapters normalize on ingest.',
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
    subgraph Storage["Storage (Prisma -- 70+ models)"]
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
    subgraph META["META.Stack Trading"]
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
        K[(MySQL -- Prisma datasource)]
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
        S[ci.yml -- build + lint]
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
    desc: '5 exit-focused directives contribute scores to the composite -- they do NOT trigger position closes automatically. Exit monitoring is planned but not yet automated. These directives run alongside entry directives in the same scoring pipeline.',
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
        E[Finnhub pri=50<br/>DISABLED -- key expires]
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
    label: 'Speed Trading -- Best Symbol Scanner',
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
    label: 'Protocol Calendar -- Seasonal Prioritization',
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
    label: 'Seasonality Heatmap -- Hour x Day Win Rates',
    desc: 'SeasonalityService computes a 7×24 grid of bullish win rates from MT5 1m candles (2000 bar limit). Fetches via NestJS proxy to MT5 bridge. Frontend: SeasonalityHeatmapPage at /analysis/seasonality-heatmap with TanStack Query, color-coded grid, tooltip, and legend. Note: session-timing-filter directive is independent -- it uses hardcoded session quality values, not this heatmap data.',
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
    desc: 'End-to-end data flow from 8 registered providers through DataImportOrchestrator (freshness-triggered, demand-triggered, rate-limit aware) into normalized storage (70+ Prisma models). Directives consume DB data -- only 1 directive (crypto-fear-greed) bypasses the DB with a direct API call. MacroSnapshot, SocialMention, InsiderTransaction models exist in schema but have zero usage.',
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
    desc: 'Full trace from TradingStrategyService.evaluateAllActive() through scoring, evaluation, safety gates, bridge, to MT5 order execution. Safety gates: MT5_MAX_POSITION_SIZE, MT5_MAX_OPEN_POSITIONS, MT5_MAX_DAILY_LOSS, RiskService.canOpenPosition, drawdown check. Regime-adaptive sizing: high vol=0.5×, chaotic=0.25×, strong trend=1.25×. MT5 fallback: if DB has <30 bars, fetches from bridge and stores.',
    code: `flowchart TD
    TICK["evaluateAllActive<br/>called by scheduler"] --> SCORE["gateScore: directivesService.runAll<br/>99+ directives per protocol"]
    SCORE --> RANK["composite + signal + rarity"]

    RANK --> G1{"composite < minComposite?"}
    G1 -->|yes| SKIP1["SKIP"]
    G1 -->|no| G2{"Cooldown active?<br/>lastTradeTime check"}
    G2 -->|yes| SKIP2["SKIP"]
    G2 -->|no| G3{"positions >= maxPositions?"}
    G3 -->|yes| BLOCK["BLOCKED"]
    G3 -->|no| G8{"Rarity band OK?<br/>rarityBandRank check"}
    G8 -->|no| SKIP3["SKIP rarity"]
    G8 -->|yes| G4{"Mode?"}
    G4 -->|manual| LOG["LOG ONLY<br/>signal logged"]
    G4 -->|auto| SIZING["Regime-Adaptive Sizing"]

    SIZING --> SZ1["baseSize × raritySizeMultiplier"]
    SZ1 --> SZ2{"ConditionDetector regime?"}
    SZ2 -->|high vol| SZ3["×0.5 half size"]
    SZ2 -->|chaotic| SZ4["×0.25 quarter size"]
    SZ2 -->|strong trend| SZ5["×1.25 boost"]
    SZ2 -->|normal| SZ6["×1.0"]
    SZ3 & SZ4 & SZ5 & SZ6 --> GATES["runSafetyGates"]

    GATES --> G11{"size > MT5_MAX_POSITION_SIZE?"}
    G11 -->|yes| F5["BLOCKED"]
    G11 -->|no| G12{"positions >= MT5_MAX_OPEN_POSITIONS?"}
    G12 -->|yes| F6["BLOCKED"]
    G12 -->|no| G13{"dailyPnl < -MT5_MAX_DAILY_LOSS?"}
    G13 -->|yes| F7["BLOCKED"]
    G13 -->|no| G14{"RiskService.canOpenPosition?"}
    G14 -->|no| F8["BLOCKED"]
    G14 -->|yes| G15{"Drawdown check?"}
    G15 -->|exceeded| F9["BLOCKED"]
    G15 -->|ok| MT5["fetch bridgeUrl/order<br/>POST :5000/order"]

    MT5 --> B1{"Bridge response?"}
    B1 -->|error/timeout| FAIL["FAILED"]
    B1 -->|success: true| TRADE["TRADE EXECUTED<br/>ticket recorded"]
    B1 -->|success: false| REJ["REJECTED<br/>bridge error"]

    TRADE --> NOTIFY["NotificationService<br/>entry-signal alert"]
    TRADE --> RECORD["StrategyEvaluation<br/>traded=true, ticket"]

    style TRADE fill:#27ae60,color:#fff
    style FAIL fill:#c0392b,color:#fff
    style TICK fill:#8e44ad,color:#fff
    style SCORE fill:#2980b9,color:#fff
    style SIZING fill:#7c3aed,color:#fff
    style GATES fill:#e67e22,color:#fff
    style MT5 fill:#e67e22,color:#fff
    style NOTIFY fill:#3b82f6,color:#fff`,
  },

  // ── MetaStack System ────────────────────────────────────

  {
    id: 'metastack-product',
    label: 'META.Stack Product Hierarchy',
    desc: 'Trading Command Suite delivers SEES signals layered into META.Stack. 37 protocols in PROTOCOL_REGISTRY. 3 SHORT variants (default-short, built-in-short, mt5-technical-short) have explicit directionMode: SHORT_ONLY. Direction is encoded in protocol selection, not an API parameter.',
    code: `flowchart TB
    subgraph TCS["Trading Command Suite"]
        direction TB
        subgraph SEES["SEES -- Signal Engine"]
            A["99+ Directives<br/>6 with directionBias<br/>4 bullish · 2 bearish"]
            B["37 Protocols<br/>3 with directionMode: SHORT_ONLY<br/>rest implicitly LONG"]
            C["Ranked Symbol Output<br/>Composite scores 0-100"]
            A --> B --> C
        end
        subgraph MS["META.Stack (Modular Expert Trading Architecture)"]
            direction TB
            subgraph ProtocolPair["Protocol Pair (LONG + SHORT)"]
                PL["🟢 LONG Protocol<br/>e.g. built-in-default<br/>directionMode: LONG_ONLY"]
                PS["🔴 SHORT Protocol<br/>e.g. built-in-short<br/>directionMode: SHORT_ONLY"]
            end
            D["📋 Watchlist<br/>What to trade"]
            E["📊 Trading Strategy<br/>Thresholds + Sizing + SL/TP<br/>shortProtocolId for dual-direction"]
            G["⭐ Performance Rating<br/>★★★★★ per MetaStack"]
            D --> ProtocolPair
            ProtocolPair --> E --> G
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
    label: 'META.Stack Rating Engine',
    desc: 'StackPerformanceService rates each MetaStack (Watchlist+Protocol+ScoringStrategy+TradingStrategy) from actual Trade records. Formula: normalizedEffectiveness (PnL/hr scaled to 0-100 where $50/hr=100) x recencyDecay (exp(-days/30)) x confidenceFactor (clamp(trades/100, 0.1, 1.0)) x consistencyFactor (1-abs(winRate-0.5)*0.3). Persists to StackPerformance table via upsert. SHA-256 fingerprint of config detects MetaStack drift. Endpoint: GET /api/scoring/metastacks/ratings.',
    code: `flowchart LR
    subgraph Inputs["Trade Data"]
        A["prisma.trade.findMany<br/>where: scoringStrategyId"]
    end
    subgraph Metrics["Raw Metrics"]
        B["Total PnL"]
        C["Win Rate<br/>wins / total"]
        D["Profit Factor<br/>grossProfit / grossLoss"]
        E["Max Drawdown<br/>peak - trough"]
        F["Runtime Hours<br/>activatedAt to lastTrade"]
    end
    subgraph Formula["Rating Formula"]
        G["Effectiveness Rate<br/>PnL / runtimeHours"]
        G2["Normalize<br/>min 100, eff/50 x 100"]
        H["Confidence Factor<br/>clamp trades/100, 0.1, 1.0"]
        I["Recency Decay<br/>exp -daysSinceLast/30"]
        J["Consistency Factor<br/>1 - abs winRate-0.5 x 0.3"]
        K["Composite Rating<br/>norm x decay x conf x cons"]
    end
    subgraph Output["Output"]
        L["Star Bands<br/>Elite GT 80 | Strong GT 60<br/>Average GT 40 | Weak GT 20 | Untested"]
        M["StackPerformance<br/>upsert to DB"]
        N["SHA-256 Fingerprint<br/>config drift detection"]
    end
    A --> B
    A --> C
    A --> D
    A --> E
    A --> F
    B --> G
    F --> G
    G --> G2
    C --> J
    G2 --> K
    H --> K
    I --> K
    J --> K
    K --> L
    K --> M
    A --> N

    style Inputs fill:#1e3a5f,stroke:#3b82f6,color:#e5e7eb
    style Metrics fill:#1a1a2e,stroke:#6366f1,color:#e5e7eb
    style Formula fill:#1a1a2e,stroke:#8b5cf6,color:#e5e7eb
    style Output fill:#1a1a2e,stroke:#f59e0b,color:#e5e7eb
    style A fill:#2563eb,color:#fff
    style B fill:#475569,color:#e5e7eb
    style C fill:#475569,color:#e5e7eb
    style D fill:#475569,color:#e5e7eb
    style E fill:#475569,color:#e5e7eb
    style F fill:#475569,color:#e5e7eb
    style G fill:#7c3aed,color:#fff
    style G2 fill:#7c3aed,color:#fff
    style H fill:#7c3aed,color:#fff
    style I fill:#7c3aed,color:#fff
    style J fill:#7c3aed,color:#fff
    style K fill:#a855f7,color:#fff
    style L fill:#22c55e,color:#000
    style M fill:#4ade80,color:#000
    style N fill:#f59e0b,color:#000`,
  },

  {
    id: 'metastack-signature',
    label: 'META.Stack Configuration Signature',
    desc: 'SHA-256 hash of MetaStack components detects configuration drift. When a watchlist symbol, protocol, or risk parameter changes, the signature changes -- warning users that performance history may be stale.',
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
    id: 'protocol-symbol-resolution',
    label: 'Protocol Symbol Resolution',
    desc: 'How protocols determine which symbols to score. Three resolution paths in priority order: (1) DB SymbolProtocolAssignment rows for single-symbol protocols, (2) DB Watchlist linked via watchlist_id on protocol, (3) Auto-derived from protocol ID pattern matching. Added 2026-08-05 to fix META.Stack foundation.',
    code: `flowchart TB
    subgraph Protocol["Protocol"]
        P1["btc-speed-v1"]
    end

    subgraph Path1["Path 1 — DB: SymbolProtocolAssignment"]
        A1["SELECT symbol FROM SymbolProtocolAssignment WHERE protocolId = ?"]
        A2["Single-symbol: BTCUSD"]
    end

    subgraph Path2["Path 2 — DB: Watchlist"]
        B1["SELECT symbols FROM Watchlist WHERE protocolId = ?"]
        B2["Multi-symbol: EURUSD, GBPUSD, USDJPY, ..."]
    end

    subgraph Path3["Path 3 — Auto-Derive Fallback"]
        C1["Pattern match protocol ID"]
        C2["btc-* → BTCUSD<br/>xau-* → XAUUSD<br/>forex-* → forex-majors watchlist<br/>oil-* → USOIL"]
    end

    subgraph API["resolveSymbols(protocolId)"]
        D1["1. Check SymbolProtocolAssignment"]
        D2["2. Check Watchlist.protocolId"]
        D3["3. Auto-derive from ID"]
    end

    P1 --> D1
    D1 -->|found| A1
    D1 -->|not found| D2
    D2 -->|found| B1
    D2 -->|not found| D3
    D3 --> C1
    A1 --> A2
    B1 --> B2
    C1 --> C2

    A2 --> Out["GET /api/scoring/gated/protocols/:id/symbols"]
    B2 --> Out
    C2 --> Out

    style Path1 fill:#1a3a1a,stroke:#22c55e,color:#e5e7eb
    style Path2 fill:#1a2a3a,stroke:#3b82f6,color:#e5e7eb
    style Path3 fill:#3a2a1a,stroke:#f59e0b,color:#e5e7eb
    style API fill:#1a1a2e,stroke:#8b5cf6,color:#e5e7eb
    style D1 fill:#22c55e,color:#000
    style D2 fill:#3b82f6,color:#fff
    style D3 fill:#f59e0b,color:#000
    style Out fill:#0ea5a6,color:#fff`,
  },
  {
    id: 'protocol-direction',
    label: 'Protocol Direction Architecture',
    desc: 'Protocols encode trading direction via directionMode (LONG_ONLY | SHORT_ONLY | BOTH). The automation loop compares LONG vs SHORT scores to determine trade direction. No direction query parameter -- direction is selected by choosing the right protocol.',
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
        T7["⚪ HOLD -- both below threshold"]
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
  {
    id: 'scoring-paths',
    label: 'Scoring Paths (5 Surfaces)',
    desc: 'Canonical as of 2026-07-29. Five scoring surfaces, each with a distinct role. Protocol-gated scoring (~14 directives) is ~7x cheaper than unfiltered rankAll (104 directives). The gated/batch pipeline is the canonical META.Stack path for trading decisions.',
    code: `flowchart TB
    subgraph EntryPoints["Entry Points"]
        direction LR
        E1["Dashboard /<br/>Quick Lookup"]
        E2["Trading Decision /<br/>Strategy Eval"]
        E3["Signal Quality /<br/>Trust Assessment"]
        E4["Scalping /<br/>Speed Trading"]
        E5["Analytics /<br/>Performance"]
    end

    subgraph Pipeline1["1. Flat Ranked (Workhorse)"]
        P1["GET /api/scoring/ranked<br/>104 directives · flat weighting<br/>DB-cached (free) · 15s cache<br/>?fresh=true for live compute"]
    end

    subgraph Pipeline2["2. META.Stack Gated ★ CANONICAL"]
        P2["POST /api/scoring/gated/batch<br/>~14 directives · risk gates<br/>rarity weighting · readiness filter<br/>~7x cheaper than flat"]
    end

    subgraph Pipeline3["3. Signal Envelopes"]
        P3["GET/POST /api/signals/ladder<br/>Confidence rails · conflict detect<br/>pre-trade readiness<br/>wraps gated pipeline"]
    end

    subgraph Pipeline4["4. Speed Scan (Scalping)"]
        P4["POST /api/speed/scan<br/>4 timeframes · micro-trend<br/>seasonal affinity · 23 symbols<br/>heaviest per-symbol, few symbols"]
    end

    subgraph Pipeline5["5. Benchmark (Analytics)"]
        P5["GET /api/backtest/benchmark<br/>Buy-and-hold comparison<br/>reads MarketBar 1d<br/>no directives run"]
    end

    subgraph Consumers["Frontend Consumers"]
        direction LR
        C1["Dashboard · DailyBriefing<br/>HotStockPicks · AnalyseSymbol<br/>MetaStackStatus · GapScanner<br/>ChartComparison · ScoringOverview"]
        C2["Ladder · ABTesting<br/>MetaStackExplorer · SpeedTrading<br/>Protocols · CreateStrategy<br/>SpeedDecisionPanel"]
        C3["SignalsWorkbench<br/>ComponentLab"]
        C4["SpeedScanner · SpeedTrading<br/>GoldSpeed · BtcSpeed<br/>MetaStackDisplay"]
        C5["No frontend yet<br/>(new 2026-07-29)"]
    end

    E1 --> P1
    E2 --> P2
    E3 --> P3
    E4 --> P4
    E5 --> P5

    P1 --> C1
    P2 --> C2
    P3 --> C3
    P4 --> C4
    P5 --> C5

    P3 -.->|"delegates to"| P2

    style P2 fill:#22c55e,color:#000,stroke:#16a34a,stroke-width:3px
    style P1 fill:#f59e0b,color:#000
    style P3 fill:#3b82f6,color:#fff
    style P4 fill:#7c3aed,color:#fff
    style P5 fill:#64748b,color:#fff
    style E1 fill:#1e293b,color:#e5e7eb
    style E2 fill:#1e293b,color:#e5e7eb
    style E3 fill:#1e293b,color:#e5e7eb
    style E4 fill:#1e293b,color:#e5e7eb
    style E5 fill:#1e293b,color:#e5e7eb`,
  },
  {
    id: 'ab-duplication',
    label: '[CONCEPT] A/B Duplication Flow',
    desc: 'CONCEPT (2026-07-29). How to create an A/B test pair: clone the original, establish the pairing contract, run both sides. The contract enables the decision-trail (#350) to compare trades and highlight exactly what differed between A and B.',
    code: `flowchart TB
    subgraph Original["Original (Side A)"]
        A1["Protocol<br/>xau-speed-v1"]
        A2["Scoring Strategy<br/>watchlist=XAU pairs"]
        A3["Trading Strategy<br/>symbol=XAUUSD, broker=mt5"]
    end

    subgraph Clone["Clone (Side B)"]
        B1["Protocol (clone)<br/>xau-speed-v1-b"]
        B2["Scoring Strategy (clone)<br/>same watchlist"]
        B3["Trading Strategy (clone)<br/>same symbol, broker"]
    end

    subgraph Contract["A/B Pairing Contract"]
        C1["ab_pair table<br/>id, name, sideAProtocolId, sideBProtocolId<br/>sideAStrategyId, sideBStrategyId<br/>status: draft|active|completed"]
        C2["Rules<br/>· Same symbol + watchlist<br/>· Same broker + risk params<br/>· Only protocol differs<br/>· Max 1 active test"]
    end

    subgraph Execution["Execution"]
        E1["Automation Loop Tick"]
        E2["Score Side A → dispatch"]
        E3["Score Side B → dispatch"]
        E4["Decision-Trail compares<br/>longComposite, shortComposite<br/>directive breakout diffs"]
    end

    A1 -->|"clone"| B1
    A2 -->|"clone"| B2
    A3 -->|"clone"| B3

    A1 --> C1
    B1 --> C1
    A3 --> C1
    B3 --> C1

    C1 --> E1
    E1 --> E2
    E1 --> E3
    E2 --> E4
    E3 --> E4

    style C1 fill:#7c3aed,color:#fff,stroke:#6d28d9,stroke-width:2px
    style E4 fill:#f59e0b,color:#000`,
  },
  {
    id: 'ab-contract',
    label: '[CONCEPT] A/B Contract — Decision-Trail Comparison',
    desc: 'CONCEPT (2026-07-29). The decision-trail (#350) is the foundation for A/B comparison. Two trades on the same tick, same symbol, different protocols — the trail shows exactly which directive scores diverged. This is how we answer "why did A win but B lose?"',
    code: `flowchart LR
    subgraph Tick["Tick #N, Symbol=XAUUSD"]
        direction TB
        T1["Side A: xau-speed-v1<br/>longComposite=72, shortComposite=—<br/>winner=LONG, signal=BUY"]
        T2["Side B: xau-speed-v1-b<br/>longComposite=58, shortComposite=—<br/>winner=LONG, signal=HOLD"]
    end

    subgraph Trail["Decision-Trail Comparison"]
        direction TB
        D1["Directive: gold-session-profile<br/>A: 85/100 · B: 62/100<br/>Δ = -23 — B penalized harder<br/>Reason: B has stricter session gate"]
        D2["Directive: gold-round-numbers<br/>A: 70/80 · B: 68/80<br/>Δ = -2 — negligible"]
        D3["Directive: rsi-oversold<br/>A: 55/70 · B: 42/70<br/>Δ = -13 — different RSI period"]
        D4["Verdict: B's stricter session gate<br/>and shorter RSI period caused<br/>14-point composite drop"]
    end

    subgraph Output["Output"]
        O1["A: EXECUTED (ticket 456)<br/>B: SKIPPED (below threshold)"]
        O2["trade.source = 'meta-stack'<br/>ab_test_id = 'test-001'"]
    end

    Tick --> Trail
    Trail --> Output

    style D1 fill:#ef4444,color:#fff
    style D2 fill:#64748b,color:#fff
    style D3 fill:#f59e0b,color:#000
    style D4 fill:#7c3aed,color:#fff,stroke:#6d28d9`,
  },
];

export default function DiagramsPage() {
  const [active, setActive] = useState(DIAGRAMS[0].id);
  const containerRef = useRef(null);

  const diagram = DIAGRAMS.find((d) => d.id === active) || DIAGRAMS[0];

  // Live data queries for dynamic diagram verification (#493)
  const autoQ = useQuery({ queryKey: ['diagram-auto'], queryFn: () => apiGet('/api/automation/status').catch(() => null), refetchInterval: 30000 });
  const protoQ = useQuery({ queryKey: ['diagram-proto'], queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => null), refetchInterval: 60000 });
  const live = { loop: autoQ.data?.loopEnabled, tick: autoQ.data?.tickCount, strats: autoQ.data?.activeStrategies?.length ?? 0, protos: protoQ.data?.count ?? protoQ.data?.protocols?.length ?? 0 };

  /**
   * Claim verification — the generalisation of the #493 live strip above.
   *
   * That strip DISPLAYS four live numbers for two hardcoded diagrams but compares them to
   * nothing, so it cannot make a diagram wrong. This evaluates the machine-checkable claims
   * registered in `src/core/diagram-claims.js` and feeds the result back into the rendering,
   * so a node whose claim fails is stroked red IN the picture.
   *
   * Two deliberate behaviours:
   *   • A claim whose probe cannot run stays UNVERIFIED. It is never shown as passing —
   *     a check that inspects nothing must not render as a green tick.
   *   • Only registered claims are checked. The panel reports "N of M" and says the rest of
   *     the diagram is unchecked prose, rather than implying the whole picture is verified.
   */
  const [claimResults, setClaimResults] = useState([]);
  const [claimsLoading, setClaimsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!claimsFor(diagram.id).length) {
      setClaimResults([]);
      setClaimsLoading(false);
      return undefined;
    }
    setClaimsLoading(true);
    setClaimResults([]);
    evaluateClaims(diagram.id, diagram.code, apiGet)
      .then((rows) => {
        if (cancelled) return;
        setClaimResults(rows);
        setClaimsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setClaimResults([]);
        setClaimsLoading(false);
      });
    return () => { cancelled = true; };
  }, [diagram]);

  useEffect(() => {
    if (!containerRef.current) return;
    const id = `mermaid-${diagram.id}`;
    const el = containerRef.current.querySelector(`#${id}`);
    if (!el) return;
    // Always re-render on diagram switch (React key forces DOM remount so innerHTML is always fresh).
    // The source is annotated with claim results first, so the diagram carries its own accuracy.
    mermaid.render(`${id}-svg`, annotateSource(diagram.id, diagram.code, claimResults)).then(({ svg }) => {
      el.innerHTML = svg;
    }).catch(() => {
      el.innerHTML = '<p style="color:var(--ink-soft);padding:1rem">Diagram rendering failed. Check Mermaid syntax.</p>';
    });
  }, [active, diagram, claimResults]);

  return (
    <div className="pf-page" style={{ maxWidth: '100%' }}>
      <div className="pf-header">
        <div>
          <h1>System Diagrams</h1>
          <div className="notice-block notice-block--compact notice-block--warning" style={{ marginTop: 10, maxWidth: '80ch' }}>
            <div className="notice-head">
              <span className="notice-title">⚠️ Conceptual reference only</span>
            </div>
            <p className="notice-message">
              These diagrams are brainstorming artifacts — a claim with a registered probe is
              <strong> verified against the running system when this page loads</strong> and its node is
              outlined in green or red. Everything else is unchecked prose and may not reflect the current
              implementation.
            </p>
            <p className="notice-detail">
              <span className="notice-label">Canonical</span>
              For the pipeline structure itself, see the META.Stack Pipeline Graph.
            </p>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <a href="/builder/architecture-framework" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 4 }}>⬡ Architecture Framework</a>
            <a href="/status/capability-map" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 4 }}>🗺️ Capability Map</a>
          </div>
        </div>
      </div>

      {/* ── Diagram Tabs ───────────────────────────────────── */}
      <div className="dg-tabs">
        {DIAGRAMS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`dg-tab${active === d.id ? ' dg-tab--active' : ''}`}
            aria-pressed={active === d.id}
            onClick={() => setActive(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {(active === 'sees-trading' || active === 'sees-automation') && live.loop !== undefined && (
        <div className="dg-live">
          <span className="dg-live-label">Live System</span>
          <span>Loop: <strong style={{ color: live.loop ? 'var(--color-profit)' : 'var(--danger)' }}>{live.loop ? 'ON' : 'OFF'}</strong></span>
          <span>Tick: <strong>{live.tick ?? '...'}</strong></span>
          <span>Strategies: <strong>{live.strats}</strong></span>
          <span>Protocols: <strong>{live.protos}</strong></span>
        </div>
      )}

      {/* ── Diagram Content ─────────────────────────────────── */}
      <div ref={containerRef} className="dg-card">
        <div key={diagram.id} id={`mermaid-${diagram.id}`} style={{ minHeight: '200px' }} />
      </div>

      {/* ── Claim verification ──────────────────────────────────
          The verdict for every claim registered in src/core/diagram-claims.js. Renders
          nothing at all when a diagram has no claims — an empty panel and a panel saying
          "everything is fine" must not look the same. */}
      {claimsLoading && (
        <p className="dg-checking">Checking this diagram&apos;s claims against the running system…</p>
      )}
      {!claimsLoading && claimResults.length > 0 && (() => {
        const s = summarise(claimResults);
        const bad = s.failed > 0;
        return (
          <div
            className={`notice-block notice-block--compact dg-claims ${bad ? 'notice-block--critical' : 'notice-block--success'}`}
          >
            <div className="notice-head">
              <span className="notice-title">
                {bad
                  ? `🛑 ${s.failed} claim${s.failed > 1 ? 's' : ''} conflict${s.failed > 1 ? '' : 's'} with the running system`
                  : `✅ all ${s.checked} checked claim${s.checked > 1 ? 's' : ''} agree with the running system`}
              </span>
              <code className="notice-code" title="Claims checked against the live API versus claims registered for this diagram.">
                {s.passed}/{s.checked} checked
              </code>
            </div>
            <p className="notice-detail">
              <span className="notice-label">Scope</span>
              {s.unverified ? `${s.unverified} could not be checked · ` : ''}
              the remaining statements in this diagram are unchecked prose
            </p>
            <div className="dg-claim-list">
              {claimResults.map((r) => (
                <div
                  key={`${r.node}-${r.says}`}
                  className={`dg-claim-row${r.ok === false ? ' dg-claim-row--bad' : r.ok === true ? ' dg-claim-row--ok' : ''}`}
                >
                  <span className="dg-claim-node">{r.node}</span>
                  <span className="dg-claim-says">
                    {r.ok === true ? '✅' : r.ok === false ? '🛑' : '·'} {r.says}
                  </span>
                  {r.ok !== true && (
                    <span className="dg-claim-vals">
                      — diagram says <code>{String(r.expect)}</code>
                      {r.ok === false ? <>, live says <code>{String(r.actual)}</code></> : null}
                      {r.error ? <> · {r.error}</> : null}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Description ─────────────────────────────────────── */}
      <div style={{ marginTop: '0.75rem', padding: '0.5rem 0' }}>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem', margin: 0 }}>{diagram.desc}</p>
      </div>
    </div>
  );
}
