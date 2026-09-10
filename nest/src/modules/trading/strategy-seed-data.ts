/**
 * Trading Strategy Seed Data
 * ===========================
 * Canonical trading strategies for session-based coverage.
 * Used by TradingStrategyService.seedDefaults() to populate
 * initial strategies on fresh installs or resets.
 *
 * Each entry pairs a protocol with a symbol and broker.
 * Scoring strategies are auto-created if they don't exist.
 *
 * Protocol → ScoringStrategy → TradingStrategy chain.
 *
 * @created 2026-07-31 — 24/7 session coverage
 */

import { SessionTag } from './session-window';

export interface SeedTradingStrategy {
  name: string;
  symbol: string;
  protocolId: string;
  brokerId: string;
  mode: 'semi-auto' | 'auto' | 'score';
  timeframe: string;
  baseSize: number;
  slPct: number;
  tpPct: number;
  minComposite: number;
  /**
   * SESSION GATE (2026-09-10) — canonical session tags this bot may act in.
   * Persisted to trading_strategy.sessionWindow and enforced by Gate 4.5 in
   * automation-loop.service.ts. `null` = ungated (may act any time).
   *
   * Replaces the old `session: 'tokyo' | 'london' | 'us' | 'always'` field,
   * which was declared here but consumed by no runtime code — a label with no
   * rule behind it. 'tokyo' → 'asian', 'always' → null.
   */
  sessionWindow: SessionTag[] | null;
  /** Trading style from the protocol */
  style: string;
}

export const DEFAULT_TRADING_STRATEGIES: SeedTradingStrategy[] = [
  // ── Index tick-scalp bots — London/EU coverage (#730 / #747) ──
  {
    name: 'FTSE Index Tick Scalp',
    symbol: 'UK100',
    protocolId: 'ftse-speed-v1',
    brokerId: 'mt5',
    mode: 'semi-auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 0.4,
    tpPct: 0.6,
    minComposite: 65,
    sessionWindow: ['london'],
    style: 'Tick Scalp',
  },
  {
    name: 'DAX Index Tick Scalp',
    symbol: 'GER40',
    protocolId: 'dax-speed-v1',
    brokerId: 'mt5',
    mode: 'semi-auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 0.4,
    tpPct: 0.6,
    minComposite: 65,
    sessionWindow: ['london'],
    style: 'Tick Scalp',
  },
  {
    name: 'CAC Index Tick Scalp',
    symbol: 'FRA40',
    protocolId: 'cac-speed-v1',
    brokerId: 'mt5',
    mode: 'semi-auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 0.4,
    tpPct: 0.6,
    minComposite: 65,
    sessionWindow: ['london'],
    style: 'Tick Scalp',
  },

  // ── XAUUSD Variants (derived from xau-speed-v1) ──────────
  {
    name: 'Silver Speed Scalp',
    symbol: 'XAGUSD',
    protocolId: 'xau-speed-v1',
    brokerId: 'mt5',
    mode: 'semi-auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 0.6,
    tpPct: 1.0,
    minComposite: 60,
    sessionWindow: ['london'],
    style: 'Tick Scalp',
  },
  {
    name: 'Gold Scalp M5',
    symbol: 'XAUUSD',
    protocolId: 'xau-speed-m5',
    brokerId: 'mt5',
    mode: 'semi-auto',
    timeframe: '5m',
    baseSize: 0.01,
    slPct: 0.3,
    tpPct: 0.5,
    minComposite: 55,
    sessionWindow: null,
    style: 'Scalp',
  },
  {
    name: 'Gold Day-Trade M15',
    symbol: 'XAUUSD',
    protocolId: 'xau-speed-m15',
    brokerId: 'mt5',
    mode: 'semi-auto',
    timeframe: '15m',
    baseSize: 0.02,
    slPct: 0.5,
    tpPct: 1.0,
    minComposite: 60,
    sessionWindow: null,
    style: 'Day Trade',
  },
  {
    name: 'Gold Swing 1H',
    symbol: 'XAUUSD',
    protocolId: 'xau-speed-1h',
    brokerId: 'mt5',
    mode: 'semi-auto',
    timeframe: '1h',
    baseSize: 0.05,
    slPct: 1.5,
    tpPct: 3.0,
    minComposite: 55,
    sessionWindow: null,
    style: 'Swing',
  },
  {
    name: 'Gold Position 4H',
    symbol: 'XAUUSD',
    protocolId: 'xau-speed-4h',
    brokerId: 'mt5',
    mode: 'semi-auto',
    timeframe: '4h',
    baseSize: 0.1,
    slPct: 3.0,
    tpPct: 6.0,
    minComposite: 50,
    sessionWindow: null,
    style: 'Position',
  },

  // ── Session Strategies ──────────────────────────────────
  {
    name: 'Tokyo USDJPY Session',
    symbol: 'USDJPY',
    protocolId: 'forex-session-v1',
    brokerId: 'mt5',
    mode: 'semi-auto',
    timeframe: '1h',
    baseSize: 0.05,
    slPct: 1.5,
    tpPct: 3.0,
    minComposite: 60,
    sessionWindow: ['asian'],
    style: 'Swing',
  },
  {
    name: 'London EURUSD Macro',
    symbol: 'EURUSD',
    protocolId: 'eurusd-macro-v1',
    brokerId: 'mt5',
    mode: 'semi-auto',
    timeframe: '15m',
    baseSize: 0.02,
    slPct: 0.5,
    tpPct: 1.0,
    minComposite: 60,
    sessionWindow: ['london'],
    style: 'Day Trade',
  },
  {
    name: 'US SPY Speed',
    symbol: 'SPX500',
    protocolId: 'spy-day-v1',
    brokerId: 'mt5',
    mode: 'semi-auto',
    timeframe: '1h',
    baseSize: 0.1,
    slPct: 3.0,
    tpPct: 6.0,
    minComposite: 55,
    sessionWindow: ['us'],
    style: 'Position',
  },
];
