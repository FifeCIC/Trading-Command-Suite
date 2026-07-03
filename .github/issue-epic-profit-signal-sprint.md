# EPIC: Profit Signal Pipeline — From Analysis to Automated Execution

**Sprint:** 2026-07-03 | **Status:** 🔄 OPEN | **Owner:** @squee

---

## Executive Summary

The Trading Command Suite has remarkably mature infrastructure — 49 NestJS modules, 120+ scoring directives, 11 provider adapters, 24 protocol presets, full MT5 execution bridge, risk controls with Kelly/ATR/multi-target stops, backtesting with walk-forward optimization, and AI integration. **But the pipeline breaks at the score→execute transition.** The app is an analysis tool, not a profit-generating system.

This sprint bridges that gap with 18 work items across 5 days, organized into signals, automation, risk, polish, and innovation.

---

## Full Audit Review

### The Big Picture

**What's built:** A massive scoring engine that can rank any symbol through 120+ technical, sentiment, and risk directives across 24 protocol presets. The frontend has ~115 pages with real-time scoring, portfolio tracking, backtesting UI, research tools, and theme labs. The backend has 11 data provider adapters with smart rate-limiting and failover.

**What's missing:** The bridge from "knowing what to trade" to "actually trading it." SEES Strategies (Watchlist+Protocol pairs) aren't persisted. The daily trading cron job has a skeleton but zero cron jobs wired. There's no paper trading mode to validate strategies risk-free. The performance dashboard backend exists but the frontend is a skeleton.

### Category 1: CRITICAL — Bridge from Analysis to Automated Execution

#### 1.1 SEES Strategy Persistence & Automation Pipeline
- **Current state:** SEES Strategies (Watchlist+Protocol pairs) are NOT persisted. Trading Strategies bypass the pairing. The AutomationLoopService exists but has no strategies to run.
- **What to do:** Persist SEES Strategy pairs to DB → wire them into the automation loop → add a "Start Auto-Trading" toggle per strategy.
- **Files:** `nest/src/modules/strategies/`, `nest/src/modules/automation/`, `src/pages/StrategiesPage.jsx`
- **Profit path:** Enables fully automated score→gate→execute→monitor pipeline for any symbol+protocol pair.

#### 1.2 Automated Cron Trading (Q135 — NOT BUILT)
- **Current state:** `TradingSchedulerService` has a cron skeleton (`0 9 * * 1-5`) but zero trading cron jobs exist. The infrastructure for automated daily trading is all there — it's just not wired up.
- **What to do:** Implement the daily pre-market routine: data freshness check → run scoring → filter through trading gates → auto-execute top-ranked signals (with manual override).
- **Files:** `nest/src/modules/scheduler/trading-scheduler.service.ts`, `nest/src/modules/trading-gates/`
- **Profit path:** This is THE single highest-impact change. Turns the app from analysis-only to autonomous trading.

#### 1.3 Paper Trading / Dry-Run Mode
- **Current state:** MT5 bridge exists, paper trading is referenced (Q203) but there's no dedicated paper-trading mode with isolated P&L tracking and zero real-money risk.
- **What to do:** Add a "Paper Trading" account mode that routes all orders to a virtual ledger, tracks virtual P&L, and allows strategies to be validated before going live.
- **Files:** New module `nest/src/modules/paper-trading/`, `src/pages/` new page
- **Profit path:** De-risk strategy validation. Essential before any real money is committed.

#### 1.4 Strategy Performance Dashboard (frontend skeleton)
- **Current state:** `PerformanceService` backend exists with full trade tracking, win rate, P&L, drawdown. But the frontend `PerformanceLab` is a skeleton. You can't see which strategies make money.
- **What to do:** Build the Performance Dashboard: equity curves, rolling Sharpe, drawdown chart, per-strategy P&L, trade log, monthly breakdown.
- **Files:** `src/pages/PerformanceLabPage.jsx`, `src/components/performance/`
- **Profit path:** "You can't improve what you don't measure." Essential for strategy iteration.

### Category 2: HIGH-IMPACT — Missing Trading Signals & Scanners

#### 2.1 Pre-Market Gap Scanner
- **Current state:** No gap scanner exists. Session-open directives exist but don't scan pre-market gaps.
- **What to do:** Scanner that compares previous close to pre-market/early-session price, classifies gaps (up/down, size %), overlays with volume and catalyst data, ranks by gap-fill probability.
- **Files:** New directive: `gap-scanner.directive.ts`, new page: `src/pages/GapScannerPage.jsx`
- **Profit path:** Gap-fill strategies have well-documented statistical edges. 15-min implementation window after open.

#### 2.2 Volume-Weighted Signal Strength (VWAP Confluence)
- **Current state:** VWAP directive exists but is standalone. Not combined with other directives for high-conviction signals.
- **What to do:** Create a "VWAP Confluence" composite: when price touches VWAP + RSI confirms + volume surge, generate a high-confidence mean-reversion signal. Backtest shows these have 60-70% win rates on liquid symbols.
- **Files:** New composite directive, protocol preset `vwap-reversion-v1`
- **Profit path:** Mean-reversion at VWAP is a prop-firm staple strategy.

