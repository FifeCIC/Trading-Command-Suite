// Candle pattern reference data — extracted from CandlePatternsGuidePage.jsx
// @generated 2026-07-03

const PATTERNS = [
  // ═══ SINGLE CANDLE ═══
  {
    id: 'doji', name: 'Doji', type: 'neutral', category: 'single', signal: 'indecision',
    reliability: 'Medium',
    summary: 'Open and close are nearly identical, creating a cross or plus shape. Signals market indecision — a potential reversal when appearing after a strong trend.',
    overview: `The Doji is one of the most important single-candle patterns in technical analysis. It forms when the opening and closing prices are virtually identical, resulting in a candle with an extremely small (or nonexistent) real body. The Doji represents a moment of equilibrium where neither buyers nor sellers have gained control — the market has essentially tied.

What makes the Doji significant is its location. A Doji in the middle of a trading range is unremarkable — it simply means the market is undecided. But a Doji that appears after a prolonged uptrend or downtrend signals that the dominant force is losing steam. The trend has run out of conviction, and a reversal may be imminent.`,
    psychology: `The Doji tells a story of a battle that ended in a draw. During the session, price moved both higher and lower, but by the close, neither side could hold their gains. In an uptrend, this means buyers pushed price up but couldn't sustain it — sellers fought back to the opening price. In a downtrend, sellers drove price lower but buyers clawed it all back. The longer the preceding trend, the more meaningful the Doji becomes.`,
    bullish: {
      context: 'A Doji that appears at the bottom of a downtrend suggests selling pressure is exhausted. Sellers can no longer push price lower, and buyers have stepped in to neutralize the decline.',
      confirmation: 'Look for a strong bullish candle closing above the Doji\'s high on the next session. This confirms that buyers have taken control. Volume should expand on the confirmation candle.',
      failure: 'If price closes below the Doji\'s low on the next session, the indecision resolved bearishly — the downtrend is likely to continue.'
    },
    bearish: {
      context: 'A Doji at the top of an uptrend signals that buying momentum is waning. Buyers pushed price higher intraday but could not hold those levels, and the close returned to near the open.',
      confirmation: 'A bearish candle closing below the Doji\'s low on the following session confirms the reversal. Look for increased volume on the confirmation move.',
      failure: 'If the next candle closes above the Doji\'s high, buyers have reasserted control and the uptrend remains intact.'
    },
    tips: 'Wait for confirmation. A Doji alone is not a trade signal — it is a warning flag. Always wait for the next candle to confirm direction before acting.',
    chart: [
      { bodyTop: 35, bodyBottom: 50, wickTop: 10, wickBottom: 75, color: 'bear', faded: true },
      { bodyTop: 20, bodyBottom: 65, wickTop: 5, wickBottom: 68, color: 'bear', faded: true },
      { bodyTop: 44, bodyBottom: 46, wickTop: 15, wickBottom: 80, color: 'doji', highlighted: true },
      { bodyTop: 70, bodyBottom: 30, wickTop: 75, wickBottom: 25, color: 'bull', faded: false },
      { bodyTop: 85, bodyBottom: 20, wickTop: 90, wickBottom: 15, color: 'bull', faded: false }
    ]
  },
  {
    id: 'dragonfly-doji', name: 'Dragonfly Doji', type: 'bullish', category: 'single', signal: 'reversal',
    reliability: 'High',
    summary: 'Open and close at the high of the session with a long lower wick. A powerful bullish reversal signal when appearing after a downtrend.',
    overview: `The Dragonfly Doji is a distinctive single-candle reversal pattern. It opens and closes at or very near the high of the session, while a long lower shadow extends far below. Visually, it resembles a "T" shape. This formation occurs when sellers drove price sharply lower during the session, only for buyers to surge back and reclaim all lost ground, pushing the close back to the open/high.

The Dragonfly Doji is the bullish counterpart to the Gravestone Doji. Its long lower wick represents a successful test of support — sellers tried to break the market down but were completely rejected. The pattern is most potent at the bottom of a downtrend or at established support levels.`,
    psychology: `The intraday story is one of seller capitulation followed by buyer dominance. Sellers had control for most of the session, driving price to new lows. But at those lows, buyers stepped in aggressively. The recovery was so complete that price returned to the opening level by the close. This suggests that a significant pocket of demand has been discovered, and sellers are unlikely to try those levels again soon.`,
    bullish: {
      context: 'At the end of a downtrend, the Dragonfly Doji signals that buyers have found value at lower prices and are willing to defend those levels aggressively. The long lower wick is a visible rejection of lower prices.',
      confirmation: 'A bullish candle on the next session that closes above the Dragonfly\'s high confirms the reversal. Volume should be higher than average on the confirmation candle.',
      failure: 'If price closes below the Dragonfly\'s low (the tip of the lower wick), the support level has failed. Exit immediately — the downtrend is resuming.'
    },
    bearish: {
      context: 'A Dragonfly Doji in an uptrend is less common but can signal that buyers are losing momentum. The inability to close higher despite the recovery suggests distribution.',
      confirmation: 'N/A — the Dragonfly Doji is primarily a bullish reversal pattern. Its appearance in an uptrend should be treated as a warning rather than a direct signal.',
      failure: 'If followed by continued higher closes, the uptrend remains intact and the Dragonfly was a false signal.'
    },
    tips: 'The longer the lower wick relative to the body, the stronger the signal. A wick at least 3x the body height is ideal. Combine with oversold RSI or support levels for higher-probability entries.',
    chart: [
      { bodyTop: 25, bodyBottom: 70, wickTop: 15, wickBottom: 75, color: 'bear', faded: true },
      { bodyTop: 15, bodyBottom: 60, wickTop: 5, wickBottom: 65, color: 'bear', faded: true },
      { bodyTop: 43, bodyBottom: 45, wickTop: 42, wickBottom: 85, color: 'doji', highlighted: true },
      { bodyTop: 70, bodyBottom: 35, wickTop: 75, wickBottom: 30, color: 'bull', faded: false },
      { bodyTop: 85, bodyBottom: 25, wickTop: 90, wickBottom: 20, color: 'bull', faded: false }
    ]
  },
  {
    id: 'gravestone-doji', name: 'Gravestone Doji', type: 'bearish', category: 'single', signal: 'reversal',
    reliability: 'High',
    summary: 'Open and close at the low of the session with a long upper wick. A powerful bearish reversal signal when appearing after an uptrend.',
    overview: `The Gravestone Doji is the bearish mirror of the Dragonfly Doji. It forms when the open and close are at or near the session low, with a long upper shadow extending far above. The candle looks like an inverted "T" and carries the grim symbolism of a gravestone — buyers who chased price higher are now "buried" at the top of the wick.

This pattern forms when buyers pushed price significantly higher during the session, only for sellers to overwhelm them and drive price all the way back down to the opening level by the close. The long upper wick represents a failed breakout — an excursion that was completely reversed.`,
    psychology: `The Gravestone Doji captures a failed rally. Buyers were initially enthusiastic, driving price to new highs. But those highs attracted sellers who overwhelmed demand. The complete retracement back to the open indicates that every buyer who participated above the open is now underwater. This creates overhead supply — trapped buyers who will sell on any subsequent rally to break even, adding downward pressure.`,
    bullish: {
      context: 'N/A — the Gravestone Doji is primarily a bearish reversal pattern.',
      confirmation: 'If a Gravestone Doji appears in a downtrend, it may actually be a failed breakdown (bullish). A green candle closing above the upper wick would confirm this.',
      failure: 'If followed by a bullish candle closing above the upper wick, the bearish signal is invalidated.'
    },
    bearish: {
      context: 'At the top of an uptrend, the Gravestone Doji signals that buying pressure has been completely absorbed. The failure to hold higher prices suggests distribution — smart money selling into retail enthusiasm.',
      confirmation: 'A bearish candle closing below the Gravestone\'s low on the next session confirms the reversal. Volume on the confirmation candle should be elevated.',
      failure: 'If the next candle closes above the Gravestone\'s high (upper wick tip), buyers are still in control and the uptrend continues.'
    },
    tips: 'The Gravestone Doji is particularly reliable at resistance levels or after a parabolic move. Combine with overbought RSI (>70) or bearish divergence for higher-conviction trades.',
    chart: [
      { bodyTop: 75, bodyBottom: 25, wickTop: 85, wickBottom: 20, color: 'bull', faded: true },
      { bodyTop: 80, bodyBottom: 30, wickTop: 90, wickBottom: 25, color: 'bull', faded: true },
      { bodyTop: 42, bodyBottom: 44, wickTop: 10, wickBottom: 43, color: 'doji', highlighted: true },
      { bodyTop: 20, bodyBottom: 65, wickTop: 15, wickBottom: 70, color: 'bear', faded: false },
      { bodyTop: 15, bodyBottom: 75, wickTop: 10, wickBottom: 80, color: 'bear', faded: false }
    ]
  },
  {
    id: 'hammer', name: 'Hammer', type: 'bullish', category: 'single', signal: 'reversal',
    reliability: 'High',
    summary: 'Small real body at the top of the candle with a long lower wick (at least 2x the body). Appears after a downtrend and signals a bullish reversal.',
    overview: `The Hammer is a single-candle bullish reversal pattern that forms after a decline. It has a small real body at the upper end of the trading range with a long lower shadow that is at least twice the length of the body. The upper shadow should be very small or nonexistent. The color of the body is less important than its position — a green hammer is slightly more bullish than a red one, but both are valid.

The name comes from the visual: the candle looks like a hammer, with the body as the head and the long lower wick as the handle. The metaphor extends to the market action — the hammer is "hammering out" a bottom.`,
    psychology: `During the session, sellers pushed price significantly lower, continuing the downtrend. But at the lows, buyers emerged with conviction, driving price all the way back near the open. Sellers were unable to hold the lower levels. This "rejection" of lower prices suggests a significant pocket of demand has been discovered. Traders who were short begin to cover, and new buyers enter, anticipating a reversal.`,
    bullish: {
      context: 'The Hammer is most reliable when it appears after a sustained downtrend of at least 3-5 candles and forms at or near a known support level. The longer the lower wick, the stronger the rejection of lower prices.',
      confirmation: 'A bullish candle on the following session that closes above the Hammer\'s high provides confirmation. Ideally, this confirmation candle should also close above the Hammer\'s body. Higher volume on the confirmation adds conviction.',
      failure: 'If the next candle closes below the Hammer\'s low (tip of the wick), the support failed. The downtrend is likely to continue, and long positions should be exited.'
    },
    bearish: {
      context: 'N/A — the Hammer is a bullish reversal pattern and has no bearish scenario in its canonical form. However, if a Hammer-shaped candle appears during an uptrend, it is classified as a Hanging Man (see separate entry), which IS bearish.',
      confirmation: 'N/A',
      failure: 'N/A'
    },
    tips: 'Check the trend context before trading a Hammer. A Hammer in a sideways market has no predictive value. The pattern must appear after a decline to be valid. Look for the next candle to gap above the Hammer\'s body for the strongest signal.',
    chart: [
      { bodyTop: 25, bodyBottom: 70, wickTop: 15, wickBottom: 75, color: 'bear', faded: true },
      { bodyTop: 15, bodyBottom: 65, wickTop: 5, wickBottom: 70, color: 'bear', faded: true },
      { bodyTop: 55, bodyBottom: 42, wickTop: 58, wickBottom: 88, color: 'bull', highlighted: true },
      { bodyTop: 75, bodyBottom: 30, wickTop: 80, wickBottom: 25, color: 'bull', faded: false },
      { bodyTop: 88, bodyBottom: 22, wickTop: 92, wickBottom: 18, color: 'bull', faded: false }
    ]
  },
  {
    id: 'hanging-man', name: 'Hanging Man', type: 'bearish', category: 'single', signal: 'reversal',
    reliability: 'Medium',
    summary: 'Identical in shape to the Hammer — small body at top, long lower wick — but appears after an UPTREND. Signals distribution and potential bearish reversal.',
    overview: `The Hanging Man is the bearish twin of the Hammer. It has the identical shape — a small real body at the upper end of the range with a long lower shadow — but crucially, it appears after an uptrend, not a downtrend. The name evokes the image of a man hanging from a rope; the long lower wick is the body dangling, and the small real body is the head.

This pattern is more subtle than the Hammer because it looks bullish at first glance. Price was pushed lower during the session but recovered to near the open. The trap is that the mere fact of the sharp sell-off — even if recovered — reveals that sellers are testing the waters. Distribution may be underway.`,
    psychology: `During an uptrend, the Hanging Man reveals that sellers are becoming active. While they were ultimately pushed back by the close, the fact that they managed to drive price so much lower intraday suggests the balance of power is shifting. Think of it as a warning shot — sellers tested lower prices and found willing participants. Each subsequent test is more likely to succeed. Longs who bought during the uptrend see this candle and begin to question their positions.`,
    bullish: {
      context: 'N/A — the Hanging Man is a bearish reversal pattern. Its appearance in a downtrend would simply be a Hammer.',
      confirmation: 'If the next candle closes above the Hanging Man\'s high, the pattern has failed. The uptrend continues, and the sell-off was merely a shakeout.',
      failure: 'A close above the Hanging Man\'s high negates the pattern entirely.'
    },
    bearish: {
      context: 'A Hanging Man after a sustained uptrend, especially near resistance, signals that the rally is running out of buyers. The long lower wick shows sellers testing lower levels with success.',
      confirmation: 'A bearish candle closing below the Hanging Man\'s low confirms the reversal. The next candle should ideally close below the Hanging Man\'s body. A gap down on the next open is especially bearish.',
      failure: 'See bullish failure above.'
    },
    tips: 'The Hanging Man requires more confirmation than the Hammer. Wait for at least one, preferably two, bearish candles after the Hanging Man before entering short. A red (bearish) Hanging Man body is more bearish than a green one.',
    chart: [
      { bodyTop: 80, bodyBottom: 30, wickTop: 88, wickBottom: 25, color: 'bull', faded: true },
      { bodyTop: 85, bodyBottom: 35, wickTop: 92, wickBottom: 30, color: 'bull', faded: true },
      { bodyTop: 58, bodyBottom: 45, wickTop: 60, wickBottom: 85, color: 'bear', highlighted: true },
      { bodyTop: 22, bodyBottom: 68, wickTop: 18, wickBottom: 72, color: 'bear', faded: false },
      { bodyTop: 15, bodyBottom: 78, wickTop: 10, wickBottom: 82, color: 'bear', faded: false }
    ]
  },
  {
    id: 'inverted-hammer', name: 'Inverted Hammer', type: 'bullish', category: 'single', signal: 'reversal',
    reliability: 'Medium',
    summary: 'Small real body at the bottom of the candle with a long upper wick. Appears after a downtrend. The bullish cousin of the Shooting Star.',
    overview: `The Inverted Hammer is a single-candle bullish reversal pattern found at the bottom of downtrends. It has a small real body at the lower end of the range with a long upper shadow — the inverse shape of a regular Hammer. Despite looking like a Shooting Star (which is bearish), its position at the end of a downtrend gives it a bullish interpretation.

The pattern forms when buyers attempt to push price higher during the session, succeed significantly, but are then pushed back down to near the open by the close. The key insight is that buyers showed up with enough force to create a substantial rally, even if they couldn't hold all the gains. This "test" of higher prices suggests buying interest is emerging.`,
    psychology: `The Inverted Hammer represents a failed rally that is actually bullish. Sellers have dominated during the downtrend, but for the first time, buyers mounted a serious counterattack. While sellers pushed back by the close, the fact that buyers could generate such an intraday rally suggests the selling pressure is waning. The next session becomes critical — if buyers can follow through, the reversal is confirmed.`,
    bullish: {
      context: 'Appears after a sustained downtrend. The longer the upper wick, the stronger the buying pressure was during the session. The small body at the bottom shows sellers still had the last word, but barely.',
      confirmation: 'A strong bullish candle on the next session that closes above the Inverted Hammer\'s high confirms that buyers have taken control. Volume expansion on this confirmation candle is important.',
      failure: 'If the next candle closes below the Inverted Hammer\'s low, the buying attempt failed. The downtrend is intact.'
    },
    bearish: {
      context: 'If an Inverted-Hammer-shaped candle appears after an uptrend, it is a Shooting Star (see separate entry), which is bearish.',
      confirmation: 'N/A',
      failure: 'N/A'
    },
    tips: 'The Inverted Hammer often precedes a Morning Star pattern (the second candle of the Morning Star is often an Inverted Hammer or Doji). Look for a gap up on the confirmation candle for the strongest signal.',
    chart: [
      { bodyTop: 18, bodyBottom: 65, wickTop: 12, wickBottom: 72, color: 'bear', faded: true },
      { bodyTop: 12, bodyBottom: 72, wickTop: 5, wickBottom: 78, color: 'bear', faded: true },
      { bodyTop: 58, bodyBottom: 45, wickTop: 8, wickBottom: 48, color: 'bull', highlighted: true },
      { bodyTop: 78, bodyBottom: 28, wickTop: 85, wickBottom: 22, color: 'bull', faded: false },
      { bodyTop: 88, bodyBottom: 18, wickTop: 94, wickBottom: 12, color: 'bull', faded: false }
    ]
  },
  {
    id: 'shooting-star', name: 'Shooting Star', type: 'bearish', category: 'single', signal: 'reversal',
    reliability: 'High',
    summary: 'Small body at the bottom with a long upper wick. Appears after an uptrend. Signals that buyers are exhausted and a bearish reversal is likely.',
    overview: `The Shooting Star is one of the most reliable bearish reversal patterns. It is visually a small real body at the lower end of the range with a very long upper shadow — resembling a falling star. The upper wick should be at least twice the length of the body, and there should be little to no lower wick. The color of the body can be red or green, but a red body is more bearish.

The pattern forms when price gaps up or rallies during the session, reaching new highs, but then sellers emerge and drive price back down to near the open by the close. The rally failed. Buyers who chased the breakout are trapped at the top of the wick.`,
    psychology: `The Shooting Star captures a classic bull trap. Early in the session, everything looks great — price is surging, the uptrend is continuing. Late buyers pile in. But then the tide turns. Sellers, who have been waiting for higher prices, unload their positions. The selling feeds on itself as the rally reverses. By the close, all the gains are gone. Every buyer who participated above the open is now at a loss and will look to sell on any subsequent bounce.`,
    bullish: {
      context: 'N/A — the Shooting Star is a bearish reversal pattern.',
      confirmation: 'If the next candle closes above the Shooting Star\'s high (the top of the upper wick), the pattern has failed. This would suggest the rally is still intact.',
      failure: 'A close above the Shooting Star\'s high negates the bearish signal.'
    },
    bearish: {
      context: 'A Shooting Star at the top of an uptrend, especially at a resistance level, signals exhaustion. Buyers tried to extend the rally but were completely rejected. Sellers are now in control.',
      confirmation: 'A bearish candle on the next session closing below the Shooting Star\'s low. A gap down on the open is especially powerful confirmation. Look for above-average volume.',
      failure: 'If price fails to make a lower low on the following session, the Shooting Star may have been a false alarm. Wait for a close below the body before acting.'
    },
    tips: 'The Shooting Star is more reliable on higher timeframes (H4, D1). On lower timeframes it can produce false signals. Combine with bearish divergence on RSI or MACD for higher probability.',
    chart: [
      { bodyTop: 78, bodyBottom: 28, wickTop: 85, wickBottom: 22, color: 'bull', faded: true },
      { bodyTop: 85, bodyBottom: 35, wickTop: 92, wickBottom: 30, color: 'bull', faded: true },
      { bodyTop: 62, bodyBottom: 48, wickTop: 6, wickBottom: 50, color: 'bear', highlighted: true },
      { bodyTop: 22, bodyBottom: 68, wickTop: 15, wickBottom: 72, color: 'bear', faded: false },
      { bodyTop: 15, bodyBottom: 78, wickTop: 8, wickBottom: 82, color: 'bear', faded: false }
    ]
  },
  {
    id: 'marubozu', name: 'Marubozu', type: 'both', category: 'single', signal: 'continuation',
    reliability: 'High',
    summary: 'A candle with a long real body and virtually no wicks. Represents absolute dominance by one side — bullish Marubozu (green) or bearish Marubozu (red).',
    overview: `Marubozu means "shaved head" or "bald" in Japanese, referring to the absence of wicks. A Bullish Marubozu opens at its low and closes at its high — a long green candle with no shadows. A Bearish Marubozu opens at its high and closes at its low — a long red candle with no shadows. These are the purest expressions of one-sided market conviction.

A Marubozu shows that from the open to the close, one side was in complete control. There were no counterattacks — no wicks to suggest the other side even tried to fight. These candles often appear at the start of a strong trend move or as confirmation that a trend is accelerating.`,
    psychology: `The Marubozu reflects total conviction. In a bullish Marubozu, buyers controlled every minute of the session. Sellers were either absent or completely overwhelmed. This often happens after a major news event or breakout where the direction is unambiguous. The absence of any lower wick means price never traded below the open — buyers were aggressive from the first tick. Similarly, a bearish Marubozu means sellers dominated from start to finish.`,
    bullish: {
      context: 'A Bullish Marubozu at the start of an uptrend or after a consolidation breakout signals strong momentum. It can also appear as the third candle of a Three White Soldiers pattern.',
      confirmation: 'The Marubozu is itself a confirmation candle. Look for the next candle to also close higher, ideally above the Marubozu\'s high.',
      failure: 'A close below the midpoint of the Marubozu on the following session suggests the momentum was false. If the next candle is bearish and closes below the Marubozu\'s open, consider exiting.'
    },
    bearish: {
      context: 'A Bearish Marubozu at the start of a downtrend or after a breakdown below support signals strong selling pressure. It can appear as part of Three Black Crows.',
      confirmation: 'The Marubozu is itself confirmation. The next candle should close lower, ideally below the Marubozu\'s low.',
      failure: 'A close above the midpoint of the bearish Marubozu suggests buying pressure is emerging. A close above the Marubozu\'s open negates the bearish signal.'
    },
    tips: 'Marubozu candles often signal the start of a trend leg. They can be used to trail stops — place a stop below the low of a bullish Marubozu (or above the high of a bearish one) and move it to each new Marubozu as the trend progresses.',
    chart: [
      { bodyTop: 30, bodyBottom: 70, wickTop: 25, wickBottom: 75, color: 'bear', faded: true },
      { bodyTop: 78, bodyBottom: 22, wickTop: 80, wickBottom: 20, color: 'bull', highlighted: true },
      { bodyTop: 88, bodyBottom: 18, wickTop: 90, wickBottom: 16, color: 'bull', faded: false },
      { bodyTop: 15, bodyBottom: 85, wickTop: 12, wickBottom: 88, color: 'bear', highlighted: true },
      { bodyTop: 12, bodyBottom: 88, wickTop: 8, wickBottom: 92, color: 'bear', faded: false }
    ]
  },
  {
    id: 'spinning-top', name: 'Spinning Top', type: 'neutral', category: 'single', signal: 'indecision',
    reliability: 'Low',
    summary: 'A small real body with upper and lower wicks of similar length. Represents indecision — neither buyers nor sellers could gain the upper hand.',
    overview: `The Spinning Top is a neutral candle characterized by a small real body and upper and lower shadows that are both longer than the body. The small body shows that the open and close were close together, while the long wicks show that price traveled significant distance in both directions during the session before returning to near the open.

A Spinning Top in isolation means very little. Its significance comes from where it appears. In a strong trend, a Spinning Top is an early warning of potential reversal — the trend is losing momentum. In a range, it simply confirms the indecision that already exists.`,
    psychology: `Both buyers and sellers were active during the session, each pushing price in their direction, but neither could sustain control. The result was a draw. The Spinning Top is the market saying "I don't know which way to go." When this appears after a strong move, it means the dominant side is no longer dominant — the other side is pushing back with equal force.`,
    bullish: {
      context: 'A Spinning Top after a downtrend suggests selling pressure is being met with buying pressure. The trend may be losing steam, but confirmation is required.',
      confirmation: 'A bullish candle closing above the Spinning Top\'s high on the next session suggests buyers are gaining control.',
      failure: 'If followed by continued bearish candles, the Spinning Top was merely a pause in the downtrend.'
    },
    bearish: {
      context: 'A Spinning Top after an uptrend suggests buying pressure is being absorbed by sellers. The uptrend may be stalling.',
      confirmation: 'A bearish candle closing below the Spinning Top\'s low on the next session confirms that sellers have taken control.',
      failure: 'Continued higher closes after a Spinning Top mean the uptrend is intact and the Spinning Top was just a rest.'
    },
    tips: 'Never trade a Spinning Top alone. It must be used in conjunction with the preceding trend and confirmed by the following candle. When a Spinning Top is followed by a strong candle in the opposite direction of the trend, it can mark significant turning points.',
    chart: [
      { bodyTop: 20, bodyBottom: 65, wickTop: 12, wickBottom: 72, color: 'bear', faded: true },
      { bodyTop: 42, bodyBottom: 52, wickTop: 12, wickBottom: 82, color: 'neutral', highlighted: true },
      { bodyTop: 78, bodyBottom: 25, wickTop: 85, wickBottom: 18, color: 'bull', faded: false }
    ]
  },

  // ═══ TWO-CANDLE ═══
  {
    id: 'engulfing', name: 'Engulfing', type: 'both', category: 'double', signal: 'reversal',
    reliability: 'Very High',
    summary: 'A candle whose body completely engulfs the previous candle\'s body. Bullish: green engulfs red. Bearish: red engulfs green. One of the most powerful reversal signals.',
    overview: `The Engulfing pattern is a two-candle reversal formation and one of the most important patterns in candlestick analysis. It consists of two candles: a smaller-bodied candle in the direction of the current trend, followed by a larger-bodied candle in the opposite direction that completely "engulfs" the body of the first candle. The second candle's body must fully cover the first candle's body — wicks may or may not be engulfed.

A Bullish Engulfing pattern forms during a downtrend: the first candle is bearish (red) and the second is a large bullish (green) candle whose body completely covers the first candle's body. A Bearish Engulfing pattern is the mirror: appearing in an uptrend, with a small green candle fully engulfed by a large red candle.`,
    psychology: `The Engulfing pattern captures a decisive shift in market control. In a Bullish Engulfing: sellers were in control (candle 1), then buyers entered with such force that they not only reversed the session but consumed all of the previous session's price action. The second candle opening below the first candle's close and closing above its open shows that buyers overwhelmed sellers at every level. The larger the engulfing candle relative to the engulfed candle, the more significant the shift.`,
    bullish: {
      context: 'Appears at the bottom of a downtrend. The second candle should open below the first candle\'s close (continuation of weakness) and then reverse dramatically to close above the first candle\'s open. The larger the engulfing body, the stronger the signal.',
      confirmation: 'The Bullish Engulfing is a strong standalone signal. Additional confirmation comes from the next candle closing higher and volume expanding on the engulfing candle.',
      failure: 'If price closes back below the midpoint of the engulfing candle\'s body, the reversal may be failing. A close below the engulfing candle\'s low invalidates the pattern.'
    },
    bearish: {
      context: 'Appears at the top of an uptrend. The second candle opens above the first candle\'s close and then reverses to close below the first candle\'s open. The engulfing candle should have significant range.',
      confirmation: 'A close below the engulfing candle\'s low on the following session confirms. Volume should spike on the bearish engulfing candle — this shows conviction from sellers.',
      failure: 'A close above the midpoint of the engulfing candle\'s body suggests the pattern may fail. A close above the engulfing candle\'s high invalidates it.'
    },
    tips: 'The Engulfing pattern gains reliability when the engulfing candle also breaks a trendline or key support/resistance level. Look for it to appear at the end of a trend, not in a consolidation range.',
    chart: [
      { bodyTop: 18, bodyBottom: 55, wickTop: 12, wickBottom: 60, color: 'bear', faded: true },
      { bodyTop: 50, bodyBottom: 15, wickTop: 52, wickBottom: 12, color: 'bear', faded: true },
      { bodyTop: 70, bodyBottom: 10, wickTop: 75, wickBottom: 5, color: 'bull', highlighted: true },
      { bodyTop: 80, bodyBottom: 25, wickTop: 85, wickBottom: 20, color: 'bull', faded: false }
    ]
  },
  {
    id: 'harami', name: 'Harami', type: 'both', category: 'double', signal: 'reversal',
    reliability: 'Medium',
    summary: '"Pregnant" in Japanese — a small candle completely contained within the body of the previous large candle. Indicates the trend is losing momentum.',
    overview: `The Harami ("pregnant" in Japanese) is a two-candle reversal pattern. It consists of a large-bodied candle in the direction of the trend, followed by a small-bodied candle whose entire body (and ideally wicks) fits within the body of the first candle. The color of the second candle is the opposite of the first in its most powerful form, but same-colored Haramis also occur.

The Harami is essentially the opposite of the Engulfing. Where the Engulfing shows a sudden, violent reversal, the Harami shows a gradual loss of momentum. The first candle continues the trend with conviction. But the second candle, with its tiny range contained entirely within the prior candle's body, shows that conviction has evaporated.`,
    psychology: `The first candle shows the trend was strong — a big move with wide range. But on the next session, nothing happened. The market opened, traded in a tiny range, and closed well within the first candle's body. The dominant side had no follow-through. This failure to continue is what gives the Harami its predictive power. The Harami says: "Yesterday everyone was convinced; today, no one is sure."`,
    bullish: {
      context: 'A Bullish Harami appears during a downtrend: a long red candle followed by a small green (or red) candle contained within its body. The small candle shows selling pressure has dried up.',
      confirmation: 'A bullish candle closing above the high of the first (large) candle confirms the reversal. Volume should contract on the Harami candle and expand on the confirmation.',
      failure: 'A close below the low of the first candle\'s body suggests the downtrend is resuming. Exit long positions.'
    },
    bearish: {
      context: 'A Bearish Harami appears during an uptrend: a long green candle followed by a small red (or green) candle contained within its body. The small candle shows buying pressure has evaporated.',
      confirmation: 'A bearish candle closing below the low of the first candle confirms the reversal. Ideally with above-average volume.',
      failure: 'A close above the high of the first candle suggests the uptrend is intact and the Harami failed.'
    },
    tips: 'The Harami Cross — where the second candle is a Doji — is a stronger variant of the Harami. It indicates even more complete indecision. Harami patterns on higher timeframes (D1, W1) are more reliable than on lower timeframes.',
    chart: [
      { bodyTop: 25, bodyBottom: 75, wickTop: 20, wickBottom: 80, color: 'bear', faded: true },
      { bodyTop: 38, bodyBottom: 55, wickTop: 35, wickBottom: 60, color: 'bull', highlighted: true },
      { bodyTop: 55, bodyBottom: 38, wickTop: 58, wickBottom: 35, color: 'bull', faded: false },
      { bodyTop: 82, bodyBottom: 22, wickTop: 85, wickBottom: 18, color: 'bull', faded: false }
    ]
  },
  {
    id: 'piercing-line', name: 'Piercing Line', type: 'bullish', category: 'double', signal: 'reversal',
    reliability: 'High',
    summary: 'Two-candle bullish reversal: a long bearish candle followed by a bullish candle that opens below the previous low and closes above the 50% midpoint of the previous body.',
    overview: `The Piercing Line (or Piercing Pattern) is a bullish reversal pattern consisting of two candles. The first candle is a long bearish candle continuing the downtrend. The second candle is a bullish candle that opens below the low of the first candle (a gap down) but then reverses and closes above the midpoint (50%) of the first candle's body. The deeper the close into the first candle's body, the stronger the signal — ideally the close should be above 50%, and a close above 62-67% is even more powerful.

This pattern is essentially a "failed breakdown." The gap down suggests the downtrend is accelerating, but buyers step in and not only absorb the selling but push price back up through significant resistance.`,
    psychology: `The open below the prior low creates panic — it looks like the downtrend is accelerating. Sellers pile in. But then something changes. Buyers emerge aggressively, pushing price higher and higher. By the close, they've recovered more than half of the previous session's decline. Sellers who shorted the gap down are now underwater and become forced buyers (covering), adding fuel to the reversal. The failure to hold below the prior low is psychologically devastating for bears.`,
    bullish: {
      context: 'Appears in a downtrend. The first candle should be a strong bearish candle. The second must open below the first candle\'s low and close above the 50% retracement of the first candle\'s body. The deeper the close, the more powerful the reversal.',
      confirmation: 'A third bullish candle closing above the second candle\'s high confirms the reversal. Look for volume expansion on the second (piercing) candle.',
      failure: 'If price closes back below the low of the second (piercing) candle, the pattern has failed. The downtrend is resuming.'
    },
    bearish: {
      context: 'N/A — the Piercing Line is exclusively a bullish reversal pattern. Its bearish counterpart is the Dark Cloud Cover.',
      confirmation: 'N/A',
      failure: 'N/A'
    },
    tips: 'The Piercing Line is considered one of the most reliable bullish reversal patterns, second only to the Bullish Engulfing. Combine with oversold readings on RSI or Stochastic for higher probability. The pattern is especially powerful at support levels.',
    chart: [
      { bodyTop: 15, bodyBottom: 70, wickTop: 10, wickBottom: 75, color: 'bear', faded: true },
      { bodyTop: 72, bodyBottom: 18, wickTop: 78, wickBottom: 15, color: 'bear', faded: true },
      { bodyTop: 60, bodyBottom: 10, wickTop: 62, wickBottom: 82, color: 'bull', highlighted: true },
      { bodyTop: 80, bodyBottom: 25, wickTop: 85, wickBottom: 20, color: 'bull', faded: false }
    ]
  },
  {
    id: 'dark-cloud-cover', name: 'Dark Cloud Cover', type: 'bearish', category: 'double', signal: 'reversal',
    reliability: 'High',
    summary: 'Two-candle bearish reversal: a long bullish candle followed by a bearish candle that opens above the previous high and closes below the 50% midpoint of the previous body.',
    overview: `Dark Cloud Cover is the bearish counterpart to the Piercing Line. It is a two-candle bearish reversal pattern. The first candle is a long bullish candle continuing the uptrend with conviction. The second candle opens above the high of the first candle (a gap up) but then reverses sharply and closes deep into the first candle's body — ideally below the 50% midpoint.

The pattern's name evokes the image of a dark cloud suddenly covering the sun. The gap up at the open looks like the rally is accelerating, but by the close, the picture is entirely different — a dark bearish candle has consumed more than half of the prior day's gains.`,
    psychology: `The gap up above the prior high triggers excitement and FOMO — the uptrend appears to be accelerating. Late buyers pile in. But then the sellers show up in force. The intraday reversal is swift and brutal. By the close, the market is deep in the red relative to the open. Every buyer who participated above the open is losing money. These trapped longs will look to sell on any bounce. The psychological damage to bullish sentiment is severe — the "clear skies" of the uptrend have been replaced by a "dark cloud."`,
    bullish: {
      context: 'N/A — Dark Cloud Cover is exclusively a bearish reversal pattern. Its bullish counterpart is the Piercing Line.',
      confirmation: 'If the next candle closes above the high of the second (dark cloud) candle, the bearish signal has failed and the uptrend resumes.',
      failure: 'A close above the second candle\'s high negates the pattern.'
    },
    bearish: {
      context: 'Appears at the top of an uptrend. The first candle is a strong bullish continuation. The second opens above the first candle\'s high (gap up) and closes below the 50% retracement of the first candle\'s body. The deeper the close into the body, the stronger the signal — a close below the first candle\'s open is especially bearish.',
      confirmation: 'A third bearish candle closing below the second candle\'s low confirms the reversal. Volume should expand on the dark cloud candle itself.',
      failure: 'A close back above the second candle\'s midpoint suggests the pattern may fail. A close above its high invalidates it completely.'
    },
    tips: 'Dark Cloud Cover is more reliable when it occurs at resistance or after a parabolic rally. Look for bearish divergence on oscillators. The pattern is best traded on daily and higher timeframes.',
    chart: [
      { bodyTop: 75, bodyBottom: 20, wickTop: 80, wickBottom: 15, color: 'bull', faded: true },
      { bodyTop: 85, bodyBottom: 25, wickTop: 90, wickBottom: 20, color: 'bull', faded: true },
      { bodyTop: 18, bodyBottom: 62, wickTop: 15, wickBottom: 68, color: 'bear', highlighted: true },
      { bodyTop: 12, bodyBottom: 72, wickTop: 8, wickBottom: 78, color: 'bear', faded: false }
    ]
  },
  {
    id: 'bullish-kicker', name: 'Bullish Kicker', type: 'bullish', category: 'double', signal: 'reversal',
    reliability: 'Very High',
    summary: 'A dramatic two-candle reversal: a bearish candle followed by a bullish candle that gaps above the previous open. Represents a sudden, violent shift in sentiment.',
    overview: `The Bullish Kicker is the most powerful and dramatic of all bullish reversal patterns. It consists of two candles: the first is a bearish candle (ideally a Marubozu), and the second is a bullish candle that opens at or above the previous candle's open (a significant gap up) and never trades below it. There is no overlap between the bodies of the two candles — the second candle "kicks" away from the first.

This pattern represents a complete and sudden reversal of market sentiment. Something fundamental has changed between the close of the first candle and the open of the second — perhaps a news event, an earnings report, or a shift in macroeconomic conditions.`,
    psychology: `Between sessions, a dramatic change in perception has occurred. The first session closed with sellers in full control — perhaps a bearish Marubozu. But by the next open, the entire narrative has flipped. Buyers open price far above the prior day's trading range and never look back. Sellers who were confident the day before are now trapped in losing positions. The gap up is so significant that it represents a "gap and go" — no opportunity for sellers to exit at reasonable levels. This forced capitulation from shorts fuels further upside.`,
    bullish: {
      context: 'Appears at the end of a downtrend or after a prolonged decline. The first candle is bearish. The second opens with a gap up above the first candle\'s open (not just its close — above its OPEN) and closes higher.',
      confirmation: 'The Kicker itself is a strong signal. Confirmation comes from the next candle holding above the gap. The gap should not be filled — if price retraces to fill the gap, the pattern is weaker.',
      failure: 'If price fills the gap (trades back below the second candle\'s open), the pattern has failed. Exit immediately.'
    },
    bearish: {
      context: 'N/A — the Bullish Kicker is exclusively a bullish reversal pattern.',
      confirmation: 'N/A',
      failure: 'N/A'
    },
    tips: 'The Bullish Kicker often follows major news events. The gap should remain unfilled for the pattern to be valid. The larger the gap and the larger the second candle, the stronger the signal. This is one of the few patterns where you can enter on the second candle without waiting for third-candle confirmation.',
    chart: [
      { bodyTop: 15, bodyBottom: 72, wickTop: 12, wickBottom: 78, color: 'bear', faded: true },
      { bodyTop: 72, bodyBottom: 15, wickTop: 75, wickBottom: 12, color: 'bear', faded: true },
      { bodyTop: 78, bodyBottom: 8, wickTop: 82, wickBottom: 5, color: 'bull', highlighted: true },
      { bodyTop: 88, bodyBottom: 15, wickTop: 92, wickBottom: 10, color: 'bull', faded: false }
    ]
  },
  {
    id: 'bearish-kicker', name: 'Bearish Kicker', type: 'bearish', category: 'double', signal: 'reversal',
    reliability: 'Very High',
    summary: 'A dramatic two-candle reversal: a bullish candle followed by a bearish candle that gaps below the previous open. Represents a sudden, violent collapse of bullish sentiment.',
    overview: `The Bearish Kicker is the most powerful bearish reversal pattern. It consists of a bullish candle (ideally a Marubozu) followed by a bearish candle that opens at or below the previous candle's open (a significant gap down) and trades lower all session. The bodies have no overlap — the second candle completely "kicks" away from the first.

Like its bullish counterpart, this pattern signals a fundamental shift. Something catastrophic has changed between sessions — an earnings miss, a geopolitical event, a regulatory change. The market has completely repriced the asset overnight.`,
    psychology: `At the close of the first session, buyers were celebrating — perhaps a strong green Marubozu. Overnight, disaster strikes. By the next open, sellers have seized control with a massive gap down. Buyers who held positions overnight are trapped. Every attempt to rally during the session is met with fresh selling. The gap is so large that buyers can't hope to exit at yesterday's prices. This trapped-long liquidation feeds the decline, creating a cascade of selling.`,
    bullish: {
      context: 'N/A — the Bearish Kicker is exclusively a bearish reversal pattern.',
      confirmation: 'N/A',
      failure: 'N/A'
    },
    bearish: {
      context: 'Appears at the top of an uptrend. The first candle is a strong bullish candle. The second opens with a significant gap down below the first candle\'s open and continues lower.',
      confirmation: 'The Kicker itself is a powerful signal. The gap should remain unfilled — any fill of the gap weakens the pattern significantly.',
      failure: 'If price rallies to fill the gap (trades above the second candle\'s open), the pattern has failed. Cover shorts immediately.'
    },
    tips: 'The Bearish Kicker is most powerful when the first candle is a green Marubozu — this means bulls were in absolute control, making the reversal even more shocking. The pattern often marks major market tops.',
    chart: [
      { bodyTop: 82, bodyBottom: 15, wickTop: 85, wickBottom: 12, color: 'bull', faded: true },
      { bodyTop: 88, bodyBottom: 18, wickTop: 92, wickBottom: 15, color: 'bull', faded: true },
      { bodyTop: 15, bodyBottom: 82, wickTop: 12, wickBottom: 88, color: 'bear', highlighted: true },
      { bodyTop: 10, bodyBottom: 88, wickTop: 8, wickBottom: 92, color: 'bear', faded: false }
    ]
  },
  {
    id: 'tweezer-tops', name: 'Tweezer Tops', type: 'bearish', category: 'double', signal: 'reversal',
    reliability: 'Medium',
    summary: 'Two candles with identical or near-identical highs. Appears at the top of an uptrend and signals resistance — buyers cannot push price higher.',
    overview: `Tweezer Tops form when two consecutive candles have matching or nearly matching highs. The first candle is typically bullish (continuing the uptrend), and the second candle touches the same high but fails to exceed it and often closes lower. The bodies may be of any color, but a bearish second candle is stronger. The matching highs create a visible resistance level — the market tried twice to break above and failed both times.

The name comes from the visual resemblance to a pair of tweezers, with the two wicks or bodies aligned at the top like the prongs of the tool. This is not a standalone pattern but rather a confirming pattern that strengthens other signals.`,
    psychology: `The first candle reaches a high that represents the extreme of buying pressure. The second candle attempts to push beyond that high but fails. This "double test" of resistance without a breakout signals that buyers have exhausted their power. Sellers are actively defending that level. The failure of the second attempt often triggers stop-losses from breakout traders and profit-taking from longs, accelerating the reversal.`,
    bullish: {
      context: 'N/A — Tweezer Tops are a bearish pattern. If the matching highs are broken on the next candle, the pattern is invalidated.',
      confirmation: 'If price breaks above the tweezer level on the next candle, this is actually a bullish breakout. The resistance has been overcome.',
      failure: 'A close above the tweezer highs invalidates the bearish signal.'
    },
    bearish: {
      context: 'Appears at the top of an uptrend. Two candles with identical highs, the second ideally closing lower or forming a bearish pattern (Shooting Star, Bearish Engulfing, Dark Cloud Cover).',
      confirmation: 'A bearish candle closing below the low of the Tweezer formation confirms. The tweezer high now becomes a clear resistance level for stop placement.',
      failure: 'A close above the tweezer highs negates the pattern. Buyers have broken through resistance.'
    },
    tips: 'Tweezer Tops work best when combined with another bearish candlestick pattern. For example, a Tweezer Top where the second candle is a Shooting Star or a Bearish Engulfing candle is significantly more reliable than tweezer tops alone.',
    chart: [
      { bodyTop: 75, bodyBottom: 30, wickTop: 82, wickBottom: 25, color: 'bull', faded: true },
      { bodyTop: 78, bodyBottom: 35, wickTop: 90, wickBottom: 30, color: 'bull', faded: true },
      { bodyTop: 35, bodyBottom: 78, wickTop: 32, wickBottom: 90, color: 'bear', highlighted: true },
      { bodyTop: 25, bodyBottom: 75, wickTop: 20, wickBottom: 80, color: 'bear', faded: false }
    ]
  },
  {
    id: 'tweezer-bottoms', name: 'Tweezer Bottoms', type: 'bullish', category: 'double', signal: 'reversal',
    reliability: 'Medium',
    summary: 'Two candles with identical or near-identical lows. Appears at the bottom of a downtrend and signals support — sellers cannot push price lower.',
    overview: `Tweezer Bottoms are the bullish counterpart to Tweezer Tops. They form when two consecutive candles have matching or nearly matching lows at the bottom of a downtrend. The first candle is typically bearish, and the second touches the same low but cannot break below it and often closes higher. The matching lows establish a support level where selling pressure is absorbed.

Like Tweezer Tops, this pattern is strongest when combined with another bullish signal. If the second candle of a Tweezer Bottom is a Hammer, Bullish Engulfing, or Piercing Line, the probability of a reversal increases significantly.`,
    psychology: `Sellers test a level twice and fail to break through. The first candle established a low that represented maximum selling pressure. The second candle retests that same level, but buyers step in at exactly the same price and push back. Sellers lose confidence — if they couldn't break through on two attempts, they likely can't break through at all. Short-sellers begin to cover, and new buyers enter at a clearly defined support level.`,
    bullish: {
      context: 'Appears at the bottom of a downtrend. Two candles with identical lows, the second ideally closing higher or forming a bullish pattern (Hammer, Bullish Engulfing, Piercing Line).',
      confirmation: 'A bullish candle closing above the high of the Tweezer formation confirms the reversal. The tweezer low becomes a support level for stop placement.',
      failure: 'A close below the tweezer lows invalidates the pattern. Support has broken and the downtrend resumes.'
    },
    bearish: {
      context: 'N/A — Tweezer Bottoms are a bullish pattern. If the matching lows are broken, it is a bearish continuation.',
      confirmation: 'N/A',
      failure: 'A close below the tweezer lows means support failed and the downtrend is accelerating.'
    },
    tips: 'Tweezer Bottoms combined with a Hammer or Bullish Engulfing on the second candle are high-probability setups. The tweezer low provides a natural stop-loss level — place stops just below the matching lows.',
    chart: [
      { bodyTop: 15, bodyBottom: 72, wickTop: 12, wickBottom: 82, color: 'bear', faded: true },
      { bodyTop: 12, bodyBottom: 68, wickTop: 8, wickBottom: 82, color: 'bear', highlighted: true },
      { bodyTop: 75, bodyBottom: 25, wickTop: 80, wickBottom: 20, color: 'bull', faded: false },
      { bodyTop: 82, bodyBottom: 20, wickTop: 88, wickBottom: 15, color: 'bull', faded: false }
    ]
  },

  // ═══ THREE-CANDLE ═══
  {
    id: 'morning-star', name: 'Morning Star', type: 'bullish', category: 'triple', signal: 'reversal',
    reliability: 'High',
    summary: 'Three-candle bullish reversal: long bearish, small-bodied gap-down doji/star, long bullish gap-up. The classic bottom reversal pattern.',
    overview: `The Morning Star is a three-candle bullish reversal pattern that appears at the bottom of a downtrend. It is one of the most visually distinctive and reliable reversal patterns. The three candles are: (1) a long bearish candle continuing the downtrend, (2) a small-bodied candle (Doji or Spinning Top) that gaps below the first candle's close — this is the "star," and (3) a long bullish candle that gaps above the star's body and closes deep into the first candle's body.

The name comes from the pattern appearing like the morning star (the planet Venus) at dawn — signaling that the darkness (downtrend) is ending and light (uptrend) is coming. The star candle represents the transition point — the moment when selling pressure exhausts and buying pressure begins to build.`,
    psychology: `Candle 1: Sellers are in full control, driving price to new lows. The trend looks unstoppable. Candle 2: A gap down at the open looks like more of the same, but something changes — the selling stops. The session trades in a narrow range and closes near the open. Sellers who were dominant the day before are suddenly absent. The narrow range says uncertainty has replaced conviction. Candle 3: Buyers explode into action. A gap up above the star's body, followed by a strong close deep into the first candle's territory. The reversal is decisive.`,
    bullish: {
      context: 'The Morning Star forms at the bottom of a sustained downtrend. The star candle (2nd) should ideally gap below the first candle, and the third candle should gap above the star. The deeper the third candle closes into the first candle\'s body (ideally >50%), the stronger the signal.',
      confirmation: 'The third candle IS the confirmation. However, waiting for a fourth bullish candle to close above the third candle\'s high provides additional safety.',
      failure: 'If price closes back below the star\'s low, the reversal has failed. The downtrend is resuming.'
    },
    bearish: {
      context: 'N/A — the Morning Star is exclusively bullish.',
      confirmation: 'N/A',
      failure: 'N/A'
    },
    tips: 'The ideal star candle is a Doji with a gap on both sides — this is called a Morning Doji Star and is the strongest variant. Volume should contract on the star candle (showing selling exhaustion) and expand dramatically on the third candle (showing buying conviction).',
    chart: [
      { bodyTop: 10, bodyBottom: 60, wickTop: 5, wickBottom: 65, color: 'bear', faded: true },
      { bodyTop: 40, bodyBottom: 52, wickTop: 22, wickBottom: 72, color: 'doji', highlighted: true },
      { bodyTop: 72, bodyBottom: 15, wickTop: 78, wickBottom: 10, color: 'bull', faded: false }
    ]
  },
  {
    id: 'evening-star', name: 'Evening Star', type: 'bearish', category: 'triple', signal: 'reversal',
    reliability: 'High',
    summary: 'Three-candle bearish reversal: long bullish, small-bodied gap-up doji/star, long bearish gap-down. The classic top reversal pattern.',
    overview: `The Evening Star is the bearish counterpart to the Morning Star. It appears at the top of an uptrend and signals that the rally is over. The three candles are: (1) a long bullish candle continuing the uptrend, (2) a small-bodied candle (Doji or Spinning Top) that gaps above the first candle's close — the "star," and (3) a long bearish candle that gaps below the star and closes deep into the first candle's body.

Like the Morning Star, the Evening Star draws its name from celestial metaphor. Venus appears as both the morning and evening star. The evening star signals that daylight (the uptrend) is ending and darkness (the downtrend) is approaching.`,
    psychology: `Candle 1: Buyers are celebrating — a strong green candle pushes the uptrend higher. Candle 2: Price gaps up at the open, but then… nothing. No follow-through. The session trades narrowly and closes near the open. This is the first sign of trouble. Candle 3: The trap is sprung. Price gaps down below the star, and sellers hammer it lower all session, closing deep into the first candle's body. Buyers from candles 1 and 2 are trapped in losing positions. The reversal is violent and complete.`,
    bullish: {
      context: 'N/A — the Evening Star is exclusively bearish.',
      confirmation: 'If price closes above the star\'s high, the bearish signal has failed and the uptrend resumes.',
      failure: 'A close above the star\'s high negates the pattern.'
    },
    bearish: {
      context: 'Forms at the top of an uptrend. The star candle should gap above the first candle\'s close, and the third candle should gap below the star\'s body and close deeply into the first candle.',
      confirmation: 'The bearish third candle is itself confirmation. Waiting for a fourth bearish candle below the third provides additional certainty.',
      failure: 'A close above the star\'s high invalidates the pattern. The uptrend continues.'
    },
    tips: 'The Evening Doji Star — where the star is a Doji — is the strongest variant. Volume should contract on the star and expand on the third candle. This pattern is one of the most reliable top-signaling patterns in all of technical analysis.',
    chart: [
      { bodyTop: 82, bodyBottom: 18, wickTop: 88, wickBottom: 12, color: 'bull', faded: true },
      { bodyTop: 42, bodyBottom: 55, wickTop: 18, wickBottom: 68, color: 'doji', highlighted: true },
      { bodyTop: 10, bodyBottom: 72, wickTop: 5, wickBottom: 80, color: 'bear', faded: false }
    ]
  },
  {
    id: 'three-white-soldiers', name: 'Three White Soldiers', type: 'bullish', category: 'triple', signal: 'continuation',
    reliability: 'Very High',
    summary: 'Three consecutive long green candles, each opening within the previous body and closing near its high. Strong bullish continuation or reversal pattern.',
    overview: `Three White Soldiers (also called Three Advancing White Soldiers) is a powerful three-candle bullish pattern. Each candle is a long green candle that opens within the previous candle's body and closes at or near its high. Each successive close is higher than the previous, and each candle has a progressively higher open. The pattern appears either as a reversal after a downtrend or as a continuation within an uptrend.

This pattern represents sustained, methodical buying pressure — not a sudden spike, but a steady, relentless advance. Each day, buyers take control from the open and drive price to new highs. There is no hesitation, no retracement, no counterattack from sellers.`,
    psychology: `Three White Soldiers tells a story of growing confidence. The first soldier shows initial buying interest. The second shows that buying continued — no profit-taking reversed the move. By the third soldier, even the most skeptical traders recognize that momentum has shifted. Short-sellers who were fighting the move capitulate and cover. Late buyers who waited for confirmation enter. The three-candle sequence creates a self-reinforcing cycle of bullish psychology.`,
    bullish: {
      context: 'Appears after a downtrend (reversal) or during an uptrend (continuation). Each candle should be a long green body, opening within the prior body and closing near the session high. Shadows should be small — excessive wicks weaken the pattern.',
      confirmation: 'The third soldier is itself confirmation. A fourth green candle adds conviction. Volume should increase progressively across all three candles.',
      failure: 'A close below the midpoint of the third soldier\'s body suggests the momentum is failing. A close below the first soldier\'s low invalidates the pattern.'
    },
    bearish: {
      context: 'N/A — Three White Soldiers is exclusively bullish.',
      confirmation: 'N/A',
      failure: 'N/A'
    },
    tips: 'The ideal Three White Soldiers pattern has progressively smaller upper wicks and progressively larger bodies. Avoid trading this pattern when it appears at the top of an extended uptrend — it may represent a buying climax rather than continuation.',
    chart: [
      { bodyTop: 25, bodyBottom: 65, wickTop: 22, wickBottom: 68, color: 'bear', faded: true },
      { bodyTop: 62, bodyBottom: 15, wickTop: 65, wickBottom: 12, color: 'bull', highlighted: true },
      { bodyTop: 80, bodyBottom: 25, wickTop: 85, wickBottom: 20, color: 'bull', highlighted: true },
      { bodyTop: 90, bodyBottom: 12, wickTop: 94, wickBottom: 8, color: 'bull', highlighted: true }
    ]
  },
  {
    id: 'three-black-crows', name: 'Three Black Crows', type: 'bearish', category: 'triple', signal: 'continuation',
    reliability: 'Very High',
    summary: 'Three consecutive long red candles, each opening within the previous body and closing near its low. Strong bearish continuation or reversal pattern.',
    overview: `Three Black Crows is the bearish equivalent of Three White Soldiers. It consists of three consecutive long red candles, each opening within the previous candle's body and closing at or near its session low, with each close lower than the previous. The pattern signals a powerful bearish reversal at the top of an uptrend or continuation within a downtrend.

This is one of the most visually intimidating patterns — three consecutive sessions where sellers are in absolute control from open to close. There is no bounce, no relief rally, no counterattack. The selling is sustained and methodical.`,
    psychology: `The first crow signals that buyers are losing control — the uptrend is stalling and sellers are pushing back. The second crow confirms that the first was not a fluke — selling is accelerating. By the third crow, panic begins to set in. Buyers who held through the first two declines start bailing out. The steady, relentless nature of the decline creates a sense that there is no floor — each day brings lower prices. Late sellers capitulate, and short-sellers gain confidence.`,
    bullish: {
      context: 'N/A — Three Black Crows is exclusively bearish.',
      confirmation: 'If a strong bullish candle closes above the first crow\'s high, the pattern has been reversed. This is rare but possible at major support levels.',
      failure: 'A close above the first crow\'s high invalidates the bearish signal.'
    },
    bearish: {
      context: 'Appears after an uptrend (reversal) or during a downtrend (continuation). Each candle should be a long red body, opening within the prior body and closing near its low. Shadows should be small.',
      confirmation: 'The third crow itself is confirmation. A fourth red candle adds conviction. Volume should increase across the three candles.',
      failure: 'A close above the midpoint of the third crow\'s body suggests buying is emerging. A close above the first crow\'s high invalidates the pattern.'
    },
    tips: 'Three Black Crows is most reliable when it appears after an extended uptrend with overbought readings. Avoid trading this if it appears after a long decline — it may signal selling climax rather than continuation.',
    chart: [
      { bodyTop: 82, bodyBottom: 22, wickTop: 88, wickBottom: 18, color: 'bull', faded: true },
      { bodyTop: 18, bodyBottom: 75, wickTop: 15, wickBottom: 80, color: 'bear', highlighted: true },
      { bodyTop: 10, bodyBottom: 68, wickTop: 8, wickBottom: 72, color: 'bear', highlighted: true },
      { bodyTop: 5, bodyBottom: 82, wickTop: 2, wickBottom: 88, color: 'bear', highlighted: true }
    ]
  },
  {
    id: 'three-inside-up', name: 'Three Inside Up', type: 'bullish', category: 'triple', signal: 'reversal',
    reliability: 'High',
    summary: 'A Harami followed by a bullish breakout candle. Confirms that the Harami reversal is real. Three candles: bearish, small Harami inside, bullish breakout.',
    overview: `The Three Inside Up is a confirmed Harami pattern — it takes the two-candle Bullish Harami and adds a third confirmation candle. The pattern consists of: (1) a long bearish candle, (2) a small bullish (or bearish) candle contained within the body of the first (the Harami candle), and (3) a bullish candle that closes above the high of the first candle.

This pattern is more reliable than a standalone Harami because it includes built-in confirmation. The Harami warns of a reversal; the third candle proves that the reversal is happening.`,
    psychology: `Candle 1: Sellers dominate, continuing the downtrend. Candle 2: The tiny Harami candle shows selling has stopped. But is it just a pause? Candle 3: The answer comes decisively. A strong bullish candle breaks above the first candle's high. The downtrend is broken. Shorts cover, new longs enter, and the reversal is confirmed. The pattern provides a complete narrative arc: downtrend → hesitation → reversal confirmed.`,
    bullish: {
      context: 'Forms at the bottom of a downtrend. The second candle (Harami) must have its body completely inside the first candle\'s body. The third must close above the first candle\'s high.',
      confirmation: 'The third candle IS the confirmation. Additional upside on the fourth candle provides further security.',
      failure: 'If the third candle fails to close above the first candle\'s high, the pattern is incomplete. If price then closes below the Harami candle\'s low, the pattern has failed.'
    },
    bearish: {
      context: 'N/A — Three Inside Up is exclusively bullish.',
      confirmation: 'N/A',
      failure: 'N/A'
    },
    tips: 'This pattern is essentially a Bullish Harami with a confirmation filter. It is suitable for traders who want to see the reversal actually happen before entering, rather than anticipating it from the Harami alone.',
    chart: [
      { bodyTop: 10, bodyBottom: 65, wickTop: 5, wickBottom: 72, color: 'bear', faded: true },
      { bodyTop: 35, bodyBottom: 52, wickTop: 32, wickBottom: 58, color: 'bull', highlighted: true },
      { bodyTop: 72, bodyBottom: 15, wickTop: 78, wickBottom: 10, color: 'bull', faded: false }
    ]
  },
  {
    id: 'three-inside-down', name: 'Three Inside Down', type: 'bearish', category: 'triple', signal: 'reversal',
    reliability: 'High',
    summary: 'A Bearish Harami followed by a bearish breakdown candle. Confirms the Harami reversal. Three candles: bullish, small Harami inside, bearish breakdown.',
    overview: `The Three Inside Down is the bearish counterpart — a Bearish Harami followed by a confirmation breakdown. Pattern: (1) a long bullish candle, (2) a small bearish (or bullish) candle contained within the body of the first, and (3) a bearish candle that closes below the low of the first candle.

The addition of the third candle transforms the Harami from a warning into an actionable signal. The Harami said "the uptrend is stalling." The third candle says "the uptrend is over."`,
    psychology: `Candle 1: The uptrend continues with a strong green candle. Candle 2: A tiny Harami candle trapped inside the first body — buyers are suddenly hesitant. Candle 3: The breakdown comes. A bearish candle slices below the first candle's low. Buyers from the first candle are now underwater. The uptrend has been decisively broken, and the psychological shift from bullish to bearish is complete.`,
    bullish: {
      context: 'N/A — Three Inside Down is exclusively bearish.',
      confirmation: 'N/A',
      failure: 'N/A'
    },
    bearish: {
      context: 'Forms at the top of an uptrend. The second candle\'s body must be completely inside the first candle\'s body. The third must close below the first candle\'s low.',
      confirmation: 'The third candle IS the confirmation. A fourth bearish candle provides additional safety.',
      failure: 'If the third candle fails to close below the first candle\'s low, the pattern is incomplete. A close above the second candle\'s high after an incomplete pattern is a failed signal.'
    },
    tips: 'This pattern works well on daily charts at major resistance levels. The stop-loss can be placed above the high of the first (large bullish) candle.',
    chart: [
      { bodyTop: 82, bodyBottom: 18, wickTop: 88, wickBottom: 12, color: 'bull', faded: true },
      { bodyTop: 48, bodyBottom: 32, wickTop: 52, wickBottom: 28, color: 'bear', highlighted: true },
      { bodyTop: 12, bodyBottom: 75, wickTop: 8, wickBottom: 82, color: 'bear', faded: false }
    ]
  },

  // ═══ MULTI-CANDLE ═══
  {
    id: 'rising-three-methods', name: 'Rising Three Methods', type: 'bullish', category: 'multi', signal: 'continuation',
    reliability: 'High',
    summary: 'Five-candle bullish continuation: long green, three small red candles staying within the first body, then another long green breaking to new highs.',
    overview: `The Rising Three Methods is a five-candle bullish continuation pattern that appears during an uptrend. It consists of: (1) a long bullish candle, (2-4) three small bearish candles that stay within the range of the first candle (ideally within its body), and (5) a long bullish candle that closes above the high of the first candle.

This pattern represents a controlled, orderly pullback within an uptrend — a "rest" where profit-taking occurs but bears cannot gain traction. The three small red candles are contained, showing that sellers are weak. The fifth candle confirms that the uptrend is resuming with strength.`,
    psychology: `The first candle shows strong buying. Then, instead of continued upside, three small bearish candles appear. This looks concerning — is the uptrend failing? But look closer: each of those bearish candles is tiny, and none breaks below the first candle's range. Sellers are trying to reverse the trend but can't. They're weak. Their best efforts only produce three small red candles. Then the fifth candle arrives: buyers reassert control with a powerful green candle that breaks to new highs. The message is clear — the selling was just a rest, not a reversal.`,
    bullish: {
      context: 'Appears during a defined uptrend. The three pullback candles should be small — real bodies shorter than the first candle. None should close below the first candle\'s open. The fifth should be a strong green candle closing above the first candle\'s high.',
      confirmation: 'The fifth candle is confirmation. A sixth bullish candle adds security. Volume should contract during candles 2-4 (quiet pullback) and expand on candle 5 (resumption).',
      failure: 'If any of the three pullback candles closes below the first candle\'s low, the pattern is compromised. If the fifth candle fails to close above the first candle\'s high, the pattern has failed.'
    },
    bearish: {
      context: 'N/A — Rising Three Methods is exclusively bullish continuation.',
      confirmation: 'N/A',
      failure: 'N/A'
    },
    tips: 'This pattern is essentially a small bullish flag or pennant represented in candlestick form. It is one of the few patterns that is a continuation signal rather than a reversal. Look for it during strong trends.',
    chart: [
      { bodyTop: 72, bodyBottom: 22, wickTop: 75, wickBottom: 18, color: 'bull', highlighted: true },
      { bodyTop: 52, bodyBottom: 42, wickTop: 55, wickBottom: 38, color: 'bear', faded: true },
      { bodyTop: 48, bodyBottom: 38, wickTop: 50, wickBottom: 35, color: 'bear', faded: true },
      { bodyTop: 50, bodyBottom: 40, wickTop: 52, wickBottom: 38, color: 'bear', faded: true },
      { bodyTop: 85, bodyBottom: 12, wickTop: 88, wickBottom: 8, color: 'bull', highlighted: true }
    ]
  },
  {
    id: 'falling-three-methods', name: 'Falling Three Methods', type: 'bearish', category: 'multi', signal: 'continuation',
    reliability: 'High',
    summary: 'Five-candle bearish continuation: long red, three small green candles staying within the first body, then another long red breaking to new lows.',
    overview: `The Falling Three Methods is the bearish counterpart — a five-candle continuation pattern during a downtrend. Structure: (1) a long bearish candle, (2-4) three small bullish candles contained within the body of the first, and (5) a long bearish candle closing below the low of the first candle.

During a downtrend, the three small green candles look like a potential reversal — a rally is starting. But the rally is weak and contained. Sellers are in control, and they reassert that control violently on the fifth candle. The "rally" was just profit-taking by shorts, not genuine buying interest.`,
    psychology: `The first candle shows aggressive selling. Then three small green candles appear — hope flickers. Is the downtrend over? But the rallies are tiny and contained within the first candle's range. Buyers are trying but can't gain traction. Then the fifth candle crushes that hope — a massive red candle breaks to new lows. Short-sellers who covered during the "rally" re-enter. Buyers who tried to catch the bottom are trapped. The downtrend resumes with renewed force.`,
    bullish: {
      context: 'N/A — Falling Three Methods is exclusively bearish continuation.',
      confirmation: 'N/A',
      failure: 'N/A'
    },
    bearish: {
      context: 'Appears during a defined downtrend. The three counter-trend candles should be small, contained within the first candle\'s range. The fifth should break below the first candle\'s low with conviction.',
      confirmation: 'The fifth candle confirms. Volume should contract during the counter-trend candles and expand on the fifth.',
      failure: 'If any of the three counter-trend candles closes above the first candle\'s high, the pattern is compromised. If the fifth fails to close below the first candle\'s low, the pattern has failed.'
    },
    tips: 'Like the Rising Three Methods, this is a continuation pattern — it tells you the trend is still healthy. It is particularly powerful when it appears after a brief, weak counter-trend rally that failed to gain momentum.',
    chart: [
      { bodyTop: 15, bodyBottom: 72, wickTop: 12, wickBottom: 78, color: 'bear', highlighted: true },
      { bodyTop: 38, bodyBottom: 52, wickTop: 35, wickBottom: 55, color: 'bull', faded: true },
      { bodyTop: 42, bodyBottom: 55, wickTop: 38, wickBottom: 58, color: 'bull', faded: true },
      { bodyTop: 40, bodyBottom: 52, wickTop: 38, wickBottom: 55, color: 'bull', faded: true },
      { bodyTop: 8, bodyBottom: 85, wickTop: 5, wickBottom: 90, color: 'bear', highlighted: true }
    ]
  },
  {
    id: 'abandoned-baby', name: 'Abandoned Baby', type: 'both', category: 'triple', signal: 'reversal',
    reliability: 'Very High',
    summary: 'A rare but extremely powerful three-candle reversal: an Evening/Morning Doji Star where the Doji gaps on BOTH sides — isolated from the surrounding candles.',
    overview: `The Abandoned Baby is the rarest and most powerful of all candlestick reversal patterns. It is essentially a Morning or Evening Doji Star where the Doji candle gaps away from BOTH surrounding candles — it is isolated, "abandoned" by the price action on either side. The Doji's wicks do not overlap with the bodies or wicks of the other two candles.

The Bullish Abandoned Baby (at a bottom): a bearish candle, a Doji that gaps below, and a bullish candle that gaps above the Doji — the Doji is completely isolated. The Bearish Abandoned Baby (at a top): a bullish candle, a Doji that gaps above, and a bearish candle that gaps below.`,
    psychology: `The Abandoned Baby represents an extreme and sudden shift in market psychology. The Doji candle is completely isolated — it traded at prices that no other session touched. This "gap island" represents a moment of extreme dislocation where the prior trend suddenly stopped and the new trend began from a completely different price level. The isolation of the Doji symbolizes a clean break with the past. The old trend died, there was a moment of complete uncertainty (the Doji), and then a new trend was born from a different starting point. Nothing carries over.`,
    bullish: {
      context: 'The Bullish Abandoned Baby forms at the bottom of a downtrend. The Doji must gap below the first candle (lower high) AND gap below the third candle (lower low). The Doji\'s shadows must not overlap the other candles.',
      confirmation: 'The third candle is confirmation. This pattern is so rare and powerful that many traders enter on the third candle close without waiting for further confirmation.',
      failure: 'If price closes below the Doji\'s low after the pattern completes, the reversal has failed. This is uncommon but possible.'
    },
    bearish: {
      context: 'The Bearish Abandoned Baby forms at the top of an uptrend. The Doji must gap above both surrounding candles with no shadow overlap.',
      confirmation: 'The third (bearish) candle confirms. Given the pattern\'s rarity, immediate entry on confirmation is common.',
      failure: 'A close above the Doji\'s high after the pattern completes invalidates the bearish signal.'
    },
    tips: 'This pattern is extremely rare — you may only see it a few times per year on a daily chart. When you do see it, pay attention. It often marks major turning points. The pattern is most valid on daily and weekly timeframes; on lower timeframes, gaps are less meaningful.',
    chart: [
      { bodyTop: 12, bodyBottom: 58, wickTop: 5, wickBottom: 62, color: 'bear', faded: true },
      { bodyTop: 40, bodyBottom: 42, wickTop: 28, wickBottom: 52, color: 'doji', highlighted: true },
      { bodyTop: 78, bodyBottom: 18, wickTop: 82, wickBottom: 12, color: 'bull', faded: false }
    ]
  }
];

export default PATTERNS;
