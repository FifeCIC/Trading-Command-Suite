import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DirectivesModule } from '../directives/directives.module';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';
import { ScoreHistoryService } from './score-history.service';
import { ScoringSchedulerService } from './scoring-scheduler.service';

@Module({
  imports: [DatabaseModule, DirectivesModule],
  controllers: [ScoringController],
  providers: [ScoringService, ScoreHistoryService, ScoringSchedulerService],
  exports: [ScoringService, ScoreHistoryService],
})
export class ScoringModule {}
