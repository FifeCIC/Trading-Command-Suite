import { Module, OnModuleInit } from '@nestjs/common';
import { DirectivesService } from './directives.service';

// Implemented (real math)
import { RsiOversoldDirective } from './implementations/rsi-oversold.directive';
import { MacdCrossoverDirective } from './implementations/macd-crossover.directive';
import { EmaStructureDirective } from './implementations/ema-structure.directive';
import { AtrDipDirective } from './implementations/atr-dip.directive';
import { VolumeConfirmationDirective } from './implementations/volume-confirmation.directive';

// Implemented candlestick patterns
import { DojiPatternDirective } from './implementations/doji-pattern.directive';
import { EngulfingPatternDirective } from './implementations/engulfing-pattern.directive';
import { HammerPatternDirective } from './implementations/hammer-pattern.directive';
import { ThreeSoldiersPatternDirective } from './implementations/three-soldiers-pattern.directive';
// Implemented volume
import { ObvDirective } from './implementations/obv.directive';
// Implemented momentum
import { MfiDirective } from './implementations/mfi.directive';
import { AdxDirective } from './implementations/adx.directive';
import { StochasticDirective } from './implementations/stochastic.directive';
// Implemented trend
import { PriceAboveSmaDirective } from './implementations/price-above-sma.directive';
import { RsiOverboughtDirective } from './implementations/rsi-overbought.directive';
import { MaCrossoverDirective } from './implementations/ma-crossover.directive';
// Implemented volatility
import { BollingerBandsDirective } from './implementations/bollinger-bands.directive';
import { CciDirective } from './implementations/cci.directive';
// Implemented volume rhythm
import { VolumeRhythmDirective } from './implementations/volume-rhythm.directive';
import { VwapDirective } from './implementations/vwap.directive';
import { VolumeSurgeDirective } from './implementations/volume-surge.directive';
import { BollingerBandSqueezeDirective } from './implementations/bollinger-squeeze.directive';

// Stubs (placeholder — PHP math at TradePress, awaiting NestJS port)
import {
  // Momentum
  MomentumContinuationComboDirective,
  // Trend
  MovingAveragesDirective,
  // Volatility
  VolatilityToolsDirective,
  // Candlestick Patterns (now real implementations)
  PinBarPatternDirective,
  // Macro / Regime
  VixRegimeDirective,
  GoldMacroCorrelationDirective,
  CadUsdOilCorrelationDirective,
  // Temporal / Calendar
  MondayEffectDirective,
  FridayPositioningDirective,
  MidweekMomentumDirective,
  AdvancedWeeklyRhythmDirective,
  SpyOptionsExpiryDirective,
  SpyMonthEndRebalancingDirective,
  SpyQqqRelativeStrengthDirective,
  // Crypto
  CryptoFearGreedDirective,
  BtcHalvingCycleDirective,
  CryptoWeekendEffectDirective,
  // Equity-Specific
  NvdaEarningsMomentumDirective,
  TslaSentimentAmplifierDirective,
  // Fundamental
  DividendYieldAttractiveDirective,
  EarningsProximityDirective,
  NewsSentimentPositiveDirective,
  // Composite
  ConfluenceReversalComboDirective,
  PriceActionDirective,
  // Risk / Support-Resistance
  SupportResistanceLevelsDirective,
  OverheadSupplyPressureDirective,
  PanicExhaustionAbsorptionDirective,
  TimeBasedSupportDirective,
  // ISA / Special
  IsaResetDirective,
  // Portfolio
  PortfolioPerformanceDirective,
  // Additional TradePress (rounding out full 56)
  BasicWeeklyRhythmDirective,
  IntradayUPatternDirective,
  InstitutionalTimingDirective,
  MacdDirective,
  // Aspirational (strategy docs — no PHP source yet)
  AdaptiveRiskMonitorDirective,
  AnalystAdjustmentsDirective,
  ConvictionGrowthDirective,
  EarningsImplementationDirective,
  EarningsWhispersDirective,
  LikeZacksDirective,
  MeanReversionDirective,
  ResistanceLevelsStrategyDirective,
  Sp500RegimeDirective,
  VixStrategyDirective,
  WeeklyRhythmStrategyDirective,
} from './implementations/placeholder-directives.stub';

