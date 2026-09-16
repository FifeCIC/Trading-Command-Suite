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
 * ⚠️ The values are NOT a mechanical ÷6.3 of the old numbers. A first pass did exactly that
 * (55/50/60/55 -> 9/8/10/9) and was WRONG: it preserved the old ORDERING but ignored each
 * protocol's declared `tradingStyle`, which is the semantic the app actually uses. Under the
 * owner's own resolution the order is different — `btc-speed-v1` is `Monitor / Position`
 * (position = 7, the LOWEST) while `xau-speed-v1` and `oil-speed-v1` are `Tick Scalp`
 * (scalp = 12, the HIGHEST). The ÷6.3 pass had BTC highest. That is not a rescale, it is a
 * silent re-ranking.
 *
 * Each value below is therefore the output of `resolveStyleThreshold(protocol.tradingStyle)`
 * — the SAME function the running app uses, so seed and runtime cannot disagree:
 *
 *     xau-speed-v1     'Tick Scalp'                -> scalp      -> 12
 *     oil-speed-v1     'Tick Scalp'                -> scalp      -> 12
 *     forex-session-v1 'Session / Mean Reversion'   -> day-trade  -> 10
 *     btc-speed-v1     'Monitor / Position'         -> position   ->  7
 *
 * Re-derive with: `node nest/scripts/align-scoring-strategy-thresholds.cjs` (dry run).
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
    tradeThreshold: 12, // 'Tick Scalp' -> scalp
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
    tradeThreshold: 10, // 'Session / Mean Reversion' -> day-trade
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
    tradeThreshold: 7, // 'Monitor / Position' -> position (the LOWEST bar, not the highest)
    mode: 'score',
  },
  // ── Oil ──
  {
    name: 'Oil Speed (default)',
    protocolId: 'oil-speed-v1',
    watchlistName: 'default',
    tradeThreshold: 12, // 'Tick Scalp' -> scalp
    mode: 'score',
    gateConfig: {
      risk: { enabled: true, threshold: 45 },
    },
  },
];
