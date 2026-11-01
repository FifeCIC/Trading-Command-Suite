import { Module, OnModuleInit } from '@nestjs/common';
import { DirectivesService } from './directives.service';
import { DirectiveConfigService } from '../scoring/directive-config.service';
import { DirectivesController } from './directives.controller';
import { ConditionDetectorService } from './condition-detector.service';
import { ProvidersModule } from '../providers/providers.module';
import { ResearchModule } from '../research/research.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { TimezoneService } from '../scoring/timezone.service';
import { CalendarModule } from '../calendar/calendar.module';
import { MarketSessionsService } from '../calendar/market-sessions.service';

// Implemented (real math)
import { RsiOversoldDirective } from './implementations/rsi-oversold.directive';
// ⚠️ REGISTERED 2026-11-01 (#1169): a protocol preset (protocol-presets.ts:41) and a strategy seed
// (strategy-seeds.ts 'Forex Session Trader') both name this id, and the class was never instantiated —
// so that protocol silently scored one fewer directive than it declared. See
// scripts/validate-directive-id-references.cjs, which now fails the build on a dangling id.
import { SessionTimingFilterDirective } from './implementations/session-timing-filter.directive';
// REGISTERED 2026-11-01 (#1169) for the same reason: a strategy seed names price-above-sma-50. It is
// NOT retired - the retirement pattern in this repo is to stay REGISTERED and return the retired-claim
// helper (see the seven #879 calendar claims), which this class does not do. It was simply never
// instantiated.
import { PriceAboveSma50Directive } from './implementations/momentum-and-macro.directives';
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
import { StochRsiDirective } from './implementations/stoch-rsi.directive';
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
import { EarningsProximityDirective } from './implementations/earnings-proximity.directive';
import { DxyRegimeDirective } from './implementations/dxy-regime.directive';
// ── Precious Metals / Commodity-Specific (XAUUSD, XAGUSD) ─────────────────
// These directives only score gold/silver symbols.  They are registered as
// symbol-specific (nature='symbol-specific') in the DB and carry elevated
// weight multipliers for XAUUSD in prisma/seed.ts calibrations.
// Added 2026-07-28 to support Gold Macro Regime Strategy.
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

// ── Directive library wiring (#1169) ────────────────────────────────────────────────────────────
// ── DECISION (2026-11-01, primary) ──
// WHAT:      A directive class in `implementations/` is either REGISTERED or DELETED — no third state.
//            Where two implementations of one indicator existed, the survivor carries a MEASURED
//            maxScore ceiling (#1131) or a seed reference; the other file is removed.
// WHY:       50 of 161 classes were reachable by nothing. `audit-directive-depth` ranked two of them
//            TOP TWO by tunable headroom, and `williams-r` had already been parameterised and given a
//            BASELINE while unreachable — the parameters tuned nothing, and a protocol that names it
//            silently scored one directive fewer than it declared. A headroom ranking that recommends
//            dead code is a plausible number with no error behind it.
// INSTEAD OF: Registering every unregistered class. Two of them duplicate an id or an indicator, and
//            registering a duplicate scores one signal twice inside a composite.
// REVERSE BY: Deleting the `register()` call and recreating the file from git history (`git show
//            HEAD^:…`). Nothing in the database stores which class files exist, so reversal is a code
//            revert; the only data effect is `seedToDatabase()` adding/removing `directive` rows.
// REGISTER:  docs/SETTLED-DECISIONS.md row 111
// GUARD:     nest/scripts/validate-directive-registration.cjs (prebuild; --self-test canaries both
//            directions AND the aliased-import case)
//
// These classes were written, compiled, conformance-clean and reachable by NOTHING: no `register()`
// call, so `runAll(filter)` could never resolve them and no protocol could select them. Measured
// 2026-11-01, 40 NEVER-WIRED classes.
//
// ⚠️ Registering is SCORE-NEUTRAL except where a seed already names the id. Four do — `williams-r`
// (directive-groups.ts) and `bollinger-pct-b`, `donchian-breakout`, `momentum-roc`
// (strategy-seeds.ts) — and for those the seeded intent was a directive that silently contributed
// nothing. Registering restores that intent; it is a bug fix, not a knob change.
//
// ⚠️ Do NOT register a class that duplicates a live `id` — two instances of one signal inflate a
// composite's denominator. The duplicates were deleted instead (see the note further down).
import { CandlePressureDirective } from './implementations/candle-pressure.directive';
import { FairValueGapDirective } from './implementations/fair-value-gap.directive';
import { FallingRiskPyramidDirective } from './implementations/falling-risk-pyramid.directive';
import { FxTimingDirective } from './implementations/fx-timing.directive';
import { HurstMemoryDirective } from './implementations/hurst-memory.directive';
import { InstitutionalFootprintDirective } from './implementations/institutional-footprint.directive';
import { LiquiditySweepDirective } from './implementations/liquidity-sweep.directive';
import { MarketEntropyDirective } from './implementations/market-entropy.directive';
import { MarketMemoryZonesDirective } from './implementations/market-memory-zones.directive';
import { MarketStructureBosDirective } from './implementations/market-structure-bos.directive';
import { Mt5DarkCloudPiercingDirective } from './implementations/mt5-dark-cloud-piercing.directive';
import { Mt5EngulfingCciDirective } from './implementations/mt5-engulfing-cci.directive';
import { PatternDensitySrDirective } from './implementations/pattern-density-sr.directive';
import { PriceTimeGapDirective } from './implementations/price-time-gap.directive';
import { RangeContractionDirective } from './implementations/range-contraction.directive';
import { SigmaScoreDirective } from './implementations/sigma-score.directive';
import { VolumeBoundaryDirective } from './implementations/volume-boundary.directive';
// Chandelier Exit — stop-quality evidence for StopGuardianService (#890).
// This file was written and spec-tested but never imported anywhere, so it could
// never be registered. See STOP_GUARDIAN_DIRECTIVES in stop-guardian.service.ts.
import { ChandelierExitDirective } from './implementations/chandelier-exit.directive';

