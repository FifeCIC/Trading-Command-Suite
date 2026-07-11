import { Module } from '@nestjs/common';
import { ReplayController } from './replay.controller';
import { ReplayService } from './replay.service';
import { DatabaseModule } from '../../database/database.module';
import { DirectivesModule } from '../directives/directives.module';
import { ScoringModule } from '../scoring/scoring.module';

@Module({
  imports: [DatabaseModule, DirectivesModule, ScoringModule],
  controllers: [ReplayController],
  providers: [ReplayService],
  exports: [ReplayService],
})
export class ReplayModule {}
