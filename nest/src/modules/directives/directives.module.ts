import { Module, OnModuleInit } from '@nestjs/common';
import { DirectivesService } from './directives.service';
import { DirectivesController } from './directives.controller';
import { ConditionDetectorService } from './condition-detector.service';
import { ProvidersModule } from '../providers/providers.module';
import { ResearchModule } from '../research/research.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { TimezoneService } from '../scoring/timezone.service';

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
// MT5 ported patterns
import { Mt5EngulfingDirective } from './implementations/mt5-engulfing.directive';
import { Mt5HaramiDirective } from './implementations/mt5-harami.directive';
import { Mt5StarDojiDirective } from './implementations/mt5-star-doji.directive';
import { Mt5HammerDirective } from './implementations/mt5-hammer.directive';
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
// Implemented — Divergence Suite (Sprint 2026-07-03)
import { RsiDivergenceDirective } from './implementations/rsi-divergence.directive';
import { MacdDivergenceDirective } from './implementations/macd-divergence.directive';
import { ObvDivergenceDirective } from './implementations/obv-divergence.directive';
// Implemented — VWAP Confluence (Simple + Bands)
import { VwapConfluenceSimpleDirective, VwapConfluenceBandsDirective } from './implementations/vwap-confluence.directive';
// Implemented — MTF Confluence (Conservative + Weighted)
import { MtfConfluenceConservativeDirective, MtfConfluenceWeightedDirective } from './implementations/mtf-confluence.directive';
// Implemented — Gap Scanner
import { GapScannerDirective } from './implementations/gap-scanner.directive';
import { VolumeSurgeDirective } from './implementations/volume-surge.directive';
import { BollingerBandSqueezeDirective } from './implementations/bollinger-squeeze.directive';
import { SupportResistanceLevelsDirective } from './implementations/support-resistance.directive';
import { OverheadSupplyPressureDirective } from './implementations/overhead-supply.directive';
import { PanicExhaustionAbsorptionDirective } from './implementations/panic-exhaustion.directive';
import { PriceActionDirective } from './implementations/price-action.directive';
import { MomentumContinuationComboDirective } from './implementations/momentum-continuation.directive';
import { SpeedMomentumDirective } from './implementations/speed-momentum.directive';
import { MultiTimeframeTrendDirective } from './implementations/multi-timeframe-trend.directive';
import { MicroSrLevelsDirective } from './implementations/micro-sr-levels.directive';
import { ConfluenceReversalComboDirective } from './implementations/confluence-reversal.directive';
import { ZigZagSwingDetectorDirective } from './implementations/zigzag-swing-detector.directive';
import { FibonacciLevelsDirective } from './implementations/fibonacci-levels.directive';
import { NewsSentimentPositiveDirective } from './implementations/news-sentiment.directive';
import { EarningsProximityDirective } from './implementations/earnings-proximity.directive';
import { VixRegimeDirective } from './implementations/vix-regime.directive';
import { DxyRegimeDirective } from './implementations/dxy-regime.directive';
import { GoldMacroCorrelationDirective } from './implementations/gold-macro-correlation.directive';
import { GoldRoundNumbersDirective } from './implementations/gold-round-numbers.directive';
import { GoldSessionProfileDirective } from './implementations/gold-session-profile.directive';
import { CadUsdOilCorrelationDirective } from './implementations/cad-usd-oil-correlation.directive';
import { VolatilityEnvelopeDirective } from './implementations/volatility-envelope.directive';
import { MomentumExhaustionDirective } from './implementations/momentum-exhaustion.directive';
import { TargetAchievedDirective } from './implementations/target-achieved.directive';
import { RegimeShiftExitDirective } from './implementations/regime-shift-exit.directive';
import { TimeStopDirective } from './implementations/time-stop.directive';
import { SessionOpenEffectDirective } from './implementations/session-open-effect.directive';
import { BudgetGateDirective } from './implementations/budget-gate.directive';
import { LiquidityCheckDirective } from './implementations/liquidity-check.directive';
import { EarningsMomentumDirective } from './implementations/earnings-momentum.directive';
import { SocialBuzzDirective } from './implementations/social-buzz.directive';
import { InsiderActivityDirective } from './implementations/insider-activity.directive';
import { DilutionImpactDirective } from './implementations/dilution-impact.directive';
import { RolloverRiskDirective } from './implementations/rollover-risk.directive';

