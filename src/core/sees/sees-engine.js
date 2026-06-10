/**
 * 🧪 SEES SIMULATION ENGINE — LOCAL DEMO ONLY
 * ============================================
 * This is a visual prototype that simulates scoring with synthetic math.
 * It does NOT use real market indicators (RSI, MACD, EMA, ATR, Volume).
 *
 * 🔴 CANONICAL DIRECTIVE REFERENCE: docs/CANONICAL-DIRECTIVE-REFERENCE.md
 *    The production directives are:
 *    rsi-oversold, macd-crossover, ema-structure, atr-dip, volume-confirmation
 *
 * 🔴 DIRECTIVE NAMES now match canonical production IDs (rsi-oversold, macd-crossover,
 *    ema-structure, atr-dip, volume-confirmation) but the math is still SIMULATION ONLY.
 *    The boost/multiplier "moments" system is also SIMULATION ONLY.
 *    These must NOT influence the NestJS backend directive specification.
 *
 * This file is consumed by SeesLiveStackMockPage.jsx (note: "Mock") for
 * visual prototyping. The production scoring pipeline lives in:
 *    nest/src/modules/directives/
 *    nest/src/modules/scoring/
 *
 * Score formula (simulation): (baseScore + boostTotal) * multiplier
 * Score formula (production): Σ(directive.score × directive.weight / 100)  [0-100]
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const SEES_DIRECTIVES = [
  {
    id: 'rsi-oversold',
    label: 'RSI Oversold Reversion (Simulation)',
    indicator: 'Synthetic mean reversion proxy',
    weight: 0.24,
    description: 'SIMULATION: Approximates mean reversion behavior. Production uses RSI(14).',
  },
  {
    id: 'macd-crossover',
    label: 'MACD Bullish Crossover (Simulation)',
    indicator: 'Synthetic momentum shift proxy',
    weight: 0.22,
    description: 'SIMULATION: Approximates momentum shift. Production uses MACD line/signal crossover.',
  },
  {
    id: 'atr-dip',
    label: 'ATR Normalized Dip (Simulation)',
    indicator: 'Synthetic pullback quality proxy',
    weight: 0.18,
    description: 'SIMULATION: Approximates pullback quality. Production uses ATR-normalized dip.',
  },
  {
    id: 'ema-structure',
    label: 'Price Above EMA Structure (Simulation)',
    indicator: 'Synthetic trend alignment proxy',
    weight: 0.20,
    description: 'SIMULATION: Approximates trend alignment. Production uses EMA20/EMA50 structure.',
  },
  {
    id: 'volume-confirmation',
    label: 'Volume Confirmation (Simulation)',
    indicator: 'Synthetic participation filter proxy',
    weight: 0.16,
    description: 'SIMULATION: Approximates participation filter. Production uses volume support.',
  },
]

export const SEES_STRATEGY = {
  id: 'conviction-dip-accumulation-sim',
  name: 'Conviction Dip Accumulation (Simulation)',
  description: 'SIMULATION strategy for visual prototyping. Uses synthetic math — not real market indicators. Canonical thresholds: entry=60, watch=40, defense=25. Simulation thresholds differ for visual effect.',
  entryThreshold: 112,
  watchThreshold: 86,
  defenseThreshold: 58,
  activeDirectives: ['rsi-oversold', 'macd-crossover', 'atr-dip', 'ema-structure', 'volume-confirmation'],
  notes: [
    '🔴 SIMULATION ONLY — directive names are canonical but math is still synthetic.',
    'Boost and multiplier values are part of the simulation, not the production scoring model.',
    'Final score is intentionally not capped — this is a simulation behavior, not production.',
    'Scores are deterministic to keep debugging and review repeatable.',
  ],
}

function deriveLiveState(symbol, tick, index) {
  const oscillation = Math.sin((tick + index) * 0.65)
  const drift = Math.cos((tick * 0.45) + index * 0.35)
  const price = clamp(symbol.basePrice + oscillation * 2.1 + drift * 0.8, 1, Infinity)
  const changePercent = (Math.sin((tick + index) * 0.58) * 1.15) + (symbol.baseBias ?? 0)
  const baseQuality = clamp(symbol.baseQuality + Math.cos((tick + index) * 0.33) * 3.2, 0, 100)
  const stability = clamp(100 - Math.abs(changePercent) * 18 - Math.abs(oscillation) * 6, 0, 100)

  return {
    ...symbol,
    price: Number(price.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    baseQuality: Number(baseQuality.toFixed(1)),
    stability: Number(stability.toFixed(1)),
  }
}

function buildDirectiveBreakdown(liveRow, marketAverageChange) {
  // SIMULATION math using synthetic data, not real RSI/MACD/EMA/ATR/Volume.
  // Names match canonical directives for visual parity.
  const rsiOversold = clamp(52 + liveRow.changePercent * 16 + (liveRow.price - liveRow.basePrice) * 1.8, 0, 100)
  const macdCrossover = clamp(50 + liveRow.changePercent * 19 + Math.sin((liveRow.price / 12) + liveRow.baseBias) * 6, 0, 100)
  const atrDip = clamp(100 - Math.abs(liveRow.changePercent) * 21 - Math.abs(liveRow.price - liveRow.basePrice) * 2.2, 0, 100)
  const emaStructure = clamp(50 + (liveRow.changePercent - marketAverageChange) * 18, 0, 100)
  const volumeConfirmation = clamp((liveRow.baseQuality * 0.62) + (liveRow.stability * 0.38), 0, 100)

  return {
    'rsi-oversold': rsiOversold,
    'macd-crossover': macdCrossover,
    'atr-dip': atrDip,
    'ema-structure': emaStructure,
    'volume-confirmation': volumeConfirmation,
  }
}

function detectSignificantMoments(liveRow, directives) {
  const moments = []

  // SIMULATION: uses canonical-named but synthetic directive scores
  if (liveRow.changePercent > 1.0 && directives['rsi-oversold'] > 78 && directives['macd-crossover'] > 75) {
    moments.push({
      id: 'breakout-acceleration',
      label: 'Breakout Acceleration',
      boost: 14,
      multiplier: 1.08,
    })
  }

  if (directives['ema-structure'] > 68 && directives['atr-dip'] > 66) {
    moments.push({
      id: 'broad-risk-on',
      label: 'Broad Risk-On Alignment',
      boost: 9,
      multiplier: 1.05,
    })
  }

  if (liveRow.baseQuality > 82 && liveRow.stability > 82) {
    moments.push({
      id: 'quality-carry',
      label: 'Quality Carry',
      boost: 7,
      multiplier: 1.04,
    })
  }

  if (Math.abs(liveRow.changePercent) > 1.2 && directives['macd-crossover'] < 46) {
    moments.push({
      id: 'reversion-risk',
      label: 'Mean Reversion Risk',
      boost: -10,
      multiplier: 0.93,
    })
  }

  return moments
}

export function buildSeesRanking(symbols, tick = 0) {
  const liveRows = symbols.map((symbol, index) => deriveLiveState(symbol, tick, index))
  const marketAverageChange = liveRows.reduce((sum, row) => sum + row.changePercent, 0) / Math.max(liveRows.length, 1)

  const ranked = liveRows.map((row, index) => {
    const directives = buildDirectiveBreakdown(row, marketAverageChange)
    const baseScore = SEES_DIRECTIVES.reduce((total, directive) => total + directives[directive.id] * directive.weight, 0)
    const moments = detectSignificantMoments(row, directives)
    const boostTotal = moments.reduce((total, moment) => total + moment.boost, 0)
    const multiplier = moments.reduce((total, moment) => total * moment.multiplier, 1)
    const finalScore = Math.max(0, (baseScore + boostTotal) * multiplier)
    const confidence = clamp(1 / (1 + Math.exp(-(finalScore - 85) / 18)), 0.28, 0.99)
    const signal = finalScore >= SEES_STRATEGY.entryThreshold
      ? 'entry'
      : finalScore >= SEES_STRATEGY.watchThreshold
        ? 'watch'
        : 'defensive'

    return {
      symbolId: `${row.symbol}-${tick}-${index}`,
      ticker: row.symbol,
      name: row.name,
      industry: row.industry,
      price: row.price,
      changePercent: row.changePercent,
      score: Number(finalScore.toFixed(1)),
      baseScore: Number(baseScore.toFixed(1)),
      boostScore: Number(boostTotal.toFixed(1)),
      scoreMultiplier: Number(multiplier.toFixed(3)),
      confidence: Number(confidence.toFixed(2)),
      signal,
      freshness: Math.abs(row.changePercent) < 0.45 ? 'fresh' : Math.abs(row.changePercent) < 0.95 ? 'watch' : 'stale',
      directives,
      moments,
      baseQuality: row.baseQuality,
      stability: row.stability,
    }
  })

  ranked.sort((a, b) => b.score - a.score)

  return {
    mode: 'local-direct-route',
    strategy: SEES_STRATEGY,
    directives: SEES_DIRECTIVES,
    marketAverageChange: Number(marketAverageChange.toFixed(2)),
    ranked,
  }
}
