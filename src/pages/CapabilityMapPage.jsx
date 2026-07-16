import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { NAV_TREE } from '../core/nav-tree';
import { PAGE_DATA_STATUS } from '../core/page-data-status';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './capability-map.css';

// ── Known feature annotations ──────────────────────────
const KNOWN_FEATURES = {
  // Directives
  'dxy-regime': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'gold-macro-correlation': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'cad-usd-oil-correlation': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'earnings-momentum': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'vix-regime': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'correlation-drag': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'rollover-risk': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  // Backend Tech
  'SEES Scoring Engine': { dataPersistence: 'stored', uiSurfaces: 4, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Speed Scan Service': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Gated Scoring Pipeline': { dataPersistence: 'stored', uiSurfaces: 3, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'MicroTrendDetector (ADX+Wilder)': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'RiskGatingEngine (Tiered)': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'ExitSignalService (Multi-factor)': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'RateLimitGovernor (9 providers)': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'both', devCompletion: 'complete' },
  'TimezoneService (IANA-aware)': { dataPersistence: 'config', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Protocol System (32 protocols)': { dataPersistence: 'config', uiSurfaces: 3, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Directive Registry (99 directives)': { dataPersistence: 'config', uiSurfaces: 2, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Multi-Protocol SEES Arena': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Trading Strategy Stacks (real)': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Sector Rotation + Protocol Strat': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Portfolio Service (T212)': { dataPersistence: 'stored', uiSurfaces: 2, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Trading212 Import Service': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Scoring Scheduler': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Score History Service': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Scoring Runs (search+paginate)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Outcome Tracker (Q304)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Seasonal Affinity Service': { dataPersistence: 'config', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Correlation Service': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Research Overview (priority-wtd)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'StockInvestigation (Finnhub)': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Planner (allocations+styles)': { dataPersistence: 'stored', uiSurfaces: 3, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Backtest Service': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'partial' },
  'Alert Service': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'TradingGatesService (3-Gate Pipeline)': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'trading', devCompletion: 'complete' },
  'Risk Service (Drawdown Alerts)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'trading', devCompletion: 'complete' },
  'Automation (9 endpoints)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  // Platform
  'MT5 Bridge': { dataPersistence: 'stored', uiSurfaces: 2, pipelineIntegration: 'trading', devCompletion: 'complete' },
  'Trading212 API': { dataPersistence: 'stored', uiSurfaces: 2, pipelineIntegration: 'trading', devCompletion: 'complete' },
  'Finnhub': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'DeepSeek AI': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'none', devCompletion: 'complete' },
  // Frontend
  'Portfolio Lab': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'planned', devCompletion: 'complete' },
  'DXY Sensitivity Protocol': { dataPersistence: 'config', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Speed Scanner': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Protocol Comparison Heatmap': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Signal Ladder + Directive Drilldown': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Execution Queue (Timeline + Retry)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'User Preferences (Display+Risk)': { dataPersistence: 'localStorage', uiSurfaces: 1, pipelineIntegration: 'none', devCompletion: 'complete' },
  'Exit Signals Page': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Market Correlations (Live 90d)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  // Sprint 2026-07-03 — Divergence Suite
  'rsi-divergence': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'macd-divergence': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'obv-divergence': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  // Sprint 2026-07-03 — VWAP Confluence
  'vwap-confluence-simple': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'vwap-confluence-bands': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  // Sprint 2026-07-03 — MTF Confluence
  'mtf-confluence-conservative': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'mtf-confluence-weighted': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  // Sprint 2026-07-03 — Gap Scanner
  'gap-scanner': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  // Sprint 2026-07-03 — Paper Trading + Monte Carlo
  'PaperTradingService': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'trading', devCompletion: 'complete' },
  'MonteCarloService': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'trading', devCompletion: 'complete' },
  // Sprint 2026-07-03 — Automation Bridge
  'ScoringStrategy (DB-persisted)': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Trading Scheduler (Live Scoring)': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'both', devCompletion: 'complete' },
  // Frontend additions
  'Market Status Ticker': { dataPersistence: 'cached', uiSurfaces: 1, pipelineIntegration: 'none', devCompletion: 'complete' },
  'Market Context Page': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Provider Health Page': { dataPersistence: 'cached', uiSurfaces: 1, pipelineIntegration: 'none', devCompletion: 'complete' },
  // 2026-07-03/04 — Degradation & Market Awareness
  'Provider Degradation Service': { dataPersistence: 'stored', uiSurfaces: 2, pipelineIntegration: 'both', devCompletion: 'complete' },
  'MarketContextService (7-Day)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Scoring Degradation Monitor': { dataPersistence: 'ephemeral', uiSurfaces: 2, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'PerformanceService (Prisma, equity curve)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Insider Activity (DB-backed, on-demand)': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Dilution Impact (DB-backed, on-demand)': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Seasonality Heatmap': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Recently Analysed Symbols': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Create Strategy Page': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  // 2026-07-04/07 — Data Pipeline & Providers
  'Data Import Orchestrator (unified freshness)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Freshness Service + Price Refresh': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Portfolio Price Service (live pricing)': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Trading212 Import Pipeline': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Crypto Provider Router (Binance default)': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Binance Adapter': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Polygon.io Adapter': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Protocol Consensus Service (multi-protocol)': { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Scoring Log Service (unified logging)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Process Manager Service': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'both', devCompletion: 'complete' },
  // UI Components & Pages
  'Gap Scanner Page': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'QA Testing Page + Checklist': { dataPersistence: 'localStorage', uiSurfaces: 1, pipelineIntegration: 'none', devCompletion: 'complete' },
  'Preference Lab': { dataPersistence: 'localStorage', uiSurfaces: 1, pipelineIntegration: 'none', devCompletion: 'complete' },
  'Symbol Detail Page': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Feature Lab Demos (TP/Session/Trailing Stop)': { dataPersistence: 'ephemeral', uiSurfaces: 1, pipelineIntegration: 'none', devCompletion: 'complete' },
  'Detachable Widget System': { dataPersistence: 'localStorage', uiSurfaces: 1, pipelineIntegration: 'none', devCompletion: 'complete' },
  'Sticky Header Component': { dataPersistence: 'config', uiSurfaces: 1, pipelineIntegration: 'none', devCompletion: 'complete' },
  // 2026-07-07/08 — Alerts, Backtest, Duplicate Guard
  'AlertTriggerService (9 triggers)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'DuplicateGuardService': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'trading', devCompletion: 'complete' },
  'Backtest News Exclusion (#105)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Backtest Equity Curve (#103)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Backtest Run Compare (#104)': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  // 2026-07-08/09 — M.E.T.A. System
  'M.E.T.A. Ratings Engine': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'both', devCompletion: 'complete' },
  'M.E.T.A. Signature Verification': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'both', devCompletion: 'complete' },
  // 2026-07-14 — Protocol Direction Architecture
  'Protocol Direction Mode (LONG/SHORT)': { dataPersistence: 'config', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Directive Direction Bias Filtering': { dataPersistence: 'config', uiSurfaces: 0, pipelineIntegration: 'scoring', devCompletion: 'complete' },
  'Dual-Protocol Scoring (LONG vs SHORT)': { dataPersistence: 'stored', uiSurfaces: 0, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Pipeline Graph (NodeMapper)': { dataPersistence: 'stored', uiSurfaces: 1, pipelineIntegration: 'both', devCompletion: 'complete' },
  'Design Token System (#252)': { dataPersistence: 'config', uiSurfaces: 0, pipelineIntegration: 'none', devCompletion: 'complete' },
  'EmptyState Component (#255)': { dataPersistence: 'localStorage', uiSurfaces: 0, pipelineIntegration: 'none', devCompletion: 'complete' },
};

// ── Build unified capability rows ──

function buildCapabilityRows(directives, providers) {
  const rows = [];

  const def = { dataPersistence: 'ephemeral', uiSurfaces: 0, pipelineIntegration: 'none', devCompletion: 'partial' };

  // ── Pages (from nav tree + page data status) ──
  Object.entries(NAV_TREE).forEach(([areaKey, area]) => {
    area.views.forEach((view) => {
      const meta = PAGE_DATA_STATUS[view.id];
      rows.push({
        ...def,
        category: 'Page',
        area: area.label,
        name: view.label,
        type: 'UI',
        status: 'ALPHA',
        notes: meta?.source || meta?.note || '',
        uiSurfaces: 1,
      });
    });
  });

  // ── Directives (from API or fallback) ──
  if (directives && Array.isArray(directives)) {
    directives.forEach((d) => {
      const known = KNOWN_FEATURES[d.id] || KNOWN_FEATURES[d.name] || {};
      rows.push({
        ...def,
        category: 'Directive',
        area: d.category || 'Uncategorized',
        name: d.name,
        type: 'Backend',
        status: 'ALPHA',
        notes: d.description?.substring(0, 80) || '',
        ...known,
      });
    });
  }

  // ── Providers ──
  (providers || []).forEach((p) => {
    const name = p.displayName || p.name || p.provider || 'Unknown';
    const known = KNOWN_FEATURES[name] || KNOWN_FEATURES[p.provider] || {};
    rows.push({
      ...def,
      category: 'Provider',
      area: 'Data',
      name,
      type: 'Integration',
      status: 'ALPHA',
      notes: `Quotes: ${p.quotes !== false ? '✓' : '✗'} · Candles: ${p.candles !== false ? '✓' : '✗'} · News: ${p.news ? '✓' : '✗'} · Fund: ${p.fundamentals ? '✓' : '✗'} · Portfolio: ${p.portfolio ? '✓' : '✗'}`,
      ...known,
    });
  });

  // ── API Modules ──
  [
    { name: 'Symbols', count: 5 },
    { name: 'Market Data', count: 3 },
    { name: 'Providers', count: 4 },
    { name: 'Import Jobs', count: 3 },
    { name: 'Scoring', count: 7 },
    { name: 'News', count: 4 },
    { name: 'Directives (~99)', count: 6 },
    { name: 'Strategies', count: 5 },
    { name: 'Earnings', count: 4 },
    { name: 'Portfolio', count: 4 },
    { name: 'Calibration', count: 3 },
    { name: 'Indicators', count: 6 },
    { name: 'Macro', count: 2 },
    { name: 'Alerts', count: 6 },
    { name: 'Training', count: 3 },
    { name: 'Backtest', count: 1 },
    { name: 'Architecture', count: 1 },
    { name: 'Paper Trading', count: 10 },
    { name: 'Automation', count: 9 },
    { name: 'System', count: 4 },
    { name: 'Watchlists', count: 4 },
    { name: 'Processes', count: 3 },
    { name: 'Speed Trading', count: 3 },
    { name: 'Signals (Envelope + Ladder)', count: 3 },
    { name: 'Risk (Overview + Gates)', count: 4 },
    { name: 'Research Overview', count: 1 },
    { name: 'Snapshots', count: 2 },
    { name: 'Backtest Data', count: 1 },
    { name: 'Performance (summary + equity)', count: 3 },
    { name: 'Market Context (7-Day)', count: 1 },
    { name: 'Data Import (orchestrator)', count: 4 },
    { name: 'Crypto Providers (Binance)', count: 2 },
    { name: 'Scoring Logs (unified)', count: 2 },
    { name: 'Alerts (triggers + service)', count: 4 },
    { name: 'Trading (strategies + duplicate)', count: 3 },
    { name: 'M.E.T.A. (ratings + signature)', count: 3 },
  ].forEach((mod) => {
    const known = KNOWN_FEATURES[mod.name] || {};
    rows.push({
      ...def,
      category: 'API Module',
      area: 'Backend',
      name: mod.name,
      type: 'Backend',
      status: 'ALPHA',
      notes: `${mod.count} endpoints`,
      ...known,
    });
  });

  // ── Frontend Tools / Features ──
  [
    'Theme System (10+ packs)',
    'Motion / Animation Library',
    'Canvas 2D Chart Engine',
    'Lightweight Charts Engine',
    'PWA / Offline Support',
    'Bookmark System',
    'QA Check Tracking',
    'Dev Overlay + Activity Log',
    'Runtime Diagnostics Report',
    'Feature Flag System',
    'Error Boundaries',
    'Breadcrumbs',
    'Collapsible Sidebar',
    'Global Search',
    'Market Status Ticker (Bloomberg-style Scrolling Tape)',
    'Ticker Bar (Background Events)',
    'Network Status Bar',
    'PWA Install Prompt',
    'Analytics / Performance Monitoring',
    'Strategy Performance Dashboard (Equity Curve + Monthly Breakdown)',
    'Container Queries',
    'Popover API',
    'Scroll-Driven Animations',
    'Glass Panels',
    'Signal Ladder + Directive Drilldown',
    'Conflict Resolver (Bull/Bear Detection)',
    'Risk Gauges + Circuit Breaker UI',
    'Research Dashboard (8-Panel Aggregate)',
    'Protocol Selector (Scoring)',
    'Execution Queue (Timeline + Retry)',
    'Market Context Page (Session-aware)',
    'Provider Health Dashboard',
    'MTF Confluence (Conservative + Weighted)',
    'Divergence Suite (RSI + MACD + OBV)',
    'VWAP Confluence (Simple + Bands)',
    'Seasonality Heatmap (Monthly Win Rates)',
    'Recently Analysed Symbols (History + Quick Score)',
    'Create Strategy (Trading + Protocol Link)',
    'Paper Trading Dashboard',
    'Gap Scanner (Directive)',
    'User Preferences System (12 Settings)',
    'Strategy Showdown + Live Positions',
    'QA Testing Page + Checklist',
    'Preference Lab + User Settings',
    'Symbol Detail Page (Research Quick-View)',
    'Feature Lab (TP/Session/Trailing Stop Demos)',
    'Detachable Widget System',
    'Sticky Header + Notice Components',
    'Status Badge Component',
    'Multi-Screen Cockpit (Phase 1)',
  ].forEach((name) => {
    const known = KNOWN_FEATURES[name] || {};
    rows.push({
      ...def,
      category: 'Frontend Feature',
      area: 'UI',
      name,
      type: 'Frontend',
      status: 'ALPHA',
      notes: '',
      uiSurfaces: 1,
      ...known,
    });
  });

  // ── Platform Support ──
  [
    'Trading212 API',
    'MT5 Bridge',
    'Alpaca Markets',
    'Finnhub',
    'Yahoo Finance',
    'Polygon.io',
    'Twelve Data',
    'FMP',
    'FRED (Economic Data)',
    'ECB (European Central Bank)',
    'MySQL / Prisma ORM',
    'NestJS Backend',
    'React 18 + Vite',
    'Windows Desktop',
    'Web (Cross-browser)',
    'PWA (Mobile)',
  ].forEach((name) => {
    const known = KNOWN_FEATURES[name] || {};
    rows.push({
      ...def,
      category: 'Platform Support',
      area: 'Infrastructure',
      name,
      type: 'Platform',
      status: 'ALPHA',
      notes: '',
      ...known,
    });
  });

  // ── Backend Tech ──
  [
    'SEES Scoring Engine',
    'Scoring Scheduler',
    'Score History Service',
    'Predictive Scoring (ML Horizon)',
    'Outcome Tracker (Q304)',
    'Multi-Timeframe Scorer',
    'Speed Scan Service',
    'Strategy Competition Service',
    'Strategy Comparison (Showdown)',
    'Gated Scoring Pipeline',
    'Directive Registry (99 directives)',
    'Protocol System',
    'Portfolio Service (T212)',
    'Trading212 Import Service',
    'Correlation Service',
    'Risk Service (Drawdown Alerts)',
    'TradingGatesService (3-Gate Pipeline)',
    'SignalEnvelopeService (Scoring Bridge)',
    'RiskOverviewService (Circuit Breaker)',
    'ResearchImportService (5 import pipelines)',
    'On-Demand Symbol Import (Self-Healing Directives)',
    'Trading Scheduler (Live Scoring — wired)',
    'PaperTradingService (Virtual Ledger)',
    'MonteCarloService (Risk-of-Ruin Sim)',
    'ScoringStrategy Persistence (DB)',
    'Backtest Service',
    'Alert Service',
    'Notification Service (Email/Win/Telegram/Discord)',
    'API Activity Middleware',
    'Process Manager',
  ].forEach((name) => {
    const known = KNOWN_FEATURES[name] || {};
    rows.push({
      ...def,
      category: 'Backend Tech',
      area: 'Backend',
      name,
      type: 'Backend',
      status: 'ALPHA',
      notes: '',
      ...known,
    });
  });

  return rows;
}

// ── Badge Components ──
function StatusBadge({ status }) {
  const color = '#8b5cf6';
  const bg = 'rgba(139,92,246,0.12)';
  return <span className="cm-badge" style={{ color, background: bg }}>{status}</span>;
}

function DataBadge({ value }) {
  const map = {
    stored: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '💾' },
    config: { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', icon: '⚙' },
    cached: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '🔄' },
    ephemeral: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '💨' },
  };
  const m = map[value] || map.ephemeral;
  return <span className="cm-badge" style={{ color: m.color, background: m.bg }} title={value}>{m.icon} {value}</span>;
}

function PipelineBadge({ value }) {
  const map = {
    both: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', label: 'score + trade' },
    scoring: { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', label: 'scoring' },
    trading: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'trading' },
    none: { color: '#a1a1aa', bg: 'rgba(161,161,170,0.12)', label: 'none' },
    planned: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', label: 'planned' },
  };
  const m = map[value] || map.none;
  return <span className="cm-badge" style={{ color: m.color, background: m.bg }} title={value}>{m.label}</span>;
}

function DoneBadge({ value }) {
  const map = {
    complete: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: '✓' },
    partial: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '◐' },
    stub: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '✗' },
    planned: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', icon: '→' },
  };
  const m = map[value] || map.partial;
  return <span className="cm-badge" style={{ color: m.color, background: m.bg }} title={value}>{m.icon} {value}</span>;
}