// MT5 ported indicators (Q156 — 17 directives)
import { WilliamsRDirective } from './implementations/mt5-indicators.directives';
import { AwesomeOscillatorDirective } from './implementations/mt5-indicators.directives';
import { ForceIndexDirective } from './implementations/mt5-indicators.directives';
import { ChaikinMoneyFlowDirective } from './implementations/mt5-indicators.directives';
import { DonchianBreakoutDirective } from './implementations/mt5-indicators.directives';
import { KeltnerChannelDirective } from './implementations/mt5-indicators.directives';
import { SuperTrendDirective } from './implementations/mt5-indicators.directives';
import { ParabolicSARDirective } from './implementations/mt5-indicators.directives';
import { ADXDICrossoverDirective } from './implementations/mt5-indicators.directives';
import { BollingerPctBDirective } from './implementations/mt5-indicators.directives';
import { ATRTrailingStopDirective } from './implementations/mt5-indicators.directives';
import { WickFilterDirective } from './implementations/wick-filter.directive';
import { MomentumROCDirective } from './implementations/mt5-indicators.directives';
import { DeMarkerDirective } from './implementations/mt5-indicators.directives';
import { AccumulationDistDirective } from './implementations/mt5-indicators.directives';
import { BullsBearsPowerDirective } from './implementations/mt5-indicators.directives';
import { EaseOfMovementDirective } from './implementations/mt5-indicators.directives';
import { IchimokuCloudDirective } from './implementations/mt5-indicators.directives';

