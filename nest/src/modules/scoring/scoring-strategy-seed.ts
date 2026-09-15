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
 *
 * ⚠️ RESCALED 2026-09-15 (#839) — `tradeThreshold` was 55/50/60/55.
 *
 * Those were pre-rescale bars. ADR-011's denominator change divided every strength percentage
 * by ~6.3, so measured `compositePct` now peaks at ~33 — a bar of 50-60 can NEVER be cleared.
 * Any scoring strategy seeded from here would silently never fire a trade.
 *
 * Values are the old ones divided by ~6.3, rounded, ORDERING PRESERVED (gold 9 > forex 8,
 * btc 10 highest, oil 9) — a units migration, not a tuning decision. Same basis as
 * `common/utils/style-thresholds.ts`, which owns the authoritative table.
 *
 * ⚠️ NOT VERIFIED, AND FLAGGED DELIBERATELY: the `gateConfig.*.threshold` values below
 * (40 / 35 / 45) are ALSO on the old scale and were NOT changed here. A group-gate threshold
 * is compared against a group percentage, not the protocol composite, so whether the same
 * ~6.3 divisor applies is a QUESTION, not an assumption. Rescaling them without checking would
 * be the same mistake in the other direction. Tracked separately — do not "tidy" them.
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
    tradeThreshold: 9,
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
    tradeThreshold: 8,
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
    tradeThreshold: 10,
    mode: 'score',
  },
  // ── Oil ──
  {
    name: 'Oil Speed (default)',
    protocolId: 'oil-speed-v1',
    watchlistName: 'default',
    tradeThreshold: 9,
    mode: 'score',
    gateConfig: {
      risk: { enabled: true, threshold: 45 },
    },
  },
];
