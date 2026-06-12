import { useState, useEffect } from 'react'
import LoadingSkeleton from '../components/LoadingSkeleton'
import DirectivePalette from '../components/StrategyBuilder/DirectivePalette'
import StrategyCanvas from '../components/StrategyBuilder/StrategyCanvas'
import '../components/StrategyBuilder/strategy-builder.css'

/**
 * Seed directive data matching the backend registry.
 * In production, this comes from GET /api/directives.
 */
const SEED_DIRECTIVES = [
  { id: 'rsi-oversold', name: 'RSI Oversold Reversion', category: 'Momentum', description: 'Bullish when RSI(14) < 30 and curling upward', complexity: 'low' },
  { id: 'macd-crossover', name: 'MACD Bullish Crossover', category: 'Momentum', description: 'Bullish when MACD line crosses above signal line', complexity: 'medium' },
  { id: 'ema-structure', name: 'Price Above EMA Structure', category: 'Trend', description: 'Stronger when price > EMA20 > EMA50', complexity: 'low' },
  { id: 'atr-dip', name: 'ATR Normalized Dip', category: 'Volatility', description: 'Favors dips that are significant but not breakdown-level', complexity: 'medium' },
  { id: 'volume-confirmation', name: 'Volume Confirmation', category: 'Participation', description: 'Bullish setups score higher with volume support', complexity: 'medium' },
  { id: 'mfi', name: 'Money Flow Index', category: 'Momentum', description: 'MFI confirms volume + price divergence', complexity: 'medium' },
  { id: 'adx', name: 'Average Directional Index', category: 'Trend', description: 'ADX > 25 confirms trending market', complexity: 'low' },
  { id: 'stochastic', name: 'Stochastic Oscillator', category: 'Momentum', description: 'Measures overbought/oversold momentum', complexity: 'low' },
  { id: 'rsi-overbought', name: 'RSI Overbought Warning', category: 'Momentum', description: 'Warning when RSI(14) > 70', complexity: 'low' },
  { id: 'momentum-continuation-combo', name: 'Momentum Continuation Combo', category: 'Momentum', description: 'Combines multiple momentum signals', complexity: 'high' },
  { id: 'bollinger-bands', name: 'Bollinger Bands', category: 'Volatility', description: 'Tests price relative to volatility bands', complexity: 'medium' },
  { id: 'volume-surge', name: 'Volume Surge Detection', category: 'Volume', description: 'Detects abnormal volume spikes', complexity: 'low' },
  { id: 'vwap', name: 'VWAP', category: 'Volume', description: 'Volume-weighted average price comparison', complexity: 'low' },
  { id: 'obv', name: 'On-Balance Volume', category: 'Volume', description: 'Volume trend confirmation', complexity: 'low' },
  { id: 'engulfing-pattern', name: 'Engulfing Pattern', category: 'Pattern', description: 'Bullish/bearish engulfing candlestick pattern', complexity: 'medium' },
  { id: 'vix-regime', name: 'VIX Regime', category: 'Macro', description: 'Market volatility regime detection', complexity: 'medium' },
]

export default function StrategyBuilderPage() {
  const [simulatedLoading, setSimulatedLoading] = useState(true)
  const [directives, setDirectives] = useState(SEED_DIRECTIVES)
  const [canvasIds, setCanvasIds] = useState([])
  const [weights, setWeights] = useState({})

  useEffect(() => {
    const timer = setTimeout(() => setSimulatedLoading(false), 500)
    return () => clearTimeout(timer)
  }, [])

  function handleDragStart(e, directive) {
    e.dataTransfer.setData('application/json', JSON.stringify({ id: directive.id }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleWeightChange(id, weight) {
    setWeights((prev) => ({ ...prev, [id]: weight }))
  }

  function handleRemove(id) {
    setCanvasIds((prev) => prev.filter((i) => i !== id))
    setWeights((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function handleAddToCanvas(id) {
    if (!canvasIds.includes(id)) {
      setCanvasIds((prev) => [...prev, id])
      setWeights((prev) => ({ ...prev, [id]: prev[id] || 10 }))
    }
  }

  function handleReset() {
    setCanvasIds([])
    setWeights({})
  }

  // ---- Loading state ----
  if (simulatedLoading) {
    return (
      <div className="sb-page">
        <header className="sb-header">
          <h1>Strategy Builder</h1>
        </header>
        <div className="sb-layout">
          <LoadingSkeleton variant="card" count={6} />
          <LoadingSkeleton variant="card" count={3} />
        </div>
      </div>
    )
  }

  return (
    <div className="sb-page">
      <header className="sb-header">
        <h1>Strategy Builder</h1>
        <p>Drag directives from the palette onto the canvas to compose a strategy.</p>
      </header>

      <div className="sb-layout">
        <DirectivePalette
          directives={directives}
          onDragStart={handleDragStart}
        />

        <StrategyCanvas
          directives={canvasIds}
          weights={weights}
          directivesMeta={directives}
          onWeightChange={(id, w) => {
            handleWeightChange(id, w)
            // If the directive isn't in the canvas yet, add it
            if (!canvasIds.includes(id)) {
              handleAddToCanvas(id)
            }
          }}
          onRemove={handleRemove}
          onReset={handleReset}
        />
      </div>
    </div>
  )
}