@Module({
  providers: [
    DirectivesService,
    // Implemented
    RsiOversoldDirective,
    MacdCrossoverDirective,
    EmaStructureDirective,
    AtrDipDirective,
    VolumeConfirmationDirective,
    // Implemented — Momentum
    MfiDirective,
    AdxDirective,
    StochasticDirective,
    RsiOverboughtDirective,
    // Stubs — Momentum
    MomentumContinuationComboDirective,
    // Implemented — Trend
    PriceAboveSmaDirective,
    MaCrossoverDirective,
    // Stubs — Trend
    MovingAveragesDirective,
    // Implemented — Volatility
    BollingerBandsDirective,
    CciDirective,
    BollingerBandSqueezeDirective,
    // Stubs — Volatility
    VolatilityToolsDirective,
    // Implemented — Volume
    ObvDirective,
    VolumeRhythmDirective,
    VwapDirective,
    VolumeSurgeDirective,
    // Implemented — Patterns
    DojiPatternDirective,
    EngulfingPatternDirective,
    HammerPatternDirective,
    ThreeSoldiersPatternDirective,
    // Stubs — Patterns
    PinBarPatternDirective,
    // Stubs — Macro
    VixRegimeDirective,
    GoldMacroCorrelationDirective,
    CadUsdOilCorrelationDirective,
    // Stubs — Temporal
    MondayEffectDirective,
    FridayPositioningDirective,
    MidweekMomentumDirective,
    AdvancedWeeklyRhythmDirective,
    SpyOptionsExpiryDirective,
    SpyMonthEndRebalancingDirective,
    SpyQqqRelativeStrengthDirective,
    // Stubs — Crypto
    CryptoFearGreedDirective,
    BtcHalvingCycleDirective,
    CryptoWeekendEffectDirective,
    // Stubs — Equity-Specific
    NvdaEarningsMomentumDirective,
    TslaSentimentAmplifierDirective,
    // Stubs — Fundamental
    DividendYieldAttractiveDirective,
    EarningsProximityDirective,
    NewsSentimentPositiveDirective,
    // Stubs — Composite
    ConfluenceReversalComboDirective,
    PriceActionDirective,
    // Stubs — Risk
    SupportResistanceLevelsDirective,
    OverheadSupplyPressureDirective,
    PanicExhaustionAbsorptionDirective,
    TimeBasedSupportDirective,
    // Stubs — Special
    IsaResetDirective,
    PortfolioPerformanceDirective,
    // Stubs — Additional TradePress (rounding out full 56)
    BasicWeeklyRhythmDirective,
    IntradayUPatternDirective,
    InstitutionalTimingDirective,
    MacdDirective,
    // Stubs — Aspirational
    AdaptiveRiskMonitorDirective,
    AnalystAdjustmentsDirective,
    ConvictionGrowthDirective,
    EarningsImplementationDirective,
    EarningsWhispersDirective,
    LikeZacksDirective,
    MeanReversionDirective,
    ResistanceLevelsStrategyDirective,
    Sp500RegimeDirective,
    VixStrategyDirective,
    WeeklyRhythmStrategyDirective,
  ],
  exports: [DirectivesService],
})
export class DirectivesModule implements OnModuleInit {
  constructor(
    private readonly directivesService: DirectivesService,
    // Implemented
    private readonly rsi: RsiOversoldDirective,
    private readonly macd: MacdCrossoverDirective,
    private readonly ema: EmaStructureDirective,
    private readonly atrDip: AtrDipDirective,
    private readonly volume: VolumeConfirmationDirective,
    // Implemented — Momentum
    private readonly mfi: MfiDirective,
    private readonly adx: AdxDirective,
    private readonly stochastic: StochasticDirective,
    private readonly rsiOverbought: RsiOverboughtDirective,
    // Stubs — Momentum
    private readonly momentumCont: MomentumContinuationComboDirective,
    // Implemented — Trend
    private readonly priceAboveSma: PriceAboveSmaDirective,
    private readonly maCrossover: MaCrossoverDirective,
    // Stubs — Trend
    private readonly movingAverages: MovingAveragesDirective,
    // Implemented — Volatility
    private readonly bollingerBands: BollingerBandsDirective,
    private readonly cci: CciDirective,
    private readonly bollingerSqueeze: BollingerBandSqueezeDirective,
    // Stubs — Volatility
    private readonly volTools: VolatilityToolsDirective,
    // Implemented — Volume
    private readonly obv: ObvDirective,
    private readonly volumeRhythm: VolumeRhythmDirective,
    private readonly vwap: VwapDirective,
    private readonly volumeSurge: VolumeSurgeDirective,
    // Implemented — Patterns
    private readonly doji: DojiPatternDirective,
    private readonly engulfing: EngulfingPatternDirective,
    private readonly hammer: HammerPatternDirective,
    private readonly threeSoldiers: ThreeSoldiersPatternDirective,
    // Stubs — Patterns
    private readonly pinBar: PinBarPatternDirective,
    // Stubs — Macro
    private readonly vixRegime: VixRegimeDirective,
    private readonly goldMacro: GoldMacroCorrelationDirective,
    private readonly cadUsdOil: CadUsdOilCorrelationDirective,
    // Stubs — Temporal
    private readonly mondayEffect: MondayEffectDirective,
    private readonly fridayPos: FridayPositioningDirective,
    private readonly midweek: MidweekMomentumDirective,
    private readonly weeklyRhythm: AdvancedWeeklyRhythmDirective,
    private readonly spyOpEx: SpyOptionsExpiryDirective,
    private readonly spyMonthEnd: SpyMonthEndRebalancingDirective,
    private readonly spyQqq: SpyQqqRelativeStrengthDirective,
    // Stubs — Crypto
    private readonly cryptoFear: CryptoFearGreedDirective,
    private readonly btcHalving: BtcHalvingCycleDirective,
    private readonly cryptoWeekend: CryptoWeekendEffectDirective,
    // Stubs — Equity-Specific
    private readonly nvdaEarnings: NvdaEarningsMomentumDirective,
    private readonly tslaSentiment: TslaSentimentAmplifierDirective,
    // Stubs — Fundamental
    private readonly dividend: DividendYieldAttractiveDirective,
    private readonly earningsProx: EarningsProximityDirective,
    private readonly newsSentiment: NewsSentimentPositiveDirective,
    // Stubs — Composite
    private readonly confluence: ConfluenceReversalComboDirective,
    private readonly priceAction: PriceActionDirective,
    // Stubs — Risk
    private readonly supportResist: SupportResistanceLevelsDirective,
    private readonly overheadSupply: OverheadSupplyPressureDirective,
    private readonly panicExhaust: PanicExhaustionAbsorptionDirective,
    private readonly timeSupport: TimeBasedSupportDirective,
    // Stubs — Special
    private readonly isa: IsaResetDirective,
    private readonly portfolio: PortfolioPerformanceDirective,
    // Stubs — Additional TradePress
    private readonly basicWeekly: BasicWeeklyRhythmDirective,
    private readonly intradayU: IntradayUPatternDirective,
    private readonly instTiming: InstitutionalTimingDirective,
    private readonly macdGeneral: MacdDirective,
    // Stubs — Aspirational
    private readonly adaptiveRisk: AdaptiveRiskMonitorDirective,
    private readonly analystAdj: AnalystAdjustmentsDirective,
    private readonly conviction: ConvictionGrowthDirective,
    private readonly earningsImpl: EarningsImplementationDirective,
    private readonly earningsWhisp: EarningsWhispersDirective,
    private readonly likeZacks: LikeZacksDirective,
    private readonly meanRev: MeanReversionDirective,
    private readonly resistStrat: ResistanceLevelsStrategyDirective,
    private readonly sp500Regime: Sp500RegimeDirective,
    private readonly vixStrat: VixStrategyDirective,
    private readonly weeklyRhythmStrat: WeeklyRhythmStrategyDirective,
  ) {}