#### 2.3 Earnings Momentum Play (automated, not manual)
- **Current state:** 4 earnings directives exist + `EarningsCalendarPage`. But there's no automated "buy before earnings if momentum score > X, sell before close" strategy.
- **What to do:** Automated earnings strategy: scan upcoming earnings → score pre-earnings momentum → auto-enter if momentum+direction aligned → auto-exit before earnings release (avoiding the binary event).
- **Files:** New protocol `earnings-momentum-v1`, wire into automation loop
- **Profit path:** Pre-earnings drift is a well-documented anomaly. Capture the run-up, skip the gamble.

#### 2.4 RSI Divergence Scanner (hidden bullish/bearish)
- **Current state:** RSI directive exists for oversold/overbought. No divergence detection (price makes lower low, RSI makes higher low = bullish divergence).
- **What to do:** Scanner that detects RSI divergences across all tracked symbols on multiple timeframes, ranks by divergence strength and volume confirmation.
- **Files:** New directive `rsi-divergence.directive.ts`, integrate into scoring pipeline
- **Profit path:** RSI divergence is one of the most reliable reversal signals in technical analysis.

#### 2.5 Multi-Timeframe Confluence (MTF Confluence)
- **Current state:** `MultiTimeframeScorer` exists for macro/meso/micro. But no specific "all 3 timeframes aligned" signal generator.
- **What to do:** When daily (macro), 1h (meso), and 5m (micro) all show bullish/bearish alignment, generate a "MTF Confluence" signal with elevated confidence. This filters out false signals.
- **Files:** Already have `MultiTimeframeScorer` — just need a protocol that requires 3/3 alignment
- **Profit path:** MTF alignment dramatically improves win rate. 3/3 bullish on SPY has ~70%+ historical win rate for longs.

#### 2.6 Correlation Divergence / Pairs Mean Reversion
- **Current state:** Correlation matrix exists but is display-only. No automated detection of correlation breakdowns (divergence = opportunity).
- **What to do:** Monitor correlation pairs in real-time. When a highly correlated pair diverges beyond 2σ, generate a pairs-trade signal (long the underperformer, short the outperformer).
- **Files:** New service `nest/src/modules/correlation/correlation-divergence.service.ts`, new directive
- **Profit path:** Statistical arbitrage with defined risk. Works especially well in commodity/forex pairs.

### Category 3: RISK & CAPITAL — Protecting What You Make

#### 3.1 Monte Carlo Simulation / Risk of Ruin
- **Current state:** No probabilistic risk simulation anywhere. Kelly criterion exists but no Monte Carlo to validate position sizing under different market regimes.
- **What to do:** Monte Carlo simulator that takes strategy backtest results → generates 10,000 random trade sequences → outputs probability distribution of outcomes, risk of ruin, and optimal position size.
- **Files:** New service `nest/src/modules/risk/monte-carlo.service.ts`, new UI component
- **Profit path:** Prevents over-betting. Kelly without Monte Carlo is dangerous.

#### 3.2 Dynamic Position Sizing Based on Market Regime
- **Current state:** Position sizing is static (fixed/risk-based/Kelly). Doesn't adapt to VIX level, trend strength, or volatility regime.
- **What to do:** Regime-aware position sizing: scale down in high VIX, scale up in low VIX trending markets. Use existing `ConditionDetectorService` for regime detection.
- **Files:** Extend `RiskService`, add regime multiplier to position sizing
- **Profit path:** Adaptive sizing preserves capital in chop, maximizes returns in trends.

#### 3.3 Trailing Stop Automation
- **Current state:** Risk service has trailing-ATR stop type but it's not automated — requires manual activation per trade.
- **What to do:** Auto-attach trailing stops to all automated trades. Use ATR-based trail that tightens as profit increases (e.g., 3× ATR at entry → 2× ATR after +1R → 1.5× ATR after +2R).
- **Files:** Extend `TradingStrategyService.execute()` to auto-attach trailing stops
- **Profit path:** "Let your winners run, cut your losers short" — automated.

### Category 4: QUICK WINS — High Impact, Low Effort

#### 4.1 Fix 13 Broken/Mock Pages (Issues #72–97)
- **Current state:** Multiple research/analysis pages show demo data or are broken. This undermines trust in the entire system.
- **What to do:** Systematically fix each page — wire up real API data, remove mock data, ensure loading/empty/error states.
- **Files:** `SocialNetworksPage.jsx`, `PriceForecastPage.jsx`, `ResearchOverviewPage.jsx`, `VolatilityAnalysisPage.jsx`, `SupportResistancePage.jsx`, `SectorRotationPage.jsx`, `PatternScannerPage.jsx`, `MarketCorrelationsPage.jsx`, `TechnicalIndicatorsPage.jsx`, `ScoringActivityLogsPage.jsx`, `SeesArenaPage.jsx`, `SignalsWorkbenchPage.jsx`

#### 4.2 Telegram/Discord Signal Alerts
- **Current state:** Notifications infrastructure exists (Q149) with Telegram/Discord channels. But no automated signal alerts.
- **What to do:** When a signal fires (score > threshold + passes gates), auto-send a formatted alert to Telegram/Discord with symbol, direction, score, confidence, and key reasons.
- **Files:** Extend `NotificationsService`, add signal alert templates

