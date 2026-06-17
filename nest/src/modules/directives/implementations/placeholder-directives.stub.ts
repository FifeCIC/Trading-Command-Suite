/**
 * Placeholder Directive Stubs
 * ===========================
 * All directives from TradePress PHP classes and aspirational strategy docs
 * that have established math but not yet been ported to NestJS.
 *
 * Each stub:
 * - Returns score: 0, confidence: 0, reason referencing PHP source
 * - Preserves the directive ID contract
 * - Ready for real implementation when prioritized
 *
 * DO NOT EDIT stubs to add real math — create a new implementation file
 * and remove the stub registration once the real version is active.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

/** Factory for consistent stub result */
function stubResult(directiveId: string, phpFile?: string): DirectiveResult {
  const src = phpFile
    ? `Math in TradePress includes/scoring-system/directives/${phpFile}`
    : 'Documented in strategy docs — not yet spec\'d as directive';
  return {
      signalClass: 'neutral',
      score: 0,
    confidence: 0,
    reason: `[STUB] ${directiveId}: Not yet implemented. ${src}.`,
  };
}

// ===========================================================================
// Momentum
// ===========================================================================

@Injectable()
export class StochasticDirective implements IDirective {
  readonly id = 'stochastic';
  readonly name = 'Stochastic Oscillator';
  readonly description = '%K/%D crossover in oversold (<20) region.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'stochastic.php');
  }
}

@Injectable()
export class CciDirective implements IDirective {
  readonly id = 'cci';
  readonly name = 'Commodity Channel Index';
  readonly description = 'CCI crossing above -100 from oversold.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'cci.php');
  }
}

@Injectable()
export class MfiDirective implements IDirective {
  readonly id = 'mfi';
  readonly name = 'Money Flow Index';
  readonly description = 'Volume-weighted RSI, MFI < 20 accumulation signal.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'mfi.php');
  }
}

@Injectable()
export class AdxDirective implements IDirective {
  readonly id = 'adx';
  readonly name = 'Average Directional Index';
  readonly description = 'ADX > 25 confirms trend, +DI > -DI bullish.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'adx.php');
  }
}

@Injectable()
export class RsiOverboughtDirective implements IDirective {
  readonly id = 'rsi-overbought';
  readonly name = 'RSI Overbought Warning';
  readonly description = 'RSI > 70 with downward curl = bearish signal.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'rsi-overbought.php');
  }
}

@Injectable()
export class MomentumContinuationComboDirective implements IDirective {
  readonly id = 'momentum-continuation-combo';
  readonly name = 'Momentum Continuation Combo';
  readonly description = 'Multi-indicator momentum confluence.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'momentum-continuation-combo.php');
  }
}

// ===========================================================================
// Trend
// ===========================================================================

@Injectable()
export class MovingAveragesDirective implements IDirective {
  readonly id = 'moving-averages';
  readonly name = 'Moving Averages Alignment';
  readonly description = 'Bullish MA alignment (20>50>200).';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'moving-averages.php');
  }
}

@Injectable()
export class MaCrossoverDirective implements IDirective {
  readonly id = 'ma-crossover';
  readonly name = 'Moving Average Crossover';
  readonly description = 'Fast MA crossing above slow MA.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'ma-crossover.php');
  }
}

@Injectable()
export class PriceAboveSma50Directive implements IDirective {
  readonly id = 'price-above-sma-50';
  readonly name = 'Price Above SMA 50';
  readonly description = 'Price sustaining above 50-day SMA.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'price-above-sma-50.php');
  }
}

// ===========================================================================
// Volatility
// ===========================================================================

@Injectable()
export class BollingerBandSqueezeDirective implements IDirective {
  readonly id = 'bollinger-band-squeeze';
  readonly name = 'Bollinger Band Squeeze';
  readonly description = 'Band width at multi-period low signals expansion.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'bollinger-band-squeeze.php');
  }
}

@Injectable()
export class VolatilityToolsDirective implements IDirective {
  readonly id = 'volatility-tools';
  readonly name = 'Volatility Calculator';
  readonly description = 'Historical vol, ATR percentile, beta proxy utility.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'volatility-tools.php');
  }
}

// ===========================================================================
// Volume
// ===========================================================================

@Injectable()
export class ObvDirective implements IDirective {
  readonly id = 'obv';
  readonly name = 'On-Balance Volume';
  readonly description = 'OBV divergence from price = accumulation/distribution.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'obv.php');
  }
}

@Injectable()
export class VolumeSurgeDirective implements IDirective {
  readonly id = 'volume-surge';
  readonly name = 'Volume Surge Detection';
  readonly description = 'Volume > 2x average with price up = institutional interest.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'volume-surge.php');
  }
}

