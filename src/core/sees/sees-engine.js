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
 * 🔴 The abstract directive names below (trend, momentum, volatility, breadth,
 *    conviction) and the boost/multiplier "moments" system are SIMULATION ONLY.
 *    They must NOT influence the NestJS backend directive specification.
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
    id: 'trend',
    label: 'Trend Strength',
    indicator: 'EMA slope + price position',
    weight: 0.28,
    description: 'Rewards sustained directional movement and price staying above the local baseline.',
  },
  {
    id: 'momentum',
    label: 'Momentum',
    indicator: 'Rate of change + acceleration',
    weight: 0.24,
    description: 'Rewards acceleration when the recent move is still expanding rather than fading.',
  },
  {
    id: 'volatility',
    label: 'Volatility Control',
    indicator: 'Range compression + shock penalty',
    weight: 0.18,
    description: 'Rewards controlled movement and penalizes unstable swings.',
  },
  {
    id: 'breadth',
    label: 'Market Breadth',
    indicator: 'Relative rank vs market average',
    weight: 0.16,
    description: 'Rewards names moving better than the rest of the sample set.',
  },
  {
    id: 'conviction',
    label: 'Conviction',
    indicator: 'Confidence + baseline quality',
    weight: 0.14,
    description: 'Rewards stable names that keep their score while the tape changes.',
  },
]

export const SEES_STRATEGY = {
  id: 'direct-route-core',
  name: 'Direct Route Core (🧪 Simulation)',
  description: 'A SIMULATION strategy for visual prototyping. Uses synthetic math — not real market indicators. Production strategy is "Conviction Dip Accumulation" using rsi-oversold, macd-crossover, ema-structure, atr-dip, volume-confirmation directives.',
  entryThreshold: 112,
  watchThreshold: 86,
  defenseThreshold: 58,
  activeDirectives: ['trend', 'momentum', 'volatility', 'breadth', 'conviction'],
  notes: [
    '🔴 SIMULATION ONLY — see docs/CANONICAL-DIRECTIVE-REFERENCE.md for production directives.',
    'This strategy uses abstract synthetic directives for visual prototyping.',
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
  const trend = clamp(52 + liveRow.changePercent * 16 + (liveRow.price - liveRow.basePrice) * 1.8, 0, 100)
  const momentum = clamp(50 + liveRow.changePercent * 19 + Math.sin((liveRow.price / 12) + liveRow.baseBias) * 6, 0, 100)
  const volatility = clamp(100 - Math.abs(liveRow.changePercent) * 21 - Math.abs(liveRow.price - liveRow.basePrice) * 2.2, 0, 100)
  const breadth = clamp(50 + (liveRow.changePercent - marketAverageChange) * 18, 0, 100)
  const conviction = clamp((liveRow.baseQuality * 0.62) + (liveRow.stability * 0.38), 0, 100)

  return {
    trend,
    momentum,
    volatility,
    breadth,
    conviction,
  }
}

function detectSignificantMoments(liveRow, directives) {
  const moments = []

  if (liveRow.changePercent > 1.0 && directives.trend > 78 && directives.momentum > 75) {
    moments.push({
      id: 'breakout-acceleration',
      label: 'Breakout Acceleration',
      boost: 14,
      multiplier: 1.08,
    })
  }

  if (directives.breadth > 68 && directives.volatility > 66) {
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

  if (Math.abs(liveRow.changePercent) > 1.2 && directives.momentum < 46) {
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
