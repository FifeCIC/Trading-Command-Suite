# automation-timeline: Event-Aware Decision Engine & Visual Timeline

**Prompt ID:** automation-timeline
**Date:** 2026-06-26
**Status:** ready
**Depends on:** `unified-broker-interface.prompt.md`

## Goal

Build a timeline system that the automation loop consults BEFORE making any trading decision. The timeline is not just a passive calendar — it's an active decision modifier. It answers: "Given everything happening right now (and soon), should we trade this symbol?"

## The Concept

```
                    TIMELINE AS DECISION ENGINE
                    ════════════════════════════

  PAST                      NOW                       FUTURE
  ──────────────────────────┬──────────────────────────────▶
                             │
   14:28  NVDA scored 78     │  15:30  FOMC minutes
   14:15  PLTR gated         │         → Risk 0.5× all
   14:10  EURUSD executed    │
                             │  16:00  Market close
                             │         → Flatten day trades
                             │
                             │  Tomorrow  AAPL earnings
                             │             → Block AAPL
                             │
                             │  Fri  London session
                             │       → Boost XAU protocols
```

The automation loop asks the timeline:
1. "Any global risk events in the next 2 hours?" → adjust all position sizing
2. "Any events for symbol NVDA?" → gate if earnings within 48h
3. "What session is active now?" → boost matching protocols
4. "What's the seasonality for this hour?" → adjust threshold

## Timeline Event Types

### 1. Automation Events (system-generated)
- **TICK_START** — Scoring loop iteration beginning
- **TICK_END** — Scoring loop iteration complete
- **SCORE** — Symbol scored (composite, signal)
- **EVALUATE** — Strategy evaluated (passed/failed, checks)
- **SIGNAL** — Manual mode signal logged
- **QUEUED** — Semi-auto trade queued for approval
- **EXECUTED** — Trade placed
- **REJECTED** — Trade rejected (gate, threshold, timeline block)
- **FAILED** — Trade attempt failed
- **PAUSED** — Loop or strategy paused
- **RESUMED** — Loop or strategy resumed
- **EMERGENCY_STOP** — Emergency stop activated

### 2. Economic Events (configured/scheduled)
- **FOMC** — Federal Reserve announcements, minutes
- **NFP** — Non-Farm Payrolls
- **CPI** — Consumer Price Index
- **PPI** — Producer Price Index
- **GDP** — Gross Domestic Product
- **PMI** — Purchasing Managers Index
- **OIL_INVENTORIES** — EIA crude oil inventories
- **JOBLESS_CLAIMS** — Weekly unemployment claims
- **RETAIL_SALES** — Monthly retail sales

### 3. Earnings Events (from Finnhub/Polygon)
- **EARNINGS** — Company earnings report
- **EARNINGS_CALL** — Earnings conference call

### 4. Market Session Events (computed)
- **SESSION_OPEN** — London, NY, Tokyo, Sydney opens
- **SESSION_CLOSE** — Session closes
- **SESSION_OVERLAP** — London+NY overlap (high volume)

### 5. Seasonality Windows (computed from SeasonalityService)
- **BULLISH_HOUR** — Hour×day with >60% win rate
- **BEARISH_HOUR** — Hour×day with <40% win rate
- **NEUTRAL_HOUR** — Hour×day with 40-60% win rate

### 6. Protocol Activation Windows (computed)
- **PROTOCOL_WINDOW_OPEN** — A protocol's ideal trading window begins
- **PROTOCOL_WINDOW_CLOSE** — A protocol's ideal trading window ends

## TimelineEvent Interface

