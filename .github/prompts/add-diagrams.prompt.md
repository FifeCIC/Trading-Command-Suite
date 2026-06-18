---
description: "Add new Mermaid diagrams to the Diagrams page (/builder/diagrams). Use when: adding system architecture diagrams, data flow diagrams, provider failover diagrams, or making the app's internal architecture clearer."
argument-hint: "Describe the diagrams to add..."
---
Add new Mermaid diagrams to the Diagrams page at `src/pages/DiagramsPage.jsx`.

## Current Diagrams (5 total)
- `sees-research` — SEES Research Phase
- `sees-trading` — SEES Full Trading Lifecycle  
- `data-arch` — Data Architecture
- `component-arch` — Component & Route Architecture
- `deployment` — Deployment & Infrastructure

## Diagrams to Add

### 1. Provider Failover & Rate Limiting (`provider-failover`)
Shows the AdapterFactory's rate-limit-aware provider selection, failover chain, and circuit breaker logic across all 9 registered providers.

```mermaid
flowchart TB
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
    R -->|Last resort| S
```

### 2. Trading212 Portfolio Data Flow (`t212-portfolio-flow`)
Shows how portfolio data flows from Trading212 API → import → normalize → storage → scoring → UI.

```mermaid
flowchart LR
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
    K --> N
```

### 3. Earnings Calendar Data Pipeline (`earnings-pipeline`)
Shows how earnings data should flow once Alpha Vantage EARNINGS_CALENDAR is wired, feeding the earnings-proximity directive.

```mermaid
flowchart TB
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
    H --> K
```

## Instructions
1. Add each diagram object to the `DIAGRAMS` array in `src/pages/DiagramsPage.jsx`
2. Each object needs: `id`, `label`, `desc`, and `code` (the Mermaid code string)
3. Use `flowchart TB` (top-bottom) or `flowchart LR` (left-right) as appropriate
4. Keep descriptions to one sentence
5. Verify the Mermaid renders correctly by visiting `/builder/diagrams`

## 🏗️ Post-Implementation: Update Architecture

Using the `update-architecture-framework` skill, update `/builder/architecture-framework`:

1. **STATUS_SNAPSHOT** — Add: `[DATE]: Three new system diagrams added — Provider Failover & Rate Limiting, Trading212 Portfolio Data Flow, Earnings Calendar Data Pipeline.`
2. **REVISION_LOG** — Add entry: `Architecture diagrams — provider failover, portfolio flow, earnings pipeline`