// Stubs (placeholder — PHP math at TradePress, awaiting NestJS port)
import {
  // Trend
  MovingAveragesDirective,
  // Volatility
  VolatilityToolsDirective,
  // Patterns (real implementation in stub file)
  PinBarPatternDirective,
  // Temporal / Calendar
  FridayPositioningDirective,
  MidweekMomentumDirective,
  AdvancedWeeklyRhythmDirective,
  SpyOptionsExpiryDirective,
  SpyMonthEndRebalancingDirective,
  SpyQqqRelativeStrengthDirective,
  // Crypto — now real implementations (see crypto-*.directive.ts)
  // Equity-Specific
  NvdaEarningsMomentumDirective,
  TslaSentimentAmplifierDirective,
  // Fundamental
  DividendYieldAttractiveDirective,
  // Composite
  // Risk / Support-Resistance
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

// Crypto (real implementations — unstubbed 2026-06-23)
import { CryptoFearGreedDirective } from './implementations/crypto-fear-greed.directive';
import { BtcHalvingCycleDirective } from './implementations/btc-halving-cycle.directive';
import { CryptoWeekendEffectDirective } from './implementations/crypto-weekend-effect.directive';
import { MarketRegimeDirective } from './implementations/market-regime.directive';
import { PositionSizeKellyDirective } from './implementations/position-size-kelly.directive';
import { PositionSizeConfidenceDirective } from './implementations/position-size-confidence.directive';

// Seasonality (real implementations — 2026-07-01)
import { SantaClausRallyDirective } from './implementations/santa-claus-rally.directive';
import { JanuaryEffectDirective } from './implementations/january-effect.directive';
import { SellInMayDirective } from './implementations/sell-in-may.directive';
import { SeptemberSlumpDirective } from './implementations/september-slump.directive';
import { OctoberReliefDirective } from './implementations/october-relief.directive';
import { MondayEffectDirective as MondayEffectRealDirective } from './implementations/monday-effect.directive';
import { FridayDriftDirective } from './implementations/friday-drift.directive';
import { TurnaroundTuesdayDirective } from './implementations/turnaround-tuesday.directive';
import { OpexGammaDirective } from './implementations/opex-gamma.directive';
import { TripleWitchingDirective } from './implementations/triple-witching.directive';
import { ElectionCycleDirective } from './implementations/election-cycle.directive';

@Module({
  imports: [ProvidersModule, ResearchModule, MarketDataModule],
  controllers: [DirectivesController],
  providers: [
    DirectivesService,
    ConditionDetectorService,
    TimezoneService,
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
    MomentumContinuationComboDirective,
    // Implemented — Speed / Scalp
    SpeedMomentumDirective,
    MultiTimeframeTrendDirective,
    MicroSrLevelsDirective,
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
    // Implemented — Divergence Suite (Sprint 2026-07-03)
    RsiDivergenceDirective,
    MacdDivergenceDirective,
    ObvDivergenceDirective,
    // Implemented — VWAP Confluence
    VwapConfluenceSimpleDirective,
    VwapConfluenceBandsDirective,
    // Implemented — MTF Confluence
    MtfConfluenceConservativeDirective,
    MtfConfluenceWeightedDirective,
    // Implemented — Gap Scanner
    GapScannerDirective,
    // Implemented — Patterns
    DojiPatternDirective,
    EngulfingPatternDirective,
    HammerPatternDirective,
    ThreeSoldiersPatternDirective,
    // MT5 ported patterns
    Mt5EngulfingDirective,
    Mt5HaramiDirective,
    Mt5StarDojiDirective,
    Mt5HammerDirective,
    // Patterns (real math — PinBarPatternDirective lives in placeholder-directives.stub.ts)
    PinBarPatternDirective,
    // Implemented — Macro
    VixRegimeDirective,
    DxyRegimeDirective,
    // MT5 Ported Indicators (Q156) — 17 new directives
    WilliamsRDirective,
    AwesomeOscillatorDirective,
    ForceIndexDirective,
    ChaikinMoneyFlowDirective,
    DonchianBreakoutDirective,
    KeltnerChannelDirective,
    SuperTrendDirective,
    ParabolicSARDirective,
    ADXDICrossoverDirective,
    BollingerPctBDirective,
    ATRTrailingStopDirective,
    WickFilterDirective,
    MomentumROCDirective,
    DeMarkerDirective,
    AccumulationDistDirective,
    BullsBearsPowerDirective,
    EaseOfMovementDirective,
    IchimokuCloudDirective,
    // Stubs — Macro
    GoldMacroCorrelationDirective,
    GoldRoundNumbersDirective,
    GoldSessionProfileDirective,
    CadUsdOilCorrelationDirective,
    // Stubs — Temporal
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
    MarketRegimeDirective,
    PositionSizeKellyDirective,
    PositionSizeConfidenceDirective,
    // Seasonality (real)
    SantaClausRallyDirective,
    JanuaryEffectDirective,
    SellInMayDirective,
    SeptemberSlumpDirective,
    OctoberReliefDirective,
    MondayEffectRealDirective,
    FridayDriftDirective,
    TurnaroundTuesdayDirective,
    OpexGammaDirective,
    TripleWitchingDirective,
    ElectionCycleDirective,
    // Stubs — Equity-Specific
    NvdaEarningsMomentumDirective,
    TslaSentimentAmplifierDirective,
    // Implemented — Fundamental
    NewsSentimentPositiveDirective,
    EarningsProximityDirective,
    // Stubs — Fundamental
    DividendYieldAttractiveDirective,
    // Implemented — Composite
    PriceActionDirective,
    ConfluenceReversalComboDirective,
    // Implemented — ZigZag (#284)
    ZigZagSwingDetectorDirective,
    FibonacciLevelsDirective,
    // Implemented — Risk
    SupportResistanceLevelsDirective,
    OverheadSupplyPressureDirective,
    PanicExhaustionAbsorptionDirective,
    // Stubs — Risk
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
    // Q232 — Volatility Envelope
    VolatilityEnvelopeDirective,
    // Q238 — Exit Signals
    MomentumExhaustionDirective,
    TargetAchievedDirective,
    RegimeShiftExitDirective,
    TimeStopDirective,
    SessionOpenEffectDirective,
    // Q304 — Risk Gates (implemented 2026-06-23)
    BudgetGateDirective,
    LiquidityCheckDirective,
    // Q304 — Fundamental / Sentiment (Finnhub free tier)
    EarningsMomentumDirective,
    SocialBuzzDirective,
    InsiderActivityDirective,
    DilutionImpactDirective,
    RolloverRiskDirective,
  ],
  exports: [
    DirectivesService,
    ConditionDetectorService,
    TimezoneService,
    // Q228 — Pattern Detector Service needs these
    DojiPatternDirective,
    EngulfingPatternDirective,
    HammerPatternDirective,
    ThreeSoldiersPatternDirective,
    Mt5EngulfingDirective,
    Mt5HaramiDirective,
    Mt5StarDojiDirective,
    Mt5HammerDirective,
  ],
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
    private readonly momentumCont: MomentumContinuationComboDirective,
    // Implemented — Speed / Scalp
    private readonly speedMomentum: SpeedMomentumDirective,
    private readonly multiTfTrend: MultiTimeframeTrendDirective,
    private readonly microSr: MicroSrLevelsDirective,
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
    // Divergence Suite (Sprint 2026-07-03)
    private readonly rsiDiv: RsiDivergenceDirective,
    private readonly macdDiv: MacdDivergenceDirective,
    private readonly obvDiv: ObvDivergenceDirective,
    // VWAP Confluence
    private readonly vwapSimple: VwapConfluenceSimpleDirective,
    private readonly vwapBands: VwapConfluenceBandsDirective,
    // MTF Confluence
    private readonly mtfConservative: MtfConfluenceConservativeDirective,
    private readonly mtfWeighted: MtfConfluenceWeightedDirective,
    // Gap Scanner
    private readonly gapScanner: GapScannerDirective,
    // Implemented — Patterns
    private readonly doji: DojiPatternDirective,
    private readonly engulfing: EngulfingPatternDirective,
    private readonly hammer: HammerPatternDirective,
    private readonly threeSoldiers: ThreeSoldiersPatternDirective,
    // MT5 ported patterns
    private readonly mt5Engulfing: Mt5EngulfingDirective,
    private readonly mt5Harami: Mt5HaramiDirective,
    private readonly mt5StarDoji: Mt5StarDojiDirective,
    private readonly mt5Hammer: Mt5HammerDirective,
    // Patterns (real math, in stub file)
    private readonly pinBar: PinBarPatternDirective,
    // Stubs — Temporal
    private readonly vixRegime: VixRegimeDirective,
    private readonly dxyRegime: DxyRegimeDirective,
    private readonly goldMacro: GoldMacroCorrelationDirective,
    private readonly goldRoundNumbers: GoldRoundNumbersDirective,
    private readonly goldSessionProfile: GoldSessionProfileDirective,
    private readonly cadUsdOil: CadUsdOilCorrelationDirective,
    // Stubs — Temporal
    private readonly mondayEffectReal: MondayEffectRealDirective,
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
    private readonly marketRegime: MarketRegimeDirective,
    private readonly positionSizeKelly: PositionSizeKellyDirective,
    private readonly positionSizeConfidence: PositionSizeConfidenceDirective,
    // Stubs — Equity-Specific
    private readonly nvdaEarnings: NvdaEarningsMomentumDirective,
    private readonly tslaSentiment: TslaSentimentAmplifierDirective,
    // Implemented — Fundamental
    private readonly newsSentiment: NewsSentimentPositiveDirective,
    private readonly earningsProx: EarningsProximityDirective,
    // Stubs — Fundamental
    private readonly dividend: DividendYieldAttractiveDirective,
    // Implemented — Composite
    private readonly priceAction: PriceActionDirective,
    private readonly confluence: ConfluenceReversalComboDirective,
    private readonly zigzag: ZigZagSwingDetectorDirective,
    private readonly fibLevels: FibonacciLevelsDirective,
    // Implemented — Risk
    private readonly supportResist: SupportResistanceLevelsDirective,
    private readonly overheadSupply: OverheadSupplyPressureDirective,
    private readonly panicExhaust: PanicExhaustionAbsorptionDirective,
    // Stubs — Risk
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
    private readonly volEnvelope: VolatilityEnvelopeDirective,
    private readonly momentumExhaust: MomentumExhaustionDirective,
    private readonly wickFilter: WickFilterDirective,
    private readonly targetAchieved: TargetAchievedDirective,
    private readonly regimeShiftExit: RegimeShiftExitDirective,
    private readonly timeStop: TimeStopDirective,
    private readonly sessionOpenEffect: SessionOpenEffectDirective,
    private readonly budgetGate: BudgetGateDirective,
    private readonly liquidityCheck: LiquidityCheckDirective,
    // Q304 — Fundamental / Sentiment (Finnhub)
    private readonly earningsMomentum: EarningsMomentumDirective,
    private readonly socialBuzz: SocialBuzzDirective,
    private readonly insiderActivity: InsiderActivityDirective,
    private readonly dilutionImpact: DilutionImpactDirective,
    private readonly rolloverRisk: RolloverRiskDirective,
  ) {}

  async onModuleInit() {
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
    this.directivesService.register(this.momentumCont);
    // Implemented — Speed / Scalp
    this.directivesService.register(this.speedMomentum);
    this.directivesService.register(this.multiTfTrend);
    this.directivesService.register(this.microSr);
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
    // Divergence Suite (Sprint 2026-07-03)
    this.directivesService.register(this.rsiDiv);
    this.directivesService.register(this.macdDiv);
    this.directivesService.register(this.obvDiv);
    // VWAP Confluence
    this.directivesService.register(this.vwapSimple);
    this.directivesService.register(this.vwapBands);
    // MTF Confluence
    this.directivesService.register(this.mtfConservative);
    this.directivesService.register(this.mtfWeighted);
    // Gap Scanner
    this.directivesService.register(this.gapScanner);
    // Implemented — Patterns
    this.directivesService.register(this.doji);
    this.directivesService.register(this.hammer);
    this.directivesService.register(this.engulfing);
    this.directivesService.register(this.threeSoldiers);
    // MT5 ported patterns
    this.directivesService.register(this.mt5Engulfing);
    this.directivesService.register(this.mt5Harami);
    this.directivesService.register(this.mt5StarDoji);
    this.directivesService.register(this.mt5Hammer);
    // Real candlestick patterns registered above
    // PinBar (real math, in stub file)
    this.directivesService.register(this.pinBar);
    // Implemented — Macro
    this.directivesService.register(this.vixRegime);
    this.directivesService.register(this.dxyRegime);
    this.directivesService.register(this.goldMacro);
    this.directivesService.register(this.goldRoundNumbers);
    this.directivesService.register(this.goldSessionProfile);
    this.directivesService.register(this.cadUsdOil);
    // Stubs — Macro
    // Temporal — real (not stub)
    this.directivesService.register(this.mondayEffectReal);
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
    this.directivesService.register(this.marketRegime);
    this.directivesService.register(this.positionSizeKelly);
    this.directivesService.register(this.positionSizeConfidence);
    // Stubs — Equity-Specific
    this.directivesService.register(this.nvdaEarnings);
    this.directivesService.register(this.tslaSentiment);
    // Implemented — Fundamental
    this.directivesService.register(this.newsSentiment);
    this.directivesService.register(this.earningsProx);
    // Stubs — Fundamental
    this.directivesService.register(this.dividend);
    // Implemented — Composite
    this.directivesService.register(this.priceAction);
    this.directivesService.register(this.confluence);
    this.directivesService.register(this.zigzag);
    this.directivesService.register(this.fibLevels);
    // Implemented — Risk
    this.directivesService.register(this.supportResist);
    this.directivesService.register(this.overheadSupply);
    this.directivesService.register(this.panicExhaust);
    // Stubs — Risk
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
    this.directivesService.register(this.volEnvelope);
    // Q238 — Exit Signals
    this.directivesService.register(this.momentumExhaust);
    this.directivesService.register(this.wickFilter);
    this.directivesService.register(this.targetAchieved);
    this.directivesService.register(this.regimeShiftExit);
    this.directivesService.register(this.timeStop);
    this.directivesService.register(this.sessionOpenEffect);
    // Q304 — Risk Gates
    this.directivesService.register(this.budgetGate);
    this.directivesService.register(this.liquidityCheck);
    // Q304 — Fundamental / Sentiment
    this.directivesService.register(this.earningsMomentum);
    this.directivesService.register(this.socialBuzz);
    this.directivesService.register(this.insiderActivity);
    this.directivesService.register(this.dilutionImpact);
    this.directivesService.register(this.rolloverRisk);

    // ── Load DB metadata onto in-memory registry (Epic #510 Phase 2) ──
    await this.directivesService.loadDirectiveMetadata();
  }
}
