/**
 * Directive Meta — enriched educational metadata
 * ===============================================
 * Extracted from NestJS directive implementations to surface
 * the actual math, parameters, and scoring logic in plain English.
 *
 * Schema per entry:
 *   id             — matches directive.id
 *   parameters     — { paramName: value } key constants used in scoring
 *   scoringZones   — [{ range, score, meaning }] the decision zones
 *   interpretation — plain-language guide on how to read scores
 */

const DIRECTIVE_META = {
  'atr-dip': {
    parameters: {
      'ATR Period': 14,
      'Lookback (recent high)': '20 bars',
      'Sweet spot': '1.0–2.0 ATR',
    },
    scoringZones: [
      { range: 'Price ≥ recent high (no dip)', score: '15', meaning: 'No pullback exists — price is at or above the 20-bar high.' },
      { range: 'Dip < 0.5 ATR', score: '20–35', meaning: 'Too shallow. The pullback is noise, not a tradable dip.' },
      { range: 'Dip 0.5–2.0 ATR ★', score: '65–100', meaning: 'Ideal pullback depth. Significant enough for a good entry but shallow enough to suggest the trend is intact. Peaks at 1.3 ATR.' },
      { range: 'Dip 2.0–3.0 ATR', score: '25–40', meaning: 'Extended. Still tradeable but higher risk — approaching breakdown territory.' },
      { range: 'Dip > 3.0 ATR', score: '5', meaning: 'Likely a breakdown, not a dip. Structural damage — not a buying opportunity.' },
    ],
    interpretation: 'Measures how far price has pulled back from its 20-bar high, expressed in ATR units. A score of 85+ means the pullback is at the statistically ideal depth (~1.3 ATR) where dips tend to rebound. Scores below 20 mean either no dip exists or the decline is too extreme.',
  },

  'bollinger-band-squeeze': {
    parameters: {
      'BB Period': 20,
      'Std Dev Multiplier': 2,
      'Bandwidth lookback': '50 bars',
    },
    scoringZones: [
      { range: '%B ≤ 0.2 (lower band)', score: '60–95', meaning: 'Price hugging the lower band — statistically oversold. A bounce is probable, especially if %B is turning upward.' },
      { range: '%B ≥ 0.8 (upper band)', score: '10–20', meaning: 'Price stretched above the upper band — overbought. Poor risk/reward for new long entries.' },
      { range: '0.2 < %B < 0.8 (mid-band)', score: '40', meaning: 'Neutral. Price is in equilibrium within the envelope — no extreme signal.' },
    ],
    interpretation: 'Uses %B (position within Bollinger Bands) to spot mean-reversion opportunities. Like a rubber-band meter: stretched down = bullish bounce likely, stretched up = bearish pullback likely. The +10 "turning" bonus rewards early confirmation that the bounce has already begun.',
  },

  'rsi-oversold': {
    parameters: {
      'RSI Period': 14,
      'Oversold threshold': '30',
    },
    scoringZones: [
      { range: 'RSI ≤ 30 + curling up ★', score: '58–100', meaning: 'The ideal setup: deeply oversold AND starting to recover. Both conditions confirmed — highest conviction.' },
      { range: 'RSI ≤ 30, still falling', score: '50–80', meaning: 'Oversold but no turn yet. Good potential but unconfirmed — the knife may still be dropping.' },
      { range: 'RSI > 30', score: '0–25', meaning: 'Not oversold. No reversion signal — the market hasn\'t washed out enough.' },
    ],
    interpretation: 'Looks for washed-out conditions (RSI < 30) plus a curling-upward confirmation that selling exhaustion is turning into recovery. The depth bonus rewards deeper oversold readings (RSI=10 scores higher than RSI=28). The curl bonus is binary: +8 points if RSI is rising vs the previous bar.',
  },

  'macd-crossover': {
    parameters: {
      'MACD Fast': 12,
      'MACD Slow': 26,
      'Signal': 9,
    },
    scoringZones: [
      { range: 'Fresh bullish crossover ★', score: '70–100', meaning: 'MACD just crossed above signal — the classic buy signal. Stronger crossovers score higher.' },
      { range: 'Bullish + accelerating', score: '45–70', meaning: 'Already bullish and momentum is still building. Good but less timely than a fresh cross.' },
      { range: 'Bearish but narrowing', score: '20', meaning: 'Still negative but gap is closing — a crossover may be approaching. Watch for confirmation.' },
      { range: 'Bearish + worsening', score: '5', meaning: 'Deeply bearish with no improvement. Strong anti-signal for longs.' },
      { range: 'Flat / neutral', score: '30', meaning: 'MACD is flat — no directional momentum present.' },
    ],
    interpretation: 'Tracks the MACD histogram — the "breath" between the MACD line and signal line. A fresh crossover from negative to positive is the strongest signal (70+). Accelerating bullish momentum scores 45–70. Narrowing bearishness at 20 suggests a turn may be coming.',
  },

  'adx': {
    parameters: {
      'ADX Period': 14,
      'Strong trend': 'ADX ≥ 25',
      'Weak trend': 'ADX < 20',
    },
    scoringZones: [
      { range: 'ADX ≥ 25, +DI > -DI ★', score: '65–100', meaning: 'Strong trending market with bullish bias. The trend is powerful and in your favor.' },
      { range: 'ADX ≥ 25, -DI > +DI', score: '10–25', meaning: 'Strong trend but going against you — anti-long signal.' },
      { range: '20 ≤ ADX < 25, +DI > -DI', score: '45–65', meaning: 'Trend developing with bullish lean. Decent but not yet high-conviction.' },
      { range: '20 ≤ ADX < 25, -DI > +DI', score: '30', meaning: 'Moderate trend with bearish bias. Limited long opportunity.' },
      { range: 'ADX < 20 (ranging)', score: '25–35', meaning: 'Choppy/ranging market. Directional bias is unreliable without trend strength.' },
    ],
    interpretation: 'ADX measures trend STRENGTH (not direction). +DI/-DI indicate direction. This directive rewards strong trends going your way and penalizes strong trends going against you. Weak ADX (< 20) means the market is range-bound — even a bullish DI bias gets a modest score because ranges are unreliable.',
  },

  'ema-structure': {
    parameters: {
      'Fast EMA': 20,
      'Slow EMA': 50,
    },
    scoringZones: [
      { range: 'Price > EMA20 > EMA50 ★', score: '65–100', meaning: 'Full bullish alignment — classic uptrend structure. Cleaner separation = higher score.' },
      { range: 'Price > EMA20 but EMA20 < EMA50', score: '35', meaning: 'Partial alignment. Price above fast EMA but EMAs haven\'t crossed bullishly yet — unconfirmed.' },
      { range: 'Price < EMA20, EMAs bullish', score: '25', meaning: 'EMAs are aligned bullishly but price dipped below the fast EMA. Could be a pullback entry or trend break.' },
      { range: 'No alignment', score: '10', meaning: 'Bearish or chaotic structure. EMAs not stacked bullishly — avoid for trend-following longs.' },
    ],
    interpretation: 'Checks for the classic bullish EMA stack: price riding above the 20-period EMA, which sits above the 50-period EMA. This is trend-following 101. Full alignment scores 65+, with the separation factor rewarding clean, well-spaced trends.',
  },

  'volume-surge': {
    parameters: {
      'Average period': 20,
      'Surge threshold': '3× average',
    },
    scoringZones: [
      { range: 'Volume < 3× average', score: '0', meaning: 'Normal volume — no unusual activity. This directive contributes nothing when volume is ordinary.' },
      { range: '≥ 3× on up day ★', score: '65–95', meaning: 'Extreme volume spike on a green candle — institutional accumulation likely. Higher surge ratio = higher conviction.' },
      { range: '≥ 3× on down day', score: '10–20', meaning: 'Extreme volume on a red candle — capitulation or distribution. Anti-long signal.' },
    ],
    interpretation: 'An outlier detector for volume. Only triggers on extreme events (≥ 3× the 20-bar average). On up days this suggests smart money accumulating; on down days it suggests panic or distribution. The magnitude factor scales from 3× to 8× — bigger surges score higher.',
  },

  'momentum-roc': {
    parameters: {
      'RoC Period': 12,
    },
    scoringZones: [
      { range: 'RoC(12) > +5% ★', score: '60–100', meaning: 'Strong upward momentum — price up >5% in 12 bars. Accelerating RoC adds +10 bonus.' },
      { range: 'RoC(12) < -5%', score: '40–70', meaning: 'Strong downward momentum. Bearish for longs but the score floor acknowledges oversold reversion potential.' },
      { range: '-5% ≤ RoC ≤ +5%', score: '30–50', meaning: 'Modest/sideways momentum. No strong signal either way.' },
    ],
    interpretation: 'Measures the percentage price change over 12 bars (Rate of Change). Strong positive RoC with acceleration is the best signal — suggests the move has both magnitude and building force. Extreme negative RoC scores moderately because it can signal both trend breakdown AND oversold bounce potential.',
  },
};

/**
 * Look up enriched metadata for a directive.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getDirectiveMeta(id) {
  return DIRECTIVE_META[id];
}

/**
 * Check if enriched metadata exists for a directive.
 * @param {string} id
 * @returns {boolean}
 */
export function hasDirectiveMeta(id) {
  return !!DIRECTIVE_META[id];
}

export default DIRECTIVE_META;
