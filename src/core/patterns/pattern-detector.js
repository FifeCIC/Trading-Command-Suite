/**
 * Pattern Detector — client-side candlestick pattern recognition.
 * Accepts OHLCV candle arrays and returns detected patterns with confidence.
 */

function body(open, close) { return Math.abs(close - open); }
function upperWick(high, open, close) { return high - Math.max(open, close); }
function lowerWick(low, open, close) { return Math.min(open, close) - low; }
function totalRange(high, low) { return high - low || 0.0001; }
function isBullish(open, close) { return close > open; }
function isBearish(open, close) { return close < open; }

// ── Single-candle patterns ──

function detectDoji(c) {
  const b = body(c.open, c.close);
  const r = totalRange(c.high, c.low);
  if (r < 0.0001) return null;
  const ratio = b / r;
  if (ratio < 0.1) return { pattern: 'doji', confidence: Math.round((1 - ratio * 10) * 100), type: 'neutral' };
  return null;
}

function detectHammer(c) {
  const b = body(c.open, c.close);
  const lw = lowerWick(c.low, c.open, c.close);
  const uw = upperWick(c.high, c.open, c.close);
  const r = totalRange(c.high, c.low);
  if (r < 0.0001) return null;
  if (lw > b * 2 && uw < b * 0.3 && isBullish(c.open, c.close))
    return { pattern: 'hammer', confidence: Math.round(Math.min(100, (lw / r) * 120)), type: 'bullish' };
  return null;
}

function detectShootingStar(c) {
  const b = body(c.open, c.close);
  const uw = upperWick(c.high, c.open, c.close);
  const lw = lowerWick(c.low, c.open, c.close);
  const r = totalRange(c.high, c.low);
  if (r < 0.0001) return null;
  if (uw > b * 2 && lw < b * 0.3 && isBearish(c.open, c.close))
    return { pattern: 'shooting-star', confidence: Math.round(Math.min(100, (uw / r) * 120)), type: 'bearish' };
  return null;
}

function detectMarubozu(c) {
  const b = body(c.open, c.close);
  const r = totalRange(c.high, c.low);
  if (r < 0.0001) return null;
  if (b / r > 0.9) {
    return { pattern: 'marubozu', confidence: Math.round((b / r) * 100), type: isBullish(c.open, c.close) ? 'bullish' : 'bearish' };
  }
  return null;
}

// ── Multi-candle patterns ──

function detectEngulfing(prev, curr) {
  if (!prev) return null;
  const prevBody = body(prev.open, prev.close);
  const currBody = body(curr.open, curr.close);
  if (currBody > prevBody * 1.1) {
    if (isBullish(curr.open, curr.close) && isBearish(prev.open, prev.close) && curr.close > prev.open && curr.open < prev.close)
      return { pattern: 'engulfing-bull', confidence: Math.round(Math.min(100, (currBody / prevBody) * 60)), type: 'bullish' };
    if (isBearish(curr.open, curr.close) && isBullish(prev.open, prev.close) && curr.close < prev.open && curr.open > prev.close)
      return { pattern: 'engulfing-bear', confidence: Math.round(Math.min(100, (currBody / prevBody) * 60)), type: 'bearish' };
  }
  return null;
}

function detectHarami(prev, curr) {
  if (!prev) return null;
  const prevBody = body(prev.open, prev.close);
  const currBody = body(curr.open, curr.close);
  if (currBody < prevBody * 0.5) {
    if (isBullish(curr.open, curr.close) && isBearish(prev.open, prev.close))
      return { pattern: 'harami-bull', confidence: Math.round(Math.min(100, (1 - currBody / prevBody) * 120)), type: 'bullish' };
    if (isBearish(curr.open, curr.close) && isBullish(prev.open, prev.close))
      return { pattern: 'harami-bear', confidence: Math.round(Math.min(100, (1 - currBody / prevBody) * 120)), type: 'bearish' };
  }
  return null;
}

function detectInsideBar(prev, curr) {
  if (!prev) return null;
  if (curr.high < prev.high && curr.low > prev.low) {
    // Tighter inside bar = higher confidence
    const prevRange = totalRange(prev.high, prev.low);
    const currRange = totalRange(curr.high, curr.low);
    const ratio = 1 - (currRange / prevRange); // 0 = same size, 1 = tiny inside
    const confidence = Math.round(65 + ratio * 30);
    return { pattern: 'inside-bar', confidence: Math.min(98, confidence), type: 'neutral' };
  }
  return null;
}

