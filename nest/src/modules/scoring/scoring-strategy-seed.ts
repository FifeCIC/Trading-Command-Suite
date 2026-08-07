/**
 * Scoring Strategy Seed Data
 * ===========================
 * Default scoring strategies for key protocols with a linked watchlist.
 * Creates the Protocol → ScoringStrategy link that the Strategy Builder
 * and Ladder depend on.
 *
 * Each entry pairs a protocol with the "default" watchlist and configures
 * which directive groups act as gates.
 *
 * @created 2026-08-06 — Scoring Strategies foundation (#560 follow-up)
 */

export interface SeedScoringStrategy {
  name: string;
  protocolId: string;
  watchlistName: string;
  tradeThreshold: number;
  mode: string;
  gateConfig?: Record<string, { enabled: boolean; threshold: number }>;
}

export const DEFAULT_SCORING_STRATEGIES: SeedScoringStrategy[] = [
  // ── Gold ──
  {
    name: 'Gold Speed (default)',
    protocolId: 'xau-speed-v1',
    watchlistName: 'default',
    tradeThreshold: 55,
    mode: 'score',
    gateConfig: {
      risk: { enabled: true, threshold: 40 },
    },
  },
  // ── Forex Majors ──
  {
    name: 'Forex Session (default)',
    protocolId: 'forex-session-v1',
    watchlistName: 'default',
    tradeThreshold: 50,
    mode: 'score',
    gateConfig: {
      risk: { enabled: true, threshold: 35 },
    },
  },
  // ── BTC ──
  {
    name: 'BTC Speed (default)',
    protocolId: 'btc-speed-v1',
    watchlistName: 'default',
    tradeThreshold: 60,
    mode: 'score',
  },
  // ── Oil ──
  {
    name: 'Oil Speed (default)',
    protocolId: 'oil-speed-v1',
    watchlistName: 'default',
    tradeThreshold: 55,
    mode: 'score',
    gateConfig: {
      risk: { enabled: true, threshold: 45 },
    },
  },
];
