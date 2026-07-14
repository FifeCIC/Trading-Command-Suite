import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });

const DIAGRAMS = [
  {
    id: 'sees-research',
    label: 'SEES Research Phase',
    desc: 'Data sources feed directives, which calculate individual scores. Protocol combines weighted directives into a composite score for research/analysis.',
    code: `flowchart LR
    subgraph Sources["Data Sources"]
        A[Market Data APIs]
        B[MT5 Bridge]
        C[Historical Data]
    end
    subgraph Directives["Scoring Directives"]
        D[RSI Oversold]
        E[MACD Crossover]
        F[EMA Structure]
        G[ATR Dip]
        H[Volume Confirm]
    end
    subgraph Pipeline["Scoring Pipeline"]
        I[Protocol Engine]
        J[Weighted Composite]
        K[Score Output 0-100]
    end
    Sources --> Directives
    Directives --> I
    I --> J --> K
    K --> L[Research Dashboard]
    K --> M[SEES Rankings]`,
  },
  {
    id: 'sees-trading',
    label: 'SEES Full Trading Lifecycle',
    desc: 'Scores feed the trading pipeline: threshold evaluation, risk validation, MT5 order execution, and position monitoring with feedback.',
    code: `flowchart TB
    subgraph Scoring["1. Scoring"]
        A[Data Sources] --> B[Directives]
        B --> C[Protocol Engine]
        C --> D[Composite Score]
    end
    subgraph Trading["2. Trading Decision"]
        D --> E{Score >= Threshold?}
        E -->|Yes| F[Risk Controls]
        E -->|No| G[Skip / Watch]
        F -->|Passed| H[Generate Order]
        F -->|Blocked| I[Reject with Reason]
    end
    subgraph Execution["3. Execution"]
        H --> J[MT5 Bridge]
        J --> K[Broker Order]
        K --> L[Position Opened]
    end
    subgraph Monitor["4. Monitoring"]
        L --> M[Position Tracker]
        M --> N[P&L Updates]
        N --> O[Exit Signal Check]
        O -->|Trigger| P[Close Position]
        O -->|Hold| M
    end
    subgraph Feedback["5. Feedback Loop"]
        N --> Q[Performance Analytics]
        Q --> R[Strategy Adjustment]
        R --> C
    end`,
  },
  {
    id: 'sees-automation',
    label: 'SEES Automation Lifecycle + User Journey',
    desc: 'The full system flow wrapped in the automation loop, showing which page the user visits at each step. Distinguishes SEES Strategies (Watchlist+Protocol) from Trading Strategies (execution instances). See docs/architecture/SEES-AUTOMATION-LIFECYCLE.md.',
    code: `flowchart TB
    subgraph SETUP["1. SETUP"]
        A1["Configure Providers"] --> A2["Import Market Data"]
        A2 --> A3["Create Watchlists"]
        A3 --> A4["Build Protocols"]
        A4 --> A5["SEES Strategy = Watchlist + Protocol"]
    end
    subgraph AUTOMATION["2. AUTOMATION LOOP"]
        B1["Start Loop"] --> B2["Enable MT5 Broker"]
        B2 --> B3["Trading Strategy = Protocol + Symbol + Entry Rules"]
        B3 --> B4["Tick: discover active strategies, score symbols, evaluate entries"]
    end
    subgraph SCORING["3. SEES SCORING"]
        C1["MT5 / Yahoo / DB"] --> C2["89 Directives"]
        C2 --> C3["Protocol Gating"]
        C3 --> C4["Composite Score: BUY / HOLD / SELL"]
    end
    subgraph DECISION["4. DECISION"]
        D1{"Score >= Threshold?"} -->|No| D2["Watch"]
        D1 -->|Yes| D3{"Risk Gate?"}
        D3 -->|Blocked| D4["Rejected"]
        D3 -->|Passed| D5{"Mode?"}
        D5 -->|manual| D6["Alert"]
        D5 -->|semi-auto| D7["Suggest"]
        D5 -->|auto| D8["Auto-execute"]
    end
    subgraph EXECUTION["5. EXECUTION"]
        E1["MT5 Bridge"] --> E2["Order Placed"]
    end
    subgraph MONITOR["6. MONITOR"]
        F1["Position Tracker"] --> F2["P/L Updates"]
    end
    A5 --> B3
    B4 --> C1
    C4 --> D1
    D7 --> E1
    D8 --> E1
    E2 --> F1
    F2 -.->|Adjust| B3`,
  },
  {
    id: 'data-arch',
    label: 'Data Architecture',
    desc: 'End-to-end data flow: external APIs → import → transformation → scoring → trading → analytics, with cache and queue layers.',
    code: `flowchart TB
    subgraph Ingest["Data Ingest"]
        A[Trading212 API] --> D[Import Jobs]
        B[Alpha Vantage] --> D
        C[MT5 Bridge] --> D
    end
    subgraph Storage["Storage Layer"]
        D --> E[(Raw Data)]
        E --> F[Transform Pipeline]
        F --> G[(Normalized Tables)]
        G --> H[(Symbols, Prices)]
    end
    subgraph Processing["Processing"]
        G --> I[SEES Directives]
        I --> J[Score Engine]
        J --> K[(Score Table)]
        K --> L[Protocol Aggregation]
    end
    subgraph Trading["Trading Layer"]
        L --> M[Strategy Engine]
        M --> N[Order Generator]
        N --> O[MT5 Execution]
        O --> P[(Position Data)]
    end
    subgraph Analytics["Analytics"]
        K --> Q[Cache Layer]
        P --> R[Performance Analytics]
        R --> S[Reporting Dashboard]
        Q --> T[API Responses]
    end`,
  },
  {
    id: 'component-arch',
    label: 'Component & Route Architecture',
    desc: 'React component tree and routing: BrowserRouter → AppShell → panels → individual pages, with Zustand stores and TanStack Query.',
    code: `flowchart TB
    A[BrowserRouter] --> B[AppShell]
    B --> C[TopBar]
    B --> D[LeftRail]
    B --> E[MainStage]
    B --> F[RightRail]
    B --> G[Footer]
    E --> H[renderMainContent]
    H --> I[Area Views]
    I --> J[PortfolioPage]
    I --> K[ScoringRunsPage]
    I --> L[DirectivesManagerPage]
    I --> M[...40+ pages]
    subgraph State["State Management"]
        N[Zustand Stores] --> O[useUiStore]
        N --> P[useThemeRuntime]
    end
    subgraph Data["Data Layer"]
        Q[TanStack Query] --> R[apiGet / apiPost]
        R --> S[NestJS API :3201]
    end
    D --> T[NavTree Config]
    F --> U[Status + Actions]
    G --> V[Area Nav + Flags]`,
  },
  {
    id: 'deployment',
    label: 'Deployment & Infrastructure',
    desc: 'Local development infrastructure: WAMP, NestJS, Vite, Intranet task runner, MT5 bridge, and Google Drive documentation.',
    code: `flowchart LR
    subgraph WAMP["WAMP Stack :80"]
        A[Apache]
        B[PHP 8.x]
        C[(MySQL 9.1)]
    end
    subgraph Backend["NestJS :3201"]
        D[API Gateway]
        E[Modules]
        F[Prisma ORM]
    end
    subgraph Frontend["Vite :5173/5188"]
        G[React 18 PWA]
        H[TanStack Query]
    end
    subgraph Bridge["MT5 Bridge :5000"]
        I[Python Bridge]
        J[MetaTrader 5]
    end
    subgraph Infra["Infrastructure"]
        K[Intranet Task Runner :80]
        L[Google Drive Docs]
    end
    G -->|fetch| D
    D -->|query| C
    D -->|commands| I
    I -->|orders| J
    K -->|start/stop| D
    K -->|start/stop| G
    L -->|.agenticmemory| M[Prompts & Docs]`,
  },
  {
    id: 'activation-gate',
    label: 'Activation Gate & Conditions',
    desc: 'Pre-scoring condition detection: ConditionDetectorService produces a ConditionVector (entropy, Hurst, session, BOS, range). ActivationGateService evaluates directive suitability metadata (regime, volatility, instrument, timeframe) and classifies each directive as active/reduced/muted/boosted before scoring.',
    code: `flowchart TB
    subgraph Input["Market Data Input"]
        A[Price Bars]
        B[Volume Data]
        C[Session Info]
    end
    subgraph Detection["Condition Detection"]
        D[Entropy Calculator]
        E[Hurst Exponent]
        F[Session Classifier]
        G[BOS Detector]
        H[Range Analyzer]
    end
    subgraph Vector["Condition Vector"]
        I[entropyLevel]
        J[hurstValue]
        K[sessionType]
        L[breakOfStructure]
        M[rangeState]
    end
    subgraph Gate["Activation Gate"]
        N[Suitability Registry<br/>40+ directives]
        O[Gate Evaluator]
        P{Match?}
        Q[active · boosted]
        R[reduced · muted]
    end
    subgraph Triggers["8 Built-in Triggers"]
        S[strong-trend]
        T[high-vol]
        U[compression]
        V[ranging]
        W[asian-session]
        Z[london-us-overlap]
        Y[bearish-structure]
        X[bullish-structure]
    end
    A --> D
    B --> D
    C --> F
    A --> E
    A --> G
    A --> H
    D --> I
    E --> J
    F --> K
    G --> L
    H --> M
    I --> O
    J --> O
    K --> O
    L --> O
    M --> O
    N --> O
    O --> P
    P -->|match| Q
    P -->|mismatch| R
    Triggers --> O
    Q --> SCORING[Directive Scoring]
    R --> SCORING`,
  },
  {
    id: 'exit-signals',
    label: 'Exit Signal System',
    desc: 'Four exit-focused directives run alongside entry scores: momentum-exhaustion (P65), target-achieved (P60), regime-shift-exit (P80), time-stop (P50). Exit urgency feeds into the scoring pipeline for position management.',
    code: `flowchart TB
    subgraph Market["Market Data"]
        A[Price]
        B[Volume]
        C[ATR]
        D[RSI]
        E[Position Age]
    end
    subgraph ExitDirectives["Exit Directives"]
        F[momentum-exhaustion<br/>P65]
        G[target-achieved<br/>P60]
        H[regime-shift-exit<br/>P80]
        I[time-stop<br/>P50]
    end
    subgraph Logic["Exit Logic"]
        J{RSI > 70?}
        K{Volume ↓?}
        L{Price at<br/>1.5x ATR?}
        M{Entropy<br/>spike?}
        N{Momentum<br/>decay?}
    end
    subgraph Output["Exit Output"]
        O[Exit Urgency Score]
        P[Signal Classification]
        Q{Trigger?}
        R[Close Position]
        S[Hold + Monitor]
    end
    A --> J
    B --> K
    A --> L
    C --> L
    A --> M
    D --> J
    E --> N
    J --> F
    K --> F
    L --> G
    M --> H
    N --> I
    F --> O
    G --> O
    H --> O
    I --> O
    O --> Q
    Q -->|urgency > threshold| R
    Q -->|below threshold| S`,
  },
  {
    id: 'alert-center',
    label: 'Alert Center Architecture',
    desc: 'Centralized alert system with 8 pre-configured alert types, 4 severity levels (critical/high/warning/info), lifecycle management (active→acknowledged→snoozed→dismissed), and 10s frontend polling.',
    code: `flowchart LR
    subgraph Sources["Alert Sources"]
        A[MT5 Bridge]
        B[API Rate Limits]
        C[Data Staleness]
        D[Signal Quality]
        E[Backend Health]
        F[Database]
        G[Strategy Errors]
        H[Stop-Loss]
    end
    subgraph Engine["Alert Engine"]
        I[AlertService]
        J[Severity Classifier]
        K[Lifecycle Manager]
    end
    subgraph Severity["Severity Levels"]
        L[🔴 critical]
        M[🟠 high]
        N[🟡 warning]
        O[🔵 info]
    end
    subgraph Lifecycle["Lifecycle States"]
        P[active]
        Q[acknowledged]
        R[snoozed<br/>15min]
        S[dismissed]
        T[(History Log)]
    end
    subgraph UI["Frontend"]
        U[Alert Center Page]
        V[Badge Counter]
        W[10s Polling]
    end
    A --> I
    B --> I
    C --> I
    D --> I
    E --> I
    F --> I
    G --> I
    H --> I
    I --> J
    J --> L
    J --> M
    J --> N
    J --> O
    I --> K
    K --> P
    P --> Q
    P --> R
    Q --> S
    R --> P
    P --> T
    Q --> T
    S --> T
    I --> U
    U --> V
    W --> U`,
  },
  {
    id: 'calibration',
    label: 'Calibration Pipeline',
    desc: 'Symbol-specific weight overrides applied between directive calculation and aggregation. 16 seeded calibrations (DOGEUSD, XAUUSD, NVDA, BTCUSD, EURUSD, TECH100) with weightMultiplier, decayModifier, and volatilityAdjustment.',
    code: `flowchart TB
    subgraph Input["Raw Directive Scores"]
        A[news-sentiment]
        B[rsi-oversold]
        C[macd-crossover]
        D[volume-confirmation]
    end
    subgraph Calibration["Calibration Service"]
        E[(SymbolCalibration<br/>DB Table)]
        F[Memory Cache<br/>startup load]
        G[CalibrationService<br/>applyCalibrations]
    end
    subgraph Adjust["Adjustment Factors"]
        H[weightMultiplier<br/>e.g. 3.0x for DOGE]
        I[decayModifier<br/>time-based reduction]
        J[volatilityAdjustment<br/>regime amplification]
    end
    subgraph Output["Adjusted Scores"]
        K[adjustedScore =<br/>raw x weight x 1+vol]
        L[(Audit Trail<br/>raw + adjusted)]
        M[Weighted Aggregation]
    end
    A --> G
    B --> G
    C --> G
    D --> G
    E --> F
    F --> G
    G --> H
    G --> I
    G --> J
    H --> K
    I --> K
    J --> K
    K --> L
    K --> M`,
  },
  {
    id: 'scoring-gating',
    label: 'Scoring with Protocol Gating',
    desc: 'Multiplicative risk gating: Risk directives gate Technical + Sentiment scores multiplicatively (not additively). Protocol maxPossibleScore = sum of directive maxScores. No artificial 100-cap — scores are unbounded within directive ranges.',
    code: `flowchart TB
    subgraph Directives["Directive Categories"]
        A[Technical<br/>10 directives]
        B[Sentiment<br/>7 directives]
        C[Risk<br/>6 directives]
    end
    subgraph Scoring["Per-Directive Scoring"]
        D[calculate()]
        E[maxScore declared]
        F[confidence + signalClass]
    end
    subgraph Calibration["Calibration Overrides"]
        G[Symbol weights]
        H[Decay modifiers]
        I[Volatility adjustments]
    end
    subgraph Gate["Protocol Risk Gating"]
        J{Tech Score}
        K{Sentiment Score}
        L{Risk Gate}
        M[Multiplicative<br/>Tech × Risk]
        N[Multiplicative<br/>Sent × Risk]
    end
    subgraph Output["Final Output"]
        O[totalScore =<br/>gatedTech + gatedSent]
        P[maxPossibleScore]
        Q[Normalized %]
        R{Entry/Watch<br/>Threshold}
    end
    A --> J
    B --> K
    C --> L
    J --> M
    K --> N
    L --> M
    L --> N
    M --> O
    N --> O
    D --> O
    E --> P
    G --> M
    H --> M
    I --> M
    O --> Q
    P --> Q
    Q --> R`,
  },
  {
    id: 'provider-adapters',
    label: 'Provider Adapter Architecture',
    desc: '10 providers integrated through a factory+adapter pattern: Alpaca, Finnhub, Yahoo Finance, Polygon, Twelve Data, FMP, Trading212, FRED, ECB, MT5 Bridge. Freshness checks, queue processing, normalization, and health monitoring per adapter.',
    code: `flowchart TB
    subgraph Providers["External Providers"]
        A[Alpaca]
        B[Finnhub]
        C[Yahoo Finance]
        D[Polygon]
        E[Twelve Data]
        F[FMP]
        G[Trading212]
        H[FRED]
        I[ECB]
        J[MT5 Bridge]
    end
    subgraph Factory["Provider Factory"]
        K[ProviderRegistry]
        L[Capability Matrix]
        M[Credential Store]
    end
    subgraph Pipeline["Request Pipeline"]
        N[Freshness Check]
        O[Rate Limit Guard]
        P[Queue Processor]
        Q[Adapter Normalizer]
        R[(Stored Data)]
    end
    subgraph Health["Health Monitoring"]
        S[Health Checker]
        T[(Health State)]
        U[API /providers/health]
    end
    subgraph UI["Frontend"]
        V[Provider Status Page]
        W[API Activity Log]
    end
    A --> K
    B --> K
    C --> K
    D --> K
    E --> K
    F --> K
    G --> K
    H --> K
    I --> K
    J --> K
    K --> L
    K --> M
    K --> N
    N -->|stale| O
    N -->|fresh| R
    O -->|ok| P
    O -->|blocked| S
    P --> Q
    Q --> R
    K --> S
    S --> T
    T --> U
    U --> V
    R --> W`,
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
    desc: 'Real-time batch scanner: every 5s, all Tier A/B symbols are scored against their best protocol. Results ranked and displayed on Speed Trading page. Auto-Switch mode automatically changes the active symbol to the highest-scoring opportunity.',
    code: `flowchart TB
    subgraph Trigger["Scan Trigger"]
        A[Every 5 seconds]
        B[Manual refresh]
    end
    subgraph Symbols["Tier A/B Symbols"]
        C[XAUUSD]
        D[BTCUSD]
        E[EURUSD]
        F[GBPUSD]
        G[USDJPY]
        H[USOIL]
        I[SPX500]
        J[TECH100]
        K[ETHUSD]
        L[...more]
    end
    subgraph Scanner["SpeedScanService"]
        M[Symbol→Protocol Map]
        N[Batch Fetch Bars]
        O[ProtocolGatingService.scoreWithGating]
        P[Rank by Composite DESC]
    end
    subgraph Output["Scan Result"]
        Q[🥇 XAUUSD 78 bullish]
        R[🥈 BTCUSD 72 bullish]
        S[🥉 EURUSD 55 neutral]
        T[⛔ USOIL GATED]
    end
    subgraph UI["Speed Trading Page"]
        U[Best Opportunities Panel]
        V[Auto-Switch Toggle]
        W[Switch active symbol]
    end
    A --> M
    B --> M
    C & D & E & F & G & H & I & J & K & L --> N
    N --> O --> P
    P --> Q & R & S & T
    Q & R & S & T --> U
    U --> V --> W`,
  },
  {
    id: 'protocol-calendar',
    label: 'Protocol Calendar — Seasonal Prioritization',
    desc: 'Calendar-driven protocol prioritization: each protocol has seasonal affinity weights. SEES boosts protocols that historically perform well in the current month/season, and deprioritizes those that underperform. Powers the Speed Trading auto-switch intelligence.',
    code: `flowchart LR
    subgraph Input["Calendar Check"]
        A[Today: June 24]
        B[Current month: June]
        C[Current season: Summer]
    end
    subgraph Affinity["Protocol Seasonal Affinity"]
        D[btc-scalp-v1: 0%]
        E[spy-day-v1: +15% — summer chop, earnings lull]
        F[pandemic-v1: 0%]
        G[oil-speed-v1: +10% — hurricane season]
        H[leverage-v2 short: +5% — summer weakness]
        I[momentum-stock-v1: -10% — summer doldrums]
    end
    subgraph Result["SEES Prioritization"]
        J[spy-day-v1]
        K[oil-speed-v1]
        L[leverage-v2 short]
    end
    A & B & C --> D & E & F & G & H & I
    D & E & F & G & H & I --> J & K & L`,
  },
  {
    id: 'seasonality-heatmap',
    label: 'Seasonality Heatmap — Hour x Day Win Rates',
    desc: 'Heatmap showing historical bullish/bearish bias for each hour of each day. Computed from MT5 data. Dark green = 70%+ bullish. Red = 70%+ bearish. The active hour is highlighted. Feeds into session-timing-filter directive.',
    code: `flowchart LR
    subgraph Data["Historical Data"]
        A[MT5 1m candles]
        B[20,000+ bars per symbol]
    end
    subgraph Compute["Seasonality Engine"]
        C[Group by hour x day]
        D[Calculate win rate]
        E[Apply confidence threshold]
    end
    subgraph Output["Heatmap 7x24 Grid"]
        F[Mon 00: green]
        G[Tue 14: red]
        H[Thu 21: green — 68%]
        I[Sat 03: no data]
    end
    subgraph Integration["Directive Feed"]
        J[session-timing-filter]
        K[Chart background zones]
    end
    A --> C --> D --> E
    E --> F & G & H & I
    H --> J --> K`,
  },
  {
    id: 'provider-failover',
    label: 'Provider Failover & Rate Limiting',
    desc: 'AdapterFactory rate-limit-aware provider selection, failover chain, and circuit breaker logic across all 9 registered providers.',
    code: `flowchart TB
    subgraph Request["Incoming Data Request"]
        A[getActive preferredId?]
    end
    subgraph Selection["Rate-Limit-Aware Selection"]
        B{Preferred provider available?}
        B -->|Yes| C[Use preferred]
        B -->|No| D[Scan all active instances]
        D --> E{Rate limit remaining?}
        E -->|Tripped / <5 calls| F[Skip provider]
        E -->|OK| G[Add to candidates]
        G --> H[Sort by remaining calls DESC]
        H --> I[Pick highest headroom]
    end
    subgraph Failover["Failover Chain by Priority"]
        J[1. Alpaca pri=10]
        K[2. Alpha Vantage pri=20]
        L[3. Trading212 pri=30]
        M[4. MT5 pri=40]
        N[5. Polygon pri=45]
        O[6. Finnhub pri=50]
        P[7. FMP pri=50]
        Q[8. Twelve Data pri=55]
        R[9. Yahoo Finance pri=60]
    end
    subgraph Outcome["Result"]
        S[Return best adapter]
        T[Log provider switch]
    end
    A --> B
    I --> S --> T
    F --> J
    J --> K --> L --> M --> N --> O --> P --> Q --> R
    R -->|Last resort| S`,
  },
  {
    id: 't212-portfolio-flow',
    label: 'Trading212 Portfolio Data Flow',
    desc: 'How portfolio data flows from Trading212 API through import, normalization, storage, scoring, to the React UI.',
    code: `flowchart LR
    subgraph External["External API"]
        A[Trading212<br/>live.trading212.com]
    end
    subgraph Import["Import Layer"]
        B[PortfolioController<br/>POST /import]
        C[Trading212ImportService]
        D[PortfolioService<br/>getPortfolio]
    end
    subgraph Transform["Transform"]
        E[Ticker Clean<br/>strip _US_EQ, _EQ]
        F[Position Normalize<br/>value, P&L, allocation]
        G[Symbol DB Upsert]
    end
    subgraph Scoring["Scoring Pipeline"]
        H[ScoringService.rankAll]
        I[getPortfolioScores]
        J[Score Map by Ticker]
    end
    subgraph UI["React Frontend"]
        K[AccountsDashboardPage]
        L[Portfolio Summary]
        M[Position Table]
        N[Score Signals]
    end
    A -->|equity/portfolio| B
    A -->|equity/account/cash| B
    B --> C --> D
    D --> E --> F
    D --> G
    F --> I --> H --> J
    D --> K
    I --> K
    K --> L
    K --> M
    K --> N`,
  },
  {
    id: 'earnings-pipeline',
    label: 'Earnings Calendar Data Pipeline',
    desc: 'How earnings data flows from Alpha Vantage, Finnhub, and FMP through adapters into the Earnings table, feeding the earnings-proximity directive and UI.',
    code: `flowchart TB
    subgraph Sources["Data Sources"]
        A[Alpha Vantage<br/>EARNINGS_CALENDAR]
        B[Finnhub<br/>/calendar/earnings]
        C[FMP<br/>/earning_calendar]
    end
    subgraph Adapters["Provider Adapters"]
        D[AlphaVantageAdapter<br/>getEarningsCalendar]
        E[FinnhubAdapter<br/>getEarningsCalendar]
        F[FmpAdapter<br/>getEarningsCalendar]
    end
    subgraph Pipeline["Processing"]
        G[EarningsService<br/>normalize & deduplicate]
        H[(Earnings Table)]
        I[EarningsProximityDirective<br/>calculate score]
    end
    subgraph Output["Consumption"]
        J[EarningsCalendarPage<br/>filtered UI]
        K[Portfolio Cross-Reference<br/>holdings + next earnings]
        L[SEES Scoring<br/>earnings-proximity score]
    end
    A --> D
    B --> E
    C --> F
    D --> G
    E --> G
    F --> G
    G --> H
    H --> I
    I --> L
    H --> J
    H --> K`,
  },
  {
    id: 'data-flow-architecture',
    label: 'Data Flow Architecture',
    desc: 'How data flows from providers through import, storage, directives, protocols, and strategies to the UI. Red paths show current gaps — directives that bypass the database. Orange indicates missing pieces.',
    code: `flowchart TB
    subgraph PROVIDER["🔌 PROVIDER LAYER"]
        MT5["MT5 Bridge<br/>free, unlimited"]
        FH["Finnhub<br/>60/min"]
        AV["Alpha Vantage<br/>5/min"]
        FMP["FMP<br/>250/day"]
        T212["Trading212<br/>demo"]
    end
    subgraph IMPORT["📥 IMPORT LAYER"]
        DIR["DataImportHandler<br/>· Scheduled cron<br/>· Freshness-triggered<br/>· Demand-triggered<br/>· Rate-limit aware"]
    end
    subgraph STORAGE["💾 STORAGE LAYER"]
        EARN["✅ EarningsEvent"]
        NEWS["✅ NewsArticle"]
        BARS["✅ MarketBar"]
        MACRO["❌ MacroSnapshot"]
        LOG["✅ DataImportLog"]
        MENTION["❌ SocialMention"]
        INSIDER["❌ InsiderTransaction"]
    end
    subgraph DIRECTIVE["🎯 DIRECTIVE LAYER"]
        GOOD["✅ 90 directives<br/>DB-only"]
        BAD["❌ 3 directives<br/>call providers"]
    end
    subgraph PROTOCOL["📊 PROTOCOL LAYER"]
        PG["Protocol Groups"]
        DEG["❌ Degradation rules"]
    end
    subgraph STRATEGY["⚡ STRATEGY LAYER"]
        TS["Trading Strategies"]
        AL["Automation Loop"]
        SDEG["❌ Stale-data safety"]
    end
    subgraph UI["🖥 PRESENTATION"]
        DE["Data Elements"]
        FRESH["⚠️ Freshness indicators"]
        CM["Capability Map"]
    end
    PROVIDER --> IMPORT
    IMPORT --> STORAGE
    STORAGE --> DIRECTIVE
    BAD -.->|"❌ bypasses DB"| PROVIDER
    DIRECTIVE --> PROTOCOL
    PROTOCOL --> STRATEGY
    STRATEGY --> UI
    style BAD fill:#ef4444,color:#fff
    style MACRO fill:#f59e0b,color:#000
    style MENTION fill:#f59e0b,color:#000
    style INSIDER fill:#f59e0b,color:#000
    style DEG fill:#f59e0b,color:#000
    style SDEG fill:#f59e0b,color:#000
    style FRESH fill:#f59e0b,color:#000`,
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