```typescript
interface TimelineEvent {
  id: string;
  type: 'TICK_START' | 'TICK_END' | 'SCORE' | 'EVALUATE' | 'SIGNAL' | 'QUEUED' 
     | 'EXECUTED' | 'REJECTED' | 'FAILED' | 'PAUSED' | 'RESUMED' | 'EMERGENCY_STOP'
     | 'FOMC' | 'NFP' | 'CPI' | 'PPI' | 'GDP' | 'PMI' | 'OIL_INVENTORIES'
     | 'JOBLESS_CLAIMS' | 'RETAIL_SALES'
     | 'EARNINGS' | 'EARNINGS_CALL'
     | 'SESSION_OPEN' | 'SESSION_CLOSE' | 'SESSION_OVERLAP'
     | 'BULLISH_HOUR' | 'BEARISH_HOUR' | 'NEUTRAL_HOUR'
     | 'PROTOCOL_WINDOW_OPEN' | 'PROTOCOL_WINDOW_CLOSE';
     
  // Timing
  startsAt: string;        // ISO 8601
  endsAt?: string;         // For window/ranged events
  durationMinutes?: number;
  
  // Scope
  scope: 'global' | 'broker' | 'symbol' | 'session' | 'protocol';
  brokerId?: string;       // if scope=broker
  symbol?: string;         // if scope=symbol
  session?: string;        // if scope=session: 'london' | 'ny' | 'tokyo' | 'sydney'
  protocolId?: string;     // if scope=protocol
  
  // Decision impact
  action: 'block' | 'gate' | 'boost' | 'reduce' | 'info';
  riskMultiplier?: number; // e.g. 0.5 for FOMC, 1.2 for session overlap
  thresholdAdjust?: number; // e.g. +10 to trade threshold
  
  // Display
  label: string;           // "FOMC minutes released"
  description?: string;    // Longer explanation
  icon?: string;           // Emoji or icon name
  color?: string;          // For timeline rendering
  
  // Source
  source: 'system' | 'calendar' | 'earnings' | 'seasonality' | 'protocol';
  
  // Metadata
  createdAt: string;
  data?: Record<string, any>; // Event-specific data
}
```

## TimelineService