@Injectable()
export class VolumeRhythmDirective implements IDirective {
  readonly id = 'volume-rhythm';
  readonly name = 'Volume Rhythm';
  readonly description = 'Day-of-week volume patterns and institutional rhythms.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'volume-rhythm.php');
  }
}

// ===========================================================================
// Candlestick Patterns
// ===========================================================================

@Injectable()
export class DojiPatternDirective implements IDirective {
  readonly id = 'doji-pattern';
  readonly name = 'Doji Pattern';
  readonly description = 'Doji at support = potential reversal.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'doji-pattern.php');
  }
}

@Injectable()
export class HammerPatternDirective implements IDirective {
  readonly id = 'hammer-pattern';
  readonly name = 'Hammer Pattern';
  readonly description = 'Hammer at downtrend low = bullish reversal.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'hammer-pattern.php');
  }
}

@Injectable()
export class EngulfingPatternDirective implements IDirective {
  readonly id = 'engulfing-pattern';
  readonly name = 'Engulfing Pattern';
  readonly description = 'Bullish engulfing = strong reversal signal.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'engulfing-pattern.php');
  }
}

@Injectable()
export class PinBarPatternDirective implements IDirective {
  readonly id = 'pin-bar-pattern';
  readonly name = 'Pin Bar Pattern';
  readonly description = 'Pin bar rejecting lower prices = support confirmed.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'pin-bar-pattern.php');
  }
}

@Injectable()
export class ThreeSoldiersPatternDirective implements IDirective {
  readonly id = 'three-soldiers-pattern';
  readonly name = 'Three White Soldiers';
  readonly description = 'Three consecutive strong bullish candles.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'three-soldiers-pattern.php');
  }
}

// ===========================================================================
// Macro / Regime
// ===========================================================================

@Injectable()
export class VixRegimeDirective implements IDirective {
  readonly id = 'vix-regime';
  readonly name = 'VIX Regime';
  readonly description = 'Broad market regime from VIX: fear/complacency scoring.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'vix-regime.php');
  }
}

@Injectable()
export class GoldMacroCorrelationDirective implements IDirective {
  readonly id = 'gold-macro-correlation';
  readonly name = 'Gold Macro Correlation';
  readonly description = 'Gold vs real yields, USD, Fed policy, safe-haven demand.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'gold-macro-correlation.php');
  }
}

@Injectable()
export class CadUsdOilCorrelationDirective implements IDirective {
  readonly id = 'cad-usd-oil-correlation';
  readonly name = 'CAD/USD Oil Correlation';
  readonly description = 'CAD petrocurrency vs WTI crude and rate differentials.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'cad-usd-oil-correlation.php');
  }
}

// ===========================================================================
// Temporal / Calendar
// ===========================================================================

@Injectable()
export class MondayEffectDirective implements IDirective {
  readonly id = 'monday-effect';
  readonly name = 'Monday Effect';
  readonly description = 'Monday negative bias detection.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'monday-effect.php');
  }
}

@Injectable()
export class FridayPositioningDirective implements IDirective {
  readonly id = 'friday-positioning';
  readonly name = 'Friday Positioning';
  readonly description = 'End-of-week institutional rebalancing patterns.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'friday-positioning.php');
  }
}

@Injectable()
export class MidweekMomentumDirective implements IDirective {
  readonly id = 'midweek-momentum';
  readonly name = 'Midweek Momentum';
  readonly description = 'Tue-Thu volume/volatility strength patterns.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'midweek-momentum.php');
  }
}

@Injectable()
export class AdvancedWeeklyRhythmDirective implements IDirective {
  readonly id = 'advanced-weekly-rhythm';
  readonly name = 'Advanced Weekly Rhythm Composite';
  readonly description = 'All 7 weekly rhythm directives combined.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'advanced-weekly-rhythm.php');
  }
}

@Injectable()
export class SpyOptionsExpiryDirective implements IDirective {
  readonly id = 'spy-options-expiry';
  readonly name = 'SPY Options Expiry Effect';
  readonly description = 'OpEx week: before(-10), day(-15), after(+20). Qtr 1.5x.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'spy-options-expiry.php');
  }
}

@Injectable()
export class SpyMonthEndRebalancingDirective implements IDirective {
  readonly id = 'spy-month-end-rebalancing';
  readonly name = 'SPY Month-End Rebalancing';
  readonly description = 'Month-end flows: down>3%=+25, up>5%=-15. Qtr 1.5x.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'spy-month-end-rebalancing.php');
  }
}

@Injectable()
export class SpyQqqRelativeStrengthDirective implements IDirective {
  readonly id = 'spy-qqq-relative-strength';
  readonly name = 'SPY/QQQ Relative Strength';
  readonly description = 'SPY vs QQQ relative performance signal.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'spy-qqq-relative-strength.php');
  }
}

// ===========================================================================
// Crypto
// ===========================================================================

