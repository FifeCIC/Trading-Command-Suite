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
  /** Session this strategy targets */
  session: 'tokyo' | 'london' | 'us' | 'always';
  /** Trading style from the protocol */
  style: string;
}

export const DEFAULT_TRADING_STRATEGIES: SeedTradingStrategy[] = [
  // ── XAUUSD Variants (derived from xau-speed-v1) ──────────
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
    session: 'always',
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
    session: 'always',
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
    session: 'always',
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
    session: 'always',
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
    session: 'tokyo',
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
    session: 'london',
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
    session: 'us',
    style: 'Position',
  },
];