```typescript
@Injectable()
export class TimelineService {
  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly seasonalityService: SeasonalityService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Get all events that are active NOW or within the lookahead window.
   * Called by the automation loop every tick.
   */
  async getActiveEvents(lookaheadMinutes = 120): Promise<TimelineEvent[]> {
    const now = new Date();
    const lookahead = new Date(now.getTime() + lookaheadMinutes * 60000);
    
    const events: TimelineEvent[] = [];
    
    // 1. Economic calendar events (from DB or provider)
    events.push(...await this.getEconomicEvents(now, lookahead));
    
    // 2. Earnings events (from Finnhub/Polygon adapter)
    events.push(...await this.getEarningsEvents(now, lookahead));
    
    // 3. Session windows (computed)
    events.push(...this.getSessionEvents(now, lookahead));
    
    // 4. Seasonality windows (computed)
    events.push(...await this.getSeasonalityEvents(now));
    
    // 5. Protocol activation windows (computed)
    events.push(...this.getProtocolWindows(now, lookahead));
    
    return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  /**
   * Get events relevant to a specific symbol.
   * Called when scoring individual positions.
   */
  async getSymbolEvents(symbol: string, lookaheadHours = 48): Promise<TimelineEvent[]> {
    const all = await this.getActiveEvents(lookaheadHours * 60);
    return all.filter(e => 
      e.scope === 'global' || 
      (e.scope === 'symbol' && e.symbol === symbol)
    );
  }

  /**
   * Compute the aggregate risk multiplier from active events.
   */
  computeRiskMultiplier(events: TimelineEvent[]): number {
    let multiplier = 1.0;
    for (const event of events) {
      if (event.action === 'block') return 0; // Can't trade
      if (event.action === 'gate' || event.action === 'reduce') {
        multiplier *= (event.riskMultiplier ?? 0.5);
      }
      if (event.action === 'boost') {
        multiplier *= (event.riskMultiplier ?? 1.2);
      }
    }
    return Math.max(0, Math.min(2, multiplier)); // Clamp 0-2
  }

  /**
   * Get the timeline as a flat list for the dashboard rendering.
   * Includes PAST events (last 2h) + NOW + FUTURE events (next 24h).
   */
  async getDashboardTimeline(): Promise<{
    past: TimelineEvent[];
    now: TimelineEvent[];
    upcoming: TimelineEvent[];
  }> {
    // ... query and partition events
  }

  // ── Economic Events ──────────────────────────────────

  private async getEconomicEvents(now: Date, lookahead: Date): Promise<TimelineEvent[]> {
    // Fetch from DB (user-configured or imported)
    // Default: hardcoded recurring events (FOMC schedule, NFP first Friday, etc.)
    const events = await this.prisma.economicEvent.findMany({
      where: {
        startsAt: { gte: now, lte: lookahead },
      },
    });
    
    return events.map(e => ({
      id: e.id,
      type: e.eventType as TimelineEvent['type'],
      startsAt: e.startsAt.toISOString(),
      scope: 'global',
      action: 'reduce',
      riskMultiplier: this.getEventRiskMultiplier(e.eventType),
      thresholdAdjust: this.getEventThresholdAdjust(e.eventType),
      label: e.label,
      description: e.description,
      icon: this.getEventIcon(e.eventType),
      color: '#e74c3c',
      source: 'calendar',
      createdAt: e.createdAt.toISOString(),
    }));
  }

  // ── Earnings Events ──────────────────────────────────

  private async getEarningsEvents(now: Date, lookahead: Date): Promise<TimelineEvent[]> {
    // Try Finnhub adapter first, fall back to Polygon
    const finnhub = this.adapterFactory.create('finnhub');
    if (finnhub?.getEarningsCalendar) {
      const earnings = await finnhub.getEarningsCalendar(undefined, 1);
      return (earnings || [])
        .filter(e => {
          const date = new Date(e.date);
          return date >= now && date <= lookahead;
        })
        .map(e => ({
          id: `earnings-${e.symbol}-${e.date}`,
          type: 'EARNINGS' as const,
          startsAt: new Date(e.date).toISOString(),
          scope: 'symbol' as const,
          symbol: e.symbol,
          action: 'block' as const,
          label: `${e.symbol} earnings`,
          description: `Earnings report for ${e.symbol}`,
          icon: '📊',
          color: '#e74c3c',
          source: 'earnings' as const,
          createdAt: new Date().toISOString(),
        }));
    }
    return [];
  }

  // ── Session Events ───────────────────────────────────

  private getSessionEvents(now: Date, lookahead: Date): TimelineEvent[] {
    const events: TimelineEvent[] = [];
    const sessions = [
      { name: 'sydney', open: 22, close: 7, tz: 'UTC' },
      { name: 'tokyo', open: 0, close: 9, tz: 'UTC' },
      { name: 'london', open: 8, close: 17, tz: 'UTC' },
      { name: 'ny', open: 13, close: 22, tz: 'UTC' },
    ];
    
    // Compute session windows for next 24h
    // Add SESSION_OPEN, SESSION_CLOSE, SESSION_OVERLAP events
    // ...
    
    return events;
  }

  // ── Seasonality Events ───────────────────────────────

  private async getSeasonalityEvents(now: Date): Promise<TimelineEvent[]> {
    const dayOfWeek = now.getUTCDay();
    const hour = now.getUTCHours();
    
    // Get seasonality for tracked symbols
    const events: TimelineEvent[] = [];
    // Use existing SeasonalityService to compute hour×day win rates
    // ...
    
    return events;
  }

  // ── Protocol Windows ─────────────────────────────────

  private getProtocolWindows(now: Date, lookahead: Date): TimelineEvent[] {
    // Each protocol defines its ideal trading windows
    // e.g., xau-speed-v1: active during London+NY sessions
    // e.g., forex-session-v1: active during London session
    // ...
    
    return [];
  }

  // ── Helpers ──────────────────────────────────────────

  private getEventRiskMultiplier(eventType: string): number {
    const map: Record<string, number> = {
      FOMC: 0.5, NFP: 0.3, CPI: 0.5, PPI: 0.7,
      GDP: 0.7, PMI: 0.8, OIL_INVENTORIES: 0.8,
      JOBLESS_CLAIMS: 0.9, RETAIL_SALES: 0.8,
    };
    return map[eventType] ?? 0.8;
  }

  private getEventThresholdAdjust(eventType: string): number {
    const map: Record<string, number> = {
      FOMC: 15, NFP: 20, CPI: 15,
    };
    return map[eventType] ?? 5;
  }

  private getEventIcon(eventType: string): string {
    const map: Record<string, string> = {
      FOMC: '🏛️', NFP: '👷', CPI: '📈', PPI: '🏭',
      GDP: '📊', PMI: '🏗️', OIL_INVENTORIES: '🛢️',
      JOBLESS_CLAIMS: '📋', RETAIL_SALES: '🛒',
    };
    return map[eventType] ?? '📅';
  }
}
```