function detectThreeWhiteSoldiers(candles, i) {
  if (i < 2) return null;
  const c1 = candles[i - 2], c2 = candles[i - 1], c3 = candles[i];
  if (isBullish(c1.open, c1.close) && isBullish(c2.open, c2.close) && isBullish(c3.open, c3.close)) {
    if (c3.close > c2.close && c2.close > c1.close && c3.open > c2.open && c2.open > c1.open) {
      // Stronger momentum = higher confidence
      const momentum = ((c3.close - c1.open) / (c1.open || 0.01)) * 100;
      const consistency = (body(c2.open, c2.close) + body(c3.open, c3.close)) / (body(c1.open, c1.close) + 0.01);
      const confidence = Math.round(60 + Math.min(35, Math.abs(momentum) * 2 + consistency * 5));
      return { pattern: 'three-white-soldiers', confidence: Math.min(98, confidence), type: 'bullish' };
    }
  }
  return null;
}

function detectThreeBlackCrows(candles, i) {
  if (i < 2) return null;
  const c1 = candles[i - 2], c2 = candles[i - 1], c3 = candles[i];
  if (isBearish(c1.open, c1.close) && isBearish(c2.open, c2.close) && isBearish(c3.open, c3.close)) {
    if (c3.close < c2.close && c2.close < c1.close && c3.open < c2.open && c2.open < c1.open) {
      const momentum = ((c1.open - c3.close) / (c1.open || 0.01)) * 100;
      const consistency = (body(c2.open, c2.close) + body(c3.open, c3.close)) / (body(c1.open, c1.close) + 0.01);
      const confidence = Math.round(60 + Math.min(35, Math.abs(momentum) * 2 + consistency * 5));
      return { pattern: 'three-black-crows', confidence: Math.min(98, confidence), type: 'bearish' };
    }
  }
  return null;
}

function detectMorningStar(candles, i) {
  if (i < 2) return null;
  const c1 = candles[i - 2], c2 = candles[i - 1], c3 = candles[i];
  if (isBearish(c1.open, c1.close) && body(c2.open, c2.close) / totalRange(c2.high, c2.low) < 0.3 && isBullish(c3.open, c3.close)) {
    if (c3.close > (c1.open + c1.close) / 2) {
      const reversalStrength = (c3.close - c1.close) / (c1.open - c1.close || 0.01);
      const confidence = Math.round(60 + Math.min(35, reversalStrength * 20));
      return { pattern: 'morning-star', confidence: Math.min(98, confidence), type: 'bullish' };
    }
  }
  return null;
}

function detectEveningStar(candles, i) {
  if (i < 2) return null;
  const c1 = candles[i - 2], c2 = candles[i - 1], c3 = candles[i];
  if (isBullish(c1.open, c1.close) && body(c2.open, c2.close) / totalRange(c2.high, c2.low) < 0.3 && isBearish(c3.open, c3.close)) {
    if (c3.close < (c1.open + c1.close) / 2) {
      const reversalStrength = (c1.close - c3.close) / (c1.close - c1.open || 0.01);
      const confidence = Math.round(60 + Math.min(35, reversalStrength * 20));
      return { pattern: 'evening-star', confidence: Math.min(98, confidence), type: 'bearish' };
    }
  }
  return null;
}

// ── Main detection function ──

const DETECTORS = [
  detectDoji, detectHammer, detectShootingStar, detectMarubozu,
];

const MULTI_DETECTORS = [
  { fn: detectEngulfing, needs: 1 },
  { fn: detectHarami, needs: 1 },
  { fn: detectInsideBar, needs: 1 },
  { fn: detectThreeWhiteSoldiers, needs: 2 },
  { fn: detectThreeBlackCrows, needs: 2 },
  { fn: detectMorningStar, needs: 2 },
  { fn: detectEveningStar, needs: 2 },
];

export function detectPatterns(candles) {
  if (!Array.isArray(candles) || candles.length < 3) return [];

  const results = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const detected = [];

    // Single-candle patterns
    for (const detector of DETECTORS) {
      const result = detector(c);
      if (result) detected.push({ ...result, index: i, bar: `Bar ${i + 1}` });
    }

    // Multi-candle patterns
    for (const { fn, needs } of MULTI_DETECTORS) {
      const result = fn(candles, i);
      if (result) detected.push({ ...result, index: i, bar: `Bar ${i + 1}` });
    }

    if (detected.length) results.push(...detected);
  }

  return results;
}