@Injectable()
export class CryptoFearGreedDirective implements IDirective {
  readonly id = 'crypto-fear-greed';
  readonly name = 'Crypto Fear and Greed Proxy';
  readonly description = 'BTC momentum/volume/volatility/dominance proxy.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'crypto-fear-greed.php');
  }
}

@Injectable()
export class BtcHalvingCycleDirective implements IDirective {
  readonly id = 'btc-halving-cycle';
  readonly name = 'Bitcoin Halving Cycle';
  readonly description = 'Hardcoded halving dates, 0-180 days post = +15.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'btc-halving-cycle.php');
  }
}

@Injectable()
export class CryptoWeekendEffectDirective implements IDirective {
  readonly id = 'crypto-weekend-effect';
  readonly name = 'Crypto Weekend Effect';
  readonly description = '24/7 crypto weekend volatility patterns.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'crypto-weekend-effect.php');
  }
}

// ===========================================================================
// Equity-Specific
// ===========================================================================

@Injectable()
export class NvdaEarningsMomentumDirective implements IDirective {
  readonly id = 'nvda-earnings-momentum';
  readonly name = 'NVDA Earnings Momentum';
  readonly description = 'NVDA-specific earnings timing and post-drift.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'nvda-earnings-momentum.php');
  }
}

@Injectable()
export class TslaSentimentAmplifierDirective implements IDirective {
  readonly id = 'tsla-sentiment-amplifier';
  readonly name = 'TSLA Sentiment Amplifier';
  readonly description = 'TSLA: RSI<35+vol>1.5x=+35, near 52wk low=+25.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}

// ===========================================================================
// Fundamental
// ===========================================================================

@Injectable()
export class DividendYieldAttractiveDirective implements IDirective {
  readonly id = 'dividend-yield-attractive';
  readonly name = 'Attractive Dividend Yield';
  readonly description = 'Above-average yield with sustainable payout ratio.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'dividend-yield-attractive.php');
  }
}

@Injectable()
export class EarningsProximityDirective implements IDirective {
  readonly id = 'earnings-proximity';
  readonly name = 'Earnings Proximity';
  readonly description = 'Distance to next earnings, pre/post drift windows.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'earnings-proximity.php');
  }
}

@Injectable()
export class NewsSentimentPositiveDirective implements IDirective {
  readonly id = 'news-sentiment-positive';
  readonly name = 'Positive News Sentiment';
  readonly description = 'Aggregated news sentiment momentum from provider.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'news-sentiment-positive.php');
  }
}

// ===========================================================================
// Composite
// ===========================================================================

@Injectable()
export class ConfluenceReversalComboDirective implements IDirective {
  readonly id = 'confluence-reversal-combo';
  readonly name = 'Confluence Reversal Combo';
  readonly description = 'RSI divergence + candle + volume + support confluence.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'confluence-reversal-combo.php');
  }
}

@Injectable()
export class PriceActionDirective implements IDirective {
  readonly id = 'price-action';
  readonly name = 'Price Action';
  readonly description = 'HH/HL, market structure, S/R tests from raw price.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'price-action.php');
  }
}

// ===========================================================================
// Risk / Support-Resistance
// ===========================================================================

@Injectable()
export class SupportResistanceLevelsDirective implements IDirective {
  readonly id = 'support-resistance-levels';
  readonly name = 'Support & Resistance Levels';
  readonly description = 'Key S/R from historical pivots, bounce quality.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'support-resistance-levels.php');
  }
}

@Injectable()
export class OverheadSupplyPressureDirective implements IDirective {
  readonly id = 'overhead-supply-pressure';
  readonly name = 'Overhead Supply Pressure';
  readonly description = 'Trapped overhead supply from recent top, reclaim progress.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'overhead-supply-pressure.php');
  }
}

@Injectable()
export class PanicExhaustionAbsorptionDirective implements IDirective {
  readonly id = 'panic-exhaustion-absorption';
  readonly name = 'Panic Exhaustion & Absorption';
  readonly description = 'Panic → capitulation → exhaustion → stabilization.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'panic-exhaustion-absorption.php');
  }
}

@Injectable()
export class TimeBasedSupportDirective implements IDirective {
  readonly id = 'time-based-support';
  readonly name = 'Time-Based Support';
  readonly description = 'VWAP and time-sensitive S/R levels.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'time-based-support.php');
  }
}

// ===========================================================================
// ISA / Special
// ===========================================================================

@Injectable()
export class IsaResetDirective implements IDirective {
  readonly id = 'isa-reset';
  readonly name = 'ISA Reset';
  readonly description = 'UK ISA tax-year reset timing bonus.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'isa.php');
  }
}

// ===========================================================================
// Additional TradePress Directives (rounding out the full 56)
// ===========================================================================