// ── Main Page ──
export default function CapabilityMapPage() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  // ── Live queries ──
  const directivesQuery = useQuery({
    queryKey: ['capability-map', 'directives'],
    queryFn: () => apiGet('/api/directives'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const providerHealthQuery = useQuery({
    queryKey: ['capability-map', 'provider-health'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // ── DB-backed capabilities (primary source when available) ──
  const capabilitiesQuery = useQuery({
    queryKey: ['capability-map', 'db-capabilities'],
    queryFn: () => apiGet('/api/capabilities').catch(() => []),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  const dbCapabilities = Array.isArray(capabilitiesQuery.data) ? capabilitiesQuery.data : [];

  const directives = directivesQuery.data;
  const provData = providerHealthQuery.data;
  const providers = Array.isArray(provData?.providers) ? provData.providers : Array.isArray(provData) ? provData : [];

  const allRows = useMemo(() => {
    const localRows = buildCapabilityRows(directives, providers);
    
    // If DB capabilities are available, merge them with locally-built rows
    if (dbCapabilities.length > 0) {
      const dbMap = new Map(dbCapabilities.map(c => [c.name, c]));
      const localNames = new Set(localRows.map(r => r.name));
      
      // Convert DB capabilities to row format
      const dbRows = dbCapabilities.map(c => ({
        name: c.name,
        category: c.category,
        area: c.area,
        type: c.type,
        status: c.status,
        notes: c.notes || '',
        dataPersistence: c.dataPersistence || 'ephemeral',
        uiSurfaces: c.uiSurfaces || 0,
        pipelineIntegration: c.pipelineIntegration || 'none',
        devCompletion: c.devCompletion || 'partial',
      }));
      
      // Add locally-built rows that don't exist in DB
      for (const row of localRows) {
        if (!dbMap.has(row.name)) {
          dbRows.push(row);
        }
      }
      
      return dbRows;
    }
    
    return localRows;
  }, [directives, providers, dbCapabilities]);

  const categories = [...new Set(allRows.map((r) => r.category))].sort();

  const filtered = useMemo(() => {
    let rows = allRows;
    if (filter !== 'all') rows = rows.filter((r) => r.category === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q) || r.area.toLowerCase().includes(q));
    }
    return rows;
  }, [allRows, filter, search]);

  const totals = allRows.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {});
  const completeLoop = allRows.filter((r) => r.dataPersistence === 'stored' && r.uiSurfaces > 0 && (r.pipelineIntegration === 'scoring' || r.pipelineIntegration === 'trading' || r.pipelineIntegration === 'both') && r.devCompletion === 'complete').length;
  const completeDev = allRows.filter((r) => r.devCompletion === 'complete').length;

  if (allRows.length === 0) return <div className="cm-page"><LoadingSkeleton variant="table" rows={20} cols={5} /></div>;

  return (
    <div className="cm-page">
      <motion.header className="cm-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>🗺️ Capability Map</h1>
        <p className="cm-subtitle">
          Unified inventory of {allRows.length} capabilities — {dbCapabilities.length > 0 ? `${dbCapabilities.length} from DB` : 'built from live system scan'}. New capabilities added via POST /api/capabilities.
        </p>
      </motion.header>

      {/* ── Summary ── */}
      <div className="cm-summary">
        <div className="cm-summary-item"><span className="cm-summary-value">{allRows.length}</span><span className="cm-summary-label">total capabilities</span></div>
        <div className="cm-summary-item" title="Features where data is stored (not ephemeral), has at least 1 UI surface, is integrated into scoring/trading, and is marked complete">
          <span className="cm-summary-value" style={{color: completeLoop > completeDev * 0.3 ? '#22c55e' : '#f59e0b'}}>{completeLoop}/{completeDev}</span>
          <span className="cm-summary-label">complete loops</span>
        </div>
        {categories.map((cat) => (
          <div key={cat} className="cm-summary-item">
            <span className="cm-summary-value">{totals[cat] || 0}</span>
            <span className="cm-summary-label">{cat}</span>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="cm-controls">
        <input
          type="search"
          placeholder="Search capabilities…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="cm-search"
        />
        <div className="cm-filter-chips">
          <button className={`cm-filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
          {categories.map((cat) => (
            <button key={cat} className={`cm-filter-chip ${filter === cat ? 'active' : ''}`} onClick={() => setFilter(cat)}>{cat} ({totals[cat] || 0})</button>
          ))}
        </div>
      </div>

      {/* ── Unified Table ── */}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Area</th>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th title="Is data stored in the database (stored), held in memory (cached), or does it evaporate after use (ephemeral)? Configuration data stored as part of the codebase counts as 'config'.">💾 Data</th>
              <th title="How many UI components, pages, or panels display data from this capability? 0 = API-only, no visual surface.">🖥 UI</th>
              <th title="Is this capability integrated into the scoring pipeline, trading execution, both, or neither? 'planned' = design exists but not wired yet.">🔗 Pipeline</th>
              <th title="Is the implementation complete per developer intentions? 'stub' = placeholder, 'partial' = in progress, 'complete' = done, 'planned' = designed but not built.">✅ Done</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <motion.tr key={`${row.category}-${row.name}-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.002 }}>
                <td><span className="cm-cat-chip">{row.category}</span></td>
                <td style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{row.area}</td>
                <td><strong>{row.name}</strong></td>
                <td style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{row.type}</td>
                <td><StatusBadge status={row.status} /></td>
                <td><DataBadge value={row.dataPersistence} /></td>
                <td style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: row.uiSurfaces > 0 ? '#22c55e' : 'var(--ink-soft)' }}>{row.uiSurfaces}</td>
                <td><PipelineBadge value={row.pipelineIntegration} /></td>
                <td><DoneBadge value={row.devCompletion} /></td>
                <td style={{ fontSize: 11, color: 'var(--ink-soft)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.notes || '—'}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cm-footer">
        {filtered.length} of {allRows.length} capabilities shown · {completeLoop} have a complete data loop (stored + UI + pipeline + complete) · Click column headers for details
      </div>
    </div>
  );
}