  onModuleInit() {
    // Implemented
    this.directivesService.register(this.rsi);
    this.directivesService.register(this.macd);
    this.directivesService.register(this.ema);
    this.directivesService.register(this.atrDip);
    this.directivesService.register(this.volume);
    // Implemented — Momentum
    this.directivesService.register(this.mfi);
    this.directivesService.register(this.adx);
    this.directivesService.register(this.stochastic);
    this.directivesService.register(this.rsiOverbought);
    // Stubs — Momentum
    this.directivesService.register(this.momentumCont);
    // Implemented — Trend
    this.directivesService.register(this.priceAboveSma);
    this.directivesService.register(this.maCrossover);
    // Stubs — Trend
    this.directivesService.register(this.movingAverages);
    // Implemented — Volatility
    this.directivesService.register(this.bollingerBands);
    this.directivesService.register(this.cci);
    this.directivesService.register(this.bollingerSqueeze);
    // Stubs — Volatility
    this.directivesService.register(this.volTools);
    // Implemented — Volume
    this.directivesService.register(this.obv);
    this.directivesService.register(this.volumeRhythm);
    this.directivesService.register(this.vwap);
    this.directivesService.register(this.volumeSurge);
    // Implemented — Patterns
    this.directivesService.register(this.doji);
    this.directivesService.register(this.hammer);
    this.directivesService.register(this.engulfing);
    this.directivesService.register(this.threeSoldiers);
    // Stubs — Patterns
    this.directivesService.register(this.pinBar);
    // Stubs — Macro
    this.directivesService.register(this.vixRegime);
    this.directivesService.register(this.goldMacro);
    this.directivesService.register(this.cadUsdOil);
    // Stubs — Temporal
    this.directivesService.register(this.mondayEffect);
    this.directivesService.register(this.fridayPos);
    this.directivesService.register(this.midweek);
    this.directivesService.register(this.weeklyRhythm);
    this.directivesService.register(this.spyOpEx);
    this.directivesService.register(this.spyMonthEnd);
    this.directivesService.register(this.spyQqq);
    // Stubs — Crypto
    this.directivesService.register(this.cryptoFear);
    this.directivesService.register(this.btcHalving);
    this.directivesService.register(this.cryptoWeekend);
    // Stubs — Equity-Specific
    this.directivesService.register(this.nvdaEarnings);
    this.directivesService.register(this.tslaSentiment);
    // Stubs — Fundamental
    this.directivesService.register(this.dividend);
    this.directivesService.register(this.earningsProx);
    this.directivesService.register(this.newsSentiment);
    // Stubs — Composite
    this.directivesService.register(this.confluence);
    this.directivesService.register(this.priceAction);
    // Stubs — Risk
    this.directivesService.register(this.supportResist);
    this.directivesService.register(this.overheadSupply);
    this.directivesService.register(this.panicExhaust);
    this.directivesService.register(this.timeSupport);
    // Stubs — Special
    this.directivesService.register(this.isa);
    this.directivesService.register(this.portfolio);
    // Stubs — Additional TradePress
    this.directivesService.register(this.basicWeekly);
    this.directivesService.register(this.intradayU);
    this.directivesService.register(this.instTiming);
    this.directivesService.register(this.macdGeneral);
    // Stubs — Aspirational
    this.directivesService.register(this.adaptiveRisk);
    this.directivesService.register(this.analystAdj);
    this.directivesService.register(this.conviction);
    this.directivesService.register(this.earningsImpl);
    this.directivesService.register(this.earningsWhisp);
    this.directivesService.register(this.likeZacks);
    this.directivesService.register(this.meanRev);
    this.directivesService.register(this.resistStrat);
    this.directivesService.register(this.sp500Regime);
    this.directivesService.register(this.vixStrat);
    this.directivesService.register(this.weeklyRhythmStrat);
  }
}
