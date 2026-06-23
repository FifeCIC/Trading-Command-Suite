import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DirectivesModule } from '../directives/directives.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CalibrationModule } from '../calibration/calibration.module';
import { MarketDataModule } from '../market-data/market-data.module';
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

@Module({
  imports: [DatabaseModule, DirectivesModule, NotificationsModule, CalibrationModule, MarketDataModule, forwardRef(() => PortfolioModule)],
  controllers: [ScoringController, ArenaController, AlgorithmLabController, ProtocolsController, ProtocolGatingController, SpeedScanController],
  providers: [ScoringService, ScoreHistoryService, ScoringSchedulerService, AveragingScorer, StrategyCompetitionService, PredictiveScoringService, ProtocolGatingService, OutcomeTrackerService, SpeedScanService],
  exports: [ScoringService, ScoreHistoryService, AveragingScorer, StrategyCompetitionService, PredictiveScoringService, ProtocolGatingService, OutcomeTrackerService, SpeedScanService],
})
export class ScoringModule {}
