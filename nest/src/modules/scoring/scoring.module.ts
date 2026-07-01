import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DirectivesModule } from '../directives/directives.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CalibrationModule } from '../calibration/calibration.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { ProvidersModule } from '../providers/providers.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { AlgorithmLabController } from './algorithm-lab.controller';
import { ArenaController } from './arena.controller';
import { ProtocolsController } from './protocols.controller';
import { ProtocolGatingController } from './protocol-gating.controller';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';
import { ScoreHistoryService } from './score-history.service';
import { ScoringSchedulerService } from './scoring-scheduler.service';
import { AveragingScorer } from './averaging-scorer';
import { StrategyCompetitionService } from './strategy-competition.service';
import { PredictiveScoringService } from './predictive-scoring.service';
import { ProtocolGatingService } from './protocol-gating.service';
import { OutcomeTrackerService } from './outcome-tracker.service';
import { SpeedScanService } from './speed-scan.service';
import { SpeedScanController } from './speed-scan.controller';
import { SeasonalityService } from './seasonality.service';
import { SeasonalityController } from './seasonality.controller';
import { SeasonalAffinityService } from './seasonal-affinity.service';
import { TickRecorderService } from './tick-recorder.service';

@Module({
  imports: [DatabaseModule, DirectivesModule, NotificationsModule, CalibrationModule, MarketDataModule, ProvidersModule, forwardRef(() => PortfolioModule)],
  controllers: [ScoringController, ArenaController, AlgorithmLabController, ProtocolsController, ProtocolGatingController, SpeedScanController, SeasonalityController],
  providers: [ScoringService, ScoreHistoryService, ScoringSchedulerService, AveragingScorer, StrategyCompetitionService, PredictiveScoringService, ProtocolGatingService, OutcomeTrackerService, SpeedScanService, SeasonalityService, SeasonalAffinityService, TickRecorderService],
  exports: [ScoringService, ScoreHistoryService, AveragingScorer, StrategyCompetitionService, PredictiveScoringService, ProtocolGatingService, OutcomeTrackerService, SpeedScanService, SeasonalityService, SeasonalAffinityService, TickRecorderService],
})
export class ScoringModule {}
