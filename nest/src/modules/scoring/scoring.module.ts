import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DirectivesModule } from '../directives/directives.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AlgorithmLabController } from './algorithm-lab.controller';
import { ArenaController } from './arena.controller';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';
import { ScoreHistoryService } from './score-history.service';
import { ScoringSchedulerService } from './scoring-scheduler.service';
import { AveragingScorer } from './averaging-scorer';
import { StrategyCompetitionService } from './strategy-competition.service';

@Module({
  imports: [DatabaseModule, DirectivesModule, NotificationsModule],
  controllers: [ScoringController, ArenaController, AlgorithmLabController],
  providers: [ScoringService, ScoreHistoryService, ScoringSchedulerService, AveragingScorer, StrategyCompetitionService],
  exports: [ScoringService, ScoreHistoryService, AveragingScorer, StrategyCompetitionService],
})
export class ScoringModule {}