## Visual Timeline Component

The `LiveTimeline` component on the Automation Dashboard renders events as a vertical scrolling strip:

```
┌──────────────────────────────────────┐
│  LIVE TIMELINE                       │
│                                      │
│  ⚫ NOW ─────────────────────────    │
│  │                                   │
│  ├─ 🔄 14:32:05  SCORE              │
│  │   NVDA → 78 BUY                   │
│  │   MSTR → 72 BUY                   │
│  │   PLTR → 65 BUY                   │
│  │                                   │
│  ● NOW ─────────────────────────    │
│  │                                   │
│  ├─ ⏳ 14:37:05  NEXT TICK          │
│  │   in 4m 32s                       │
│  │                                   │
│  ├─ 🏛️ 15:30  FOMC MINUTES         │
│  │   Risk 0.5× | Threshold +10      │
│  │   All strategies affected         │
│  │                                   │
│  ├─ 🛢️ 15:30  OIL INVENTORIES      │
│  │   Risk 0.8×                       │
│  │                                   │
│  ├─ 🔔 16:00  NY SESSION CLOSE      │
│  │   Flatten day trades              │
│  │                                   │
│  ├─ 📊 Tomorrow  AAPL EARNINGS      │
│  │   Block AAPL trading              │
│  │                                   │
│  └─ 🌅 Fri 08:00  LONDON OPEN       │
│      Boost XAU, forex protocols      │
│                                      │
└──────────────────────────────────────┘
```

### Visual Design

- **Past events**: dimmed, gray, collapsed by default (expandable)
- **Current events**: bright, pulsing accent border
- **Upcoming events**: full color, sorted by proximity
- **High-impact events**: red left border, bold label
- **Opportunity events**: green left border
- **Info events**: blue left border
- Events slide upward as time passes (CSS transition)
- Auto-scroll keeps NOW in view
- Click an event to see full details / expand

## How the Loop Consults the Timeline

```typescript
// In AutomationLoopService.tick():

// Step 1: Get active events
const events = await this.timelineService.getActiveEvents(120);

// Step 2: Compute global risk
const globalEvents = events.filter(e => e.scope === 'global');
const globalRisk = this.timelineService.computeRiskMultiplier(globalEvents);
// → 0.5 if FOMC in 30min, 1.0 if clear

// Step 3: For each symbol being scored
for (const pos of positions) {
  const symEvents = events.filter(e => 
    (e.scope === 'symbol' && e.symbol === pos.symbol) ||
    e.scope === 'global'
  );
  
  // If any event blocks this symbol, skip entirely
  if (symEvents.some(e => e.action === 'block')) {
    decisions.push({ decision: 'BLOCKED', reason: symEvents[0].label });
    continue;
  }
  
  // Compute timeline-adjusted risk multiplier
  const timelineRisk = this.timelineService.computeRiskMultiplier(symEvents);
  
  // Pass to scoring
  const score = await this.scoringService.scoreWithGating(pos.symbol, {
    timelineMultiplier: globalRisk * timelineRisk,
  });
}
```

