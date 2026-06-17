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
];

export default function DiagramsPage() {
  const [active, setActive] = useState(DIAGRAMS[0].id);
  const containerRef = useRef(null);

  const diagram = DIAGRAMS.find((d) => d.id === active) || DIAGRAMS[0];

  useEffect(() => {
    if (!containerRef.current) return;
    const id = `mermaid-${diagram.id}`;
    const el = containerRef.current.querySelector(`#${id}`);
    if (el && el.innerHTML === '') {
      mermaid.render(`${id}-svg`, diagram.code).then(({ svg }) => {
        el.innerHTML = svg;
      });
    }
  }, [active, diagram]);

  return (
    <div className="pf-page" style={{ maxWidth: '100%' }}>
      <div className="pf-header">
        <div>
          <h1>System Diagrams</h1>
          <p className="pf-hint" style={{ margin: '0.25rem 0 0' }}>Architecture and workflow diagrams for the Trading Command Suite.</p>
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
        <div id={`mermaid-${diagram.id}`} style={{ minHeight: '200px' }} />
      </div>

      {/* ── Description ─────────────────────────────────────── */}
      <div style={{ marginTop: '0.75rem', padding: '0.5rem 0' }}>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem', margin: 0 }}>{diagram.desc}</p>
      </div>
    </div>
  );
}