// ── Surge family (#663 "Trade a Surge") ──────────────────────────────────────────────────────
// Registered 2026-10-01. ⚠️ Registering a directive is additive; ATTACHING one to a live protocol
// changes what a tradeable symbol scores and is therefore a maths change needing a copied config
// and a monitored comparison (`maths-change-requires-ab.instructions.md`). These are registered and
// deliberately NOT attached — see the header of surge.directive.ts.
import {
  SurgeDetectionDirective,
  SpikeHoldConfirmationDirective,
  SurgeExhaustionDirective,
} from './implementations/surge.directive';

// News catalyst (#4 / #630 / #512). ⚠️ INERT until a producer populates `input.news` from
// `news_item` — the directive is correct and testable, but abstains on every live call without it.
import { NewsCatalystDirective } from './implementations/news-catalyst.directive';

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
} from './implementations/momentum-and-macro.directives';

// Crypto (real implementations — unstubbed 2026-06-23)
import { CryptoFearGreedDirective } from './implementations/crypto-fear-greed.directive';
import { BtcHalvingCycleDirective } from './implementations/btc-halving-cycle.directive';
import { CryptoWeekendEffectDirective } from './implementations/crypto-weekend-effect.directive';
import { MarketRegimeDirective } from './implementations/market-regime.directive';
import { PositionSizeKellyDirective } from './implementations/position-size-kelly.directive';
import { PositionSizeConfidenceDirective } from './implementations/position-size-confidence.directive';

// Seasonality — the ONE that survived measurement (#879). `monday-effect` stays registered on
// purpose: it returns an explicit zero with `unmeasured: true`, so a stored protocol reference still
// resolves. The other seasonal "claims" never reproduced and are DELETED (#1169) rather than left as
// unreachable files — a class that nothing registers is indistinguishable from one that does not exist,
// and keeping ten of them is how the registration count drifted to 161 declared / 111 live.
import { MondayEffectDirective as MondayEffectRealDirective } from './implementations/monday-effect.directive';
// 2026-09-18 — replaces the refuted Friday session-drift claim with a MEASURED weekend gap bias,
// corrected against the same symbol's weekday gaps so a bar-source skew cannot masquerade as an edge.
import { WeekendGapBiasDirective } from './implementations/weekend-gap-bias.directive';