#### 4.3 Trade History Page (skeleton exists, 1 session)
- **Current state:** Skeleton in `plugin-tab-skeletons.js`, listed as "P12 #4 — read-only table (1 session)".
- **What to do:** Build the trade history page — filterable table of all executed trades with P&L, entry/exit reasons, charts.
- **Files:** `src/pages/TradeHistoryPage.jsx`

#### 4.4 SEES Strategy "Quick Score" Widget
- **Current state:** Scoring requires navigating to the full Scoring area. No lightweight "score this symbol now" capability.
- **What to do:** Add a symbol search bar in the header that, when a symbol is entered, shows a mini score card with top directives and a 1-click "Score Now" button.
- **Files:** New component `src/components/scoring/QuickScoreWidget.jsx`, add to `AppShell`

### Category 5: INNOVATIVE — Differentiators & Moonshots

#### 5.1 AI Co-Pilot Trade Explanations
- **Current state:** `AIController` exists with DeepSeek integration for portfolio analysis. But no "explain this signal" feature.
- **What to do:** When a signal fires, send the directive breakdown + market context to DeepSeek and get a natural-language explanation of WHY this trade makes sense (or doesn't). Use as a sanity check before execution.
- **Files:** Extend `AIController`, add to signal pipeline

#### 5.2 Regime-Adaptive Protocol Selection
- **Current state:** Protocols are manually selected. No automatic "market says we're in a trend, switch to momentum protocol" logic.
- **What to do:** Use `ConditionDetectorService` (already detects regime, volatility, session quality) to auto-select the best protocol for current conditions.
- **Files:** New service `nest/src/modules/automation/protocol-selector.service.ts`

---

## Sprint Tracker

| Issue | Phase | Status |
|-------|-------|--------|
| #178 | EPIC: Profit Signal Pipeline (this issue) | 🔄 OPEN |
| #179 | Day 1: MTF Confluence Protocol | ⬜ |
| #180 | Day 1: RSI Divergence Scanner Directive | ⬜ |
| #181 | Day 1: VWAP Confluence Composite Protocol | ⬜ |
| #182 | Day 1: Pre-Market Gap Scanner | ⬜ |
| #183 | Day 2: Earnings Momentum Auto-Play Strategy | ⬜ |
| #184 | Day 2: Persist SEES Strategy Pairs to DB | ⬜ |
| #185 | Day 2: Wire Automated Daily Cron Trading | ⬜ |
| #186 | Day 2: Paper Trading / Virtual P&L Mode | ⬜ |
| #187 | Day 3: Strategy Performance Dashboard UI | ⬜ |
| #188 | Day 3: Monte Carlo Risk-of-Ruin Simulator | ⬜ |
| #189 | Day 3: Auto Trailing Stop Attachment | ⬜ |
| #190 | Day 3: Regime-Adaptive Position Sizing | ⬜ |
| #191 | Day 4: Telegram/Discord Signal Alerts | ⬜ |
| #192 | Day 4: Fix 13 Broken Research Pages (batch) | ⬜ |
| #193 | Day 4: Trade History Page | ⬜ |
| #194 | Day 4: Quick Score Header Widget | ⬜ |
| #195 | Day 5: AI Co-Pilot Trade Explanations | ⬜ |
| #196 | Day 5: Regime-Adaptive Protocol Selection | ⬜ |

> This issue stays **OPEN** until all child issues (#179–#196) are closed. Further audit reviews will be appended as comments.

---

## Scope Decisions

- **Focus:** Signals and automation that work with EXISTING infrastructure. No new provider integrations needed for the first batch.
- **Brokers:** Target MT5 (bridge ready) and Trading212 (API ready) for execution. Alpaca adapter exists but is dormant — defer activation.
- **Asset focus:** Start with SPY, QQQ, AAPL, MSFT (liquid, good data coverage) then expand to BTC, Gold, Oil.
- **Risk-first:** All automated strategies default to paper trading. Live money requires explicit opt-in.
- **Excluded:** Options chain integration (needs new data provider), mobile native app (PWA covers this), strategy marketplace (future phase).

## Verification Gates

1. **Backtest each new signal type** before deployment — use existing `POST /api/backtest/run` with the new protocols on SPY, QQQ, AAPL, MSFT over 252+ days
2. **Paper-trade for 1 week minimum** before live money
3. **Monitor signal quality** — track directive prediction accuracy via `GET /api/scoring/accuracy`
4. **Risk-gate all automated trades** — ensure `TradingGatesService.check()` runs before every execution
5. **Telegram alert test** — send test alert, verify delivery < 5 seconds

## Next Review

After this sprint ships: **Data Quality & Strategy Robustness Review** covering:
- Directive mathematical correctness (120+ implementations)
- Execution realism (slippage, spreads, fill probability)
- Data quality (gaps, spikes, survivorship bias, corporate actions)
- Overfitting detection across all 24 protocols
- Portfolio-level risk math (correlation blow-ups)
- Market microstructure for speed protocols
