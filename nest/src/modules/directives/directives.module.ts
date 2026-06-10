import { Module, OnModuleInit } from '@nestjs/common';
import { DirectivesService } from './directives.service';

// Implemented (real math)
import { RsiOversoldDirective } from './implementations/rsi-oversold.directive';
import { MacdCrossoverDirective } from './implementations/macd-crossover.directive';
import { EmaStructureDirective } from './implementations/ema-structure.directive';
import { AtrDipDirective } from './implementations/atr-dip.directive';
import { VolumeConfirmationDirective } from './implementations/volume-confirmation.directive';

// Stubs (placeholder — PHP math at TradePress, awaiting NestJS port)
import {
  // Momentum
  StochasticDirective,
  CciDirective,
  MfiDirective,
  AdxDirective,
  RsiOverboughtDirective,
  MomentumContinuationComboDirective,
  // Trend
  MovingAveragesDirective,
  MaCrossoverDirective,
  PriceAboveSma50Directive,
  // Volatility
  BollingerBandSqueezeDirective,
  VolatilityToolsDirective,
  // Volume
  ObvDirective,
  VolumeSurgeDirective,
  VolumeRhythmDirective,
  // Candlestick Patterns
  DojiPatternDirective,
  HammerPatternDirective,
  EngulfingPatternDirective,
  PinBarPatternDirective,
  ThreeSoldiersPatternDirective,
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
  BollingerBandsDirective,
  VwapDirective,
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
    // Stubs — Momentum
    StochasticDirective,
    CciDirective,
    MfiDirective,
    AdxDirective,
    RsiOverboughtDirective,
    MomentumContinuationComboDirective,
    // Stubs — Trend
    MovingAveragesDirective,
    MaCrossoverDirective,
    PriceAboveSma50Directive,
    // Stubs — Volatility
    BollingerBandSqueezeDirective,
    VolatilityToolsDirective,
    // Stubs — Volume
    ObvDirective,
    VolumeSurgeDirective,
    VolumeRhythmDirective,
    // Stubs — Patterns
    DojiPatternDirective,
    HammerPatternDirective,
    EngulfingPatternDirective,
    PinBarPatternDirective,
    ThreeSoldiersPatternDirective,
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
    BollingerBandsDirective,
    VwapDirective,
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
    // Stubs — Momentum
    private readonly stochastic: StochasticDirective,
    private readonly cci: CciDirective,
    private readonly mfi: MfiDirective,
    private readonly adx: AdxDirective,
    private readonly rsiOverbought: RsiOverboughtDirective,
    private readonly momentumCont: MomentumContinuationComboDirective,
    // Stubs — Trend
    private readonly movingAverages: MovingAveragesDirective,
    private readonly maCrossover: MaCrossoverDirective,
    private readonly priceAboveSma50: PriceAboveSma50Directive,
    // Stubs — Volatility
    private readonly bollinger: BollingerBandSqueezeDirective,
    private readonly volTools: VolatilityToolsDirective,
    // Stubs — Volume
    private readonly obv: ObvDirective,
    private readonly volumeSurge: VolumeSurgeDirective,
    private readonly volumeRhythm: VolumeRhythmDirective,
    // Stubs — Patterns
    private readonly doji: DojiPatternDirective,
    private readonly hammer: HammerPatternDirective,
    private readonly engulfing: EngulfingPatternDirective,
    private readonly pinBar: PinBarPatternDirective,
    private readonly threeSoldiers: ThreeSoldiersPatternDirective,
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
    private readonly bollingerBands: BollingerBandsDirective,
    private readonly vwap: VwapDirective,
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
    // Stubs — Momentum
    this.directivesService.register(this.stochastic);
    this.directivesService.register(this.cci);
    this.directivesService.register(this.mfi);
    this.directivesService.register(this.adx);
    this.directivesService.register(this.rsiOverbought);
    this.directivesService.register(this.momentumCont);
    // Stubs — Trend
    this.directivesService.register(this.movingAverages);
    this.directivesService.register(this.maCrossover);
    this.directivesService.register(this.priceAboveSma50);
    // Stubs — Volatility
    this.directivesService.register(this.bollinger);
    this.directivesService.register(this.volTools);
    // Stubs — Volume
    this.directivesService.register(this.obv);
    this.directivesService.register(this.volumeSurge);
    this.directivesService.register(this.volumeRhythm);
    // Stubs — Patterns
    this.directivesService.register(this.doji);
    this.directivesService.register(this.hammer);
    this.directivesService.register(this.engulfing);
    this.directivesService.register(this.pinBar);
    this.directivesService.register(this.threeSoldiers);
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
    this.directivesService.register(this.bollingerBands);
    this.directivesService.register(this.vwap);
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