@Module({
  imports: [ProvidersModule, ResearchModule, MarketDataModule, CalendarModule],
  controllers: [DirectivesController],
  providers: [
    DirectivesService,
    DirectiveConfigService,
    ConditionDetectorService,
    TimezoneService,
    // Implemented
    RsiOversoldDirective,
    SessionTimingFilterDirective,
    PriceAboveSma50Directive,
    MacdCrossoverDirective,
    EmaStructureDirective,
    AtrDipDirective,
    VolumeConfirmationDirective,
    // Implemented — Momentum
    MfiDirective,
    AdxDirective,
    StochasticDirective,
    StochRsiDirective,
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
    // Patterns (real math — PinBarPatternDirective lives in momentum-and-macro.directives.ts)
    PinBarPatternDirective,
    // Implemented — Macro
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
    ChandelierExitDirective,
    // Surge family (#663). `readiness: 'alpha'` on all three — unvalidated, so they must not
    // raise any protocol's tier, and a protocol can only claim its WEAKEST directive's readiness.
    SurgeDetectionDirective,
    SpikeHoldConfirmationDirective,
    SurgeExhaustionDirective,
    NewsCatalystDirective,
    MomentumROCDirective,
    DeMarkerDirective,
    AccumulationDistDirective,
    BullsBearsPowerDirective,
    EaseOfMovementDirective,
    IchimokuCloudDirective,
    // Never-wired library classes, now registerable (#1169). Each is a SINGLE-class file so its
    // tuning constants are unambiguous — the depth audit warns that attribution is file-wide in
    // multi-class files, which is exactly the MT5 indicators file.
    CandlePressureDirective,
    FairValueGapDirective,
    FallingRiskPyramidDirective,
    FxTimingDirective,
    HurstMemoryDirective,
    InstitutionalFootprintDirective,
    LiquiditySweepDirective,
    MarketEntropyDirective,
    MarketMemoryZonesDirective,
    MarketStructureBosDirective,
    Mt5DarkCloudPiercingDirective,
    Mt5EngulfingCciDirective,
    PatternDensitySrDirective,
    PriceTimeGapDirective,
    RangeContractionDirective,
    SigmaScoreDirective,
    VolumeBoundaryDirective,
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
    // Seasonality — only the directives that survived measurement are still wired (#879, #1169)
    MondayEffectRealDirective,
    // 2026-09-18 — replaces the refuted Friday session-drift claim with a MEASURED weekend
    // gap bias, corrected against the same symbol's weekday gaps so a bar-source skew cannot
    // masquerade as an edge. See the class comment and issue #879.
    WeekendGapBiasDirective,
    // Stubs — Equity-Specific
    NvdaEarningsMomentumDirective,
    TslaSentimentAmplifierDirective,
    // Implemented — Fundamental
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
    DirectiveConfigService,
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
    private readonly configService: DirectiveConfigService,
    // Implemented
    private readonly rsi: RsiOversoldDirective,
    private readonly sessionTimingFilter: SessionTimingFilterDirective,
    private readonly priceAboveSma50: PriceAboveSma50Directive,
    private readonly macd: MacdCrossoverDirective,
    private readonly ema: EmaStructureDirective,
    private readonly atrDip: AtrDipDirective,
    private readonly volume: VolumeConfirmationDirective,
    // Implemented — Momentum
    private readonly mfi: MfiDirective,
    private readonly adx: AdxDirective,
    private readonly stochastic: StochasticDirective,
    private readonly stochRsi: StochRsiDirective,
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
    // ⚠️ #890 — these three are the Stop Guardian's remaining evidence inputs.
    // They sat in `providers` (constructed, unreferenced) but register() was never
    // called, so `runAll(filter)` could not resolve them and the guardian's
    // stopConfidence was computed from wick-filter ALONE against a >=55 threshold
    // calibrated for four signals. Registering is SCORE-NEUTRAL: no protocol
    // references these IDs in protocol_directive_entry, and every runAll() call
    // site passes a filter (scoring.service.ts:366, protocol-gating.service.ts:568).
    private readonly superTrend: SuperTrendDirective,
    private readonly atrTrailingStop: ATRTrailingStopDirective,
    private readonly chandelierExit: ChandelierExitDirective,
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
    // Surge family (#663) + news catalyst (#4/#630/#512). ⚠️ These were added to `providers` and
    // NOT injected or registered, so they never reached the registry and `GET /api/directives`
    // reported 105 while the four classes existed and compiled. Injecting them is what makes
    // `register()` below possible — see the #890 note further down: being in `providers` is not
    // the same as being registered.
    private readonly surgeDetection: SurgeDetectionDirective,
    private readonly spikeHoldConfirmation: SpikeHoldConfirmationDirective,
    private readonly surgeExhaustion: SurgeExhaustionDirective,
    private readonly newsCatalyst: NewsCatalystDirective,
    // ── #1169 — the never-wired library ──────────────────────────────────────────────────────────
    // MT5 Q156 indicators. The module has imported these and listed them as providers since the port,
    // but never injected or registered them, so 14 of the 17 could not score. Three of them
    // (`bollinger-pct-b`, `donchian-breakout`, `momentum-roc`) are ALSO named by `strategy-seeds.ts`
    // and `williams-r` by `directive-groups.ts` — the seeded intent was a directive that silently
    // contributed nothing.
    private readonly williamsR: WilliamsRDirective,
    private readonly awesomeOscillator: AwesomeOscillatorDirective,
    private readonly forceIndex: ForceIndexDirective,
    private readonly chaikinMf: ChaikinMoneyFlowDirective,
    private readonly donchianBreakout: DonchianBreakoutDirective,
    private readonly keltnerChannel: KeltnerChannelDirective,
    private readonly parabolicSar: ParabolicSARDirective,
    private readonly adxDiCrossover: ADXDICrossoverDirective,
    private readonly bollingerPctB: BollingerPctBDirective,
    private readonly momentumRoc: MomentumROCDirective,
    private readonly deMarker: DeMarkerDirective,
    private readonly accumulationDist: AccumulationDistDirective,
    private readonly bullsBearsPower: BullsBearsPowerDirective,
    private readonly easeOfMovement: EaseOfMovementDirective,
    private readonly ichimokuCloud: IchimokuCloudDirective,
    // Single-class library directives that were reachable by nothing.
    private readonly candlePressure: CandlePressureDirective,
    private readonly fairValueGap: FairValueGapDirective,
    private readonly fallingRiskPyramid: FallingRiskPyramidDirective,
    private readonly fxTiming: FxTimingDirective,
    private readonly hurstMemory: HurstMemoryDirective,
    private readonly institutionalFootprint: InstitutionalFootprintDirective,
    private readonly liquiditySweep: LiquiditySweepDirective,
    private readonly marketEntropy: MarketEntropyDirective,
    private readonly marketMemoryZones: MarketMemoryZonesDirective,
    private readonly marketStructureBos: MarketStructureBosDirective,
    private readonly mt5DarkCloudPiercing: Mt5DarkCloudPiercingDirective,
    private readonly mt5EngulfingCci: Mt5EngulfingCciDirective,
    private readonly patternDensitySr: PatternDensitySrDirective,
    private readonly priceTimeGap: PriceTimeGapDirective,
    private readonly rangeContraction: RangeContractionDirective,
    private readonly sigmaScore: SigmaScoreDirective,
    private readonly volumeBoundary: VolumeBoundaryDirective,
    // ⚠️ `alpha` — registration makes it SELECTABLE and callable; `classifyDirectiveInclusion` keeps
    // alpha out of the composite, so it cannot raise a protocol's tier. Same rule as the surge family.
    private readonly weekendGapBias: WeekendGapBiasDirective,
  ) {}

  async onModuleInit() {
    // Implemented
    this.directivesService.register(this.rsi);
    this.directivesService.register(this.sessionTimingFilter);
    this.directivesService.register(this.priceAboveSma50);
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
    this.directivesService.register(this.dxyRegime);
    // ── Precious Metals (XAUUSD/XAGUSD) — added 2026-07-28 ──
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
    // ⚠️ #890 — the Stop Guardian reads these four IDs by name. Registration is
    // what makes them resolvable; without it the guardian gets `undefined` and
    // reads that as "no evidence" (silent, not an error).
    this.directivesService.register(this.superTrend);
    this.directivesService.register(this.atrTrailingStop);
    this.directivesService.register(this.chandelierExit);
    this.directivesService.register(this.targetAchieved);
    this.directivesService.register(this.regimeShiftExit);
    this.directivesService.register(this.timeStop);
    this.directivesService.register(this.sessionOpenEffect);
    // StochRSI crossover (owner request 2026-09-25). Directional by the %K/%D cross with no score
    // cliff — see the file header for the fault it is built to avoid.
    this.directivesService.register(this.stochRsi);
    // Q304 — Risk Gates
    this.directivesService.register(this.budgetGate);
    this.directivesService.register(this.liquidityCheck);
    // Q304 — Fundamental / Sentiment
    this.directivesService.register(this.earningsMomentum);
    this.directivesService.register(this.socialBuzz);
    this.directivesService.register(this.insiderActivity);
    this.directivesService.register(this.dilutionImpact);
    this.directivesService.register(this.rolloverRisk);

    // ── Surge family (#663 "Trade a Surge") ────────────────────────────────────────────────────
    // ⚠️ `readiness: 'alpha'` on all three. Registration makes them VISIBLE and callable; it does
    // NOT attach them to any protocol. Attaching one would change what a live symbol scores —
    // that is a maths change and needs a copied configuration, not an edit here.
    this.directivesService.register(this.surgeDetection);
    this.directivesService.register(this.spikeHoldConfirmation);
    this.directivesService.register(this.surgeExhaustion);
    // News catalyst (#4 / #630 / #512). ⚠️ INERT: correct and unit-tested, but it ABSTAINS
    // (`unmeasured: true`) until a producer populates `input.news` from `news_item`. Registered
    // so the surface can show it and so `requiredDataFeeds: ['news']` is queryable.
    this.directivesService.register(this.newsCatalyst);

    // ── #1169 — the never-wired library, now reachable ──────────────────────────────────────────
    // ⚠️ Registration makes a directive SELECTABLE; it does not attach it to any protocol. The four
    // ids a seed already names are the exception: those protocols/strategies score one directive more
    // than they did before, which is the seeded intent finally being honoured.
    this.directivesService.register(this.williamsR);
    this.directivesService.register(this.awesomeOscillator);
    this.directivesService.register(this.forceIndex);
    this.directivesService.register(this.chaikinMf);
    this.directivesService.register(this.donchianBreakout);
    this.directivesService.register(this.keltnerChannel);
    this.directivesService.register(this.parabolicSar);
    this.directivesService.register(this.adxDiCrossover);
    this.directivesService.register(this.bollingerPctB);
    this.directivesService.register(this.momentumRoc);
    this.directivesService.register(this.deMarker);
    this.directivesService.register(this.accumulationDist);
    this.directivesService.register(this.bullsBearsPower);
    this.directivesService.register(this.easeOfMovement);
    this.directivesService.register(this.ichimokuCloud);
    this.directivesService.register(this.candlePressure);
    this.directivesService.register(this.fairValueGap);
    this.directivesService.register(this.fallingRiskPyramid);
    this.directivesService.register(this.fxTiming);
    this.directivesService.register(this.hurstMemory);
    this.directivesService.register(this.institutionalFootprint);
    this.directivesService.register(this.liquiditySweep);
    this.directivesService.register(this.marketEntropy);
    this.directivesService.register(this.marketMemoryZones);
    this.directivesService.register(this.marketStructureBos);
    this.directivesService.register(this.mt5DarkCloudPiercing);
    this.directivesService.register(this.mt5EngulfingCci);
    this.directivesService.register(this.patternDensitySr);
    this.directivesService.register(this.priceTimeGap);
    this.directivesService.register(this.rangeContraction);
    this.directivesService.register(this.sigmaScore);
    this.directivesService.register(this.volumeBoundary);
    this.directivesService.register(this.weekendGapBias);

    // ── Seed directive table with latest class defaults (activates stubbed directives) ──
    await this.directivesService.seedToDatabase();

    // ── Load DB metadata onto in-memory registry (Epic #510 Phase 2) ──
    await this.directivesService.loadDirectiveMetadata();

    // ── Seed directive config into global_setting (Phase 2 — user-adjustable) ──
    const allDirectives = this.directivesService.list();
    await this.configService.seedFromDefaults(
      allDirectives.map((d) => ({
        id: d.id,
        maxScore: d.maxScore,
        category: (d as any).category,
        minScore: (d as any).minScore,
        directionBias: d.directionBias,
        priority: d.priority,
      })),
    );

    // ── Merge DB overrides onto in-memory directives ──
    await this.directivesService.loadDbOverrides();
  }
}