## Timeline Configuration UI

A panel to add/configure economic events:

```
┌──────────────────────────────────────────────────┐
│  Timeline Configuration                          │
│                                                  │
│  ☑ Auto-import FOMC schedule                     │
│  ☑ Auto-import NFP (first Friday monthly)        │
│  ☑ Auto-import CPI, PPI, GDP, PMI                │
│  ☑ Show earnings for held symbols                │
│  ☑ Show earnings for watchlist symbols            │
│  ☑ Show session open/close windows               │
│  ☑ Show seasonality windows                      │
│  ☑ Show protocol activation windows              │
│                                                  │
│  Custom Events:                                  │
│  ┌──────────────────────────────────────────┐   │
│  │ Jul 4  US Independence Day               │   │
│  │        Block all US equities             │   │
│  │                                [Delete]  │   │
│  ├──────────────────────────────────────────┤   │
│  │ [Add Custom Event...]                    │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  Lookahead: [24] hours for dashboard             │
│  Loop lookahead: [2] hours for decision making   │
│  Earnings gate: [48] hours before report         │
└──────────────────────────────────────────────────┘
```

## Database Schema

```prisma
model TimelineEvent {
  id          String   @id @default(uuid())
  type        String   // FOMC, NFP, CPI, EARNINGS, etc.
  scope       String   // global, broker, symbol, session, protocol
  brokerId    String?
  symbol      String?
  session     String?
  protocolId  String?
  
  action      String   // block, gate, boost, reduce, info
  riskMultiplier Float?
  thresholdAdjust Int?
  
  label       String
  description String?
  icon        String?
  color       String?
  
  startsAt    DateTime
  endsAt      DateTime?
  durationMin Int?
  
  source      String   // system, calendar, earnings, seasonality, protocol
  metadata    Json?
  
  createdAt   DateTime @default(now())
  
  @@index([startsAt])
  @@index([symbol])
  @@index([scope, startsAt])
}
```

## Integration with Existing SeasonalityService

The `SeasonalityService` we already built (hour×day win rate heatmap) feeds the timeline:

```typescript
// In TimelineService.getSeasonalityEvents():
const seasonality = await this.seasonalityService.compute(symbol);
const currentHour = new Date().getUTCHours();
const currentDay = new Date().getUTCDay();
const cell = seasonality.grid[currentDay][currentHour];

if (cell.bullishPct >= 60) {
  events.push({
    type: 'BULLISH_HOUR',
    scope: 'symbol',
    symbol,
    action: 'boost',
    riskMultiplier: 1.1,
    thresholdAdjust: -5,
    label: `${symbol} seasonality: ${cell.bullishPct}% bullish this hour`,
    source: 'seasonality',
  });
}
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/automation/timeline` | Full timeline: past (2h), now, upcoming (24h) |
| GET | `/api/automation/timeline/events` | Raw events list with filters (?scope=global&type=FOMC) |
| GET | `/api/automation/timeline/symbol/:symbol` | Events relevant to a specific symbol |
| POST | `/api/automation/timeline/events` | Add custom event |
| DELETE | `/api/automation/timeline/events/:id` | Remove custom event |
| GET | `/api/automation/timeline/config` | Get timeline configuration |
| PUT | `/api/automation/timeline/config` | Update timeline configuration |

## Files

- `nest/src/modules/automation/timeline.service.ts` — TimelineService
- `nest/src/modules/automation/timeline.controller.ts` — REST endpoints
- `src/components/automation/LiveTimeline.jsx` — visual timeline component
- `src/components/automation/LiveTimeline.css` — timeline styles
- `src/components/automation/TimelineConfig.jsx` — configuration panel
- `nest/prisma/schema.prisma` — `TimelineEvent` model