@Injectable()
export class BollingerBandsDirective implements IDirective {
  readonly id = 'bollinger-bands';
  readonly name = 'Bollinger Bands';
  readonly description = 'Price vs bands, bandwidth, %B indicator.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'bollinger-bands.php');
  }
}

@Injectable()
export class VwapDirective implements IDirective {
  readonly id = 'vwap';
  readonly name = 'VWAP (Volume-Weighted Average Price)';
  readonly description = 'Price relative to VWAP, intraday sentiment.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'vwap.php');
  }
}

@Injectable()
export class BasicWeeklyRhythmDirective implements IDirective {
  readonly id = 'basic-weekly-rhythm';
  readonly name = 'Basic Weekly Rhythm Composite';
  readonly description = 'monday-effect + midweek-momentum + volume-rhythm combo.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'basic-weekly-rhythm.php');
  }
}

@Injectable()
export class IntradayUPatternDirective implements IDirective {
  readonly id = 'intraday-u-pattern';
  readonly name = 'Intraday U-Pattern';
  readonly description = 'Morning rush + afternoon kick U-shaped recovery.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'intraday-u-pattern.php');
  }
}

@Injectable()
export class InstitutionalTimingDirective implements IDirective {
  readonly id = 'institutional-timing';
  readonly name = 'Institutional Timing';
  readonly description = 'Month/quarter/year-end institutional rebalancing.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'institutional-timing.php');
  }
}

@Injectable()
export class MacdDirective implements IDirective {
  readonly id = 'macd';
  readonly name = 'MACD (General)';
  readonly description = 'Line/signal relationship, histogram, divergence.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'macd.php');
  }
}

// ===========================================================================
// Portfolio
// ===========================================================================

@Injectable()
export class PortfolioPerformanceDirective implements IDirective {
  readonly id = 'portfolio-performance';
  readonly name = 'Portfolio Performance';
  readonly description = 'Portfolio momentum from Alpaca account data.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'portfolio-performance.php');
  }
}

// ===========================================================================
// Aspirational (strategy docs — no PHP source yet)
// ===========================================================================

@Injectable()
export class AdaptiveRiskMonitorDirective implements IDirective {
  readonly id = 'adaptive-risk-monitor';
  readonly name = 'Adaptive Risk Monitor';
  readonly description = 'Dynamic position sizing from vol and correlation shifts.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}

@Injectable()
export class AnalystAdjustmentsDirective implements IDirective {
  readonly id = 'analyst-adjustments';
  readonly name = 'Analyst Adjustments';
  readonly description = 'Analyst revisions: upgrades, downgrades, PT changes.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}

@Injectable()
export class ConvictionGrowthDirective implements IDirective {
  readonly id = 'conviction-growth';
  readonly name = 'Conviction Growth';
  readonly description = 'Multi-timeframe conviction for position scaling.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}

@Injectable()
export class EarningsImplementationDirective implements IDirective {
  readonly id = 'earnings-implementation';
  readonly name = 'Earnings Strategy Implementation';
  readonly description = 'Pre/post earnings positioning with vol crush modeling.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}

@Injectable()
export class EarningsWhispersDirective implements IDirective {
  readonly id = 'earnings-whispers';
  readonly name = 'Earnings Whispers';
  readonly description = 'Unofficial expectations vs consensus, whisper deviation.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}

@Injectable()
export class LikeZacksDirective implements IDirective {
  readonly id = 'like-zacks';
  readonly name = 'Zacks-Style Rank Proxy';
  readonly description = 'Earnings estimate revision ranking system.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}

@Injectable()
export class MeanReversionDirective implements IDirective {
  readonly id = 'mean-reversion';
  readonly name = 'Mean Reversion Strategy';
  readonly description = 'Statistical mean reversion with regime filters.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}

@Injectable()
export class ResistanceLevelsStrategyDirective implements IDirective {
  readonly id = 'resistance-levels-strategy';
  readonly name = 'Resistance Levels Strategy';
  readonly description = 'Multi-timeframe resistance with breakout/failure scoring.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}

@Injectable()
export class Sp500RegimeDirective implements IDirective {
  readonly id = 'sp500-regime';
  readonly name = 'S&P 500 Regime Filter';
  readonly description = 'Market regime: bull/correction/bear/recovery. Overrides scores.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}

@Injectable()
export class VixStrategyDirective implements IDirective {
  readonly id = 'vix-strategy';
  readonly name = 'VIX-Based Strategy';
  readonly description = 'VIX position sizing, contango/backwardation analysis.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}

@Injectable()
export class WeeklyRhythmStrategyDirective implements IDirective {
  readonly id = 'weekly-rhythm-strategy';
  readonly name = 'Weekly Rhythm Strategy';
  readonly description = 'Day-of-week statistical edges for entry/exit timing.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id);
  }
}
