import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DirectivesModule } from '../directives/directives.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CalibrationModule } from '../calibration/calibration.module';
import { AlgorithmLabController } from './algorithm-lab.controller';
import { ArenaController } from './arena.controller';
import { ProtocolsController } from './protocols.controller';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';
import { ScoreHistoryService } from './score-history.service';
import { ScoringSchedulerService } from './scoring-scheduler.service';
import { AveragingScorer } from './averaging-scorer';
import { StrategyCompetitionService } from './strategy-competition.service';
import { PredictiveScoringService } from './predictive-scoring.service';

@Module({
  imports: [DatabaseModule, DirectivesModule, NotificationsModule, CalibrationModule],
  controllers: [ScoringController, ArenaController, AlgorithmLabController, ProtocolsController],
  providers: [ScoringService, ScoreHistoryService, ScoringSchedulerService, AveragingScorer, StrategyCompetitionService, PredictiveScoringService],
  exports: [ScoringService, ScoreHistoryService, AveragingScorer, StrategyCompetitionService, PredictiveScoringService],
})
export class ScoringModule {}
