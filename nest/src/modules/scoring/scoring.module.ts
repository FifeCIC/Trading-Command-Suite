import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DirectivesModule } from '../directives/directives.module';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';

@Module({
  imports: [DatabaseModule, DirectivesModule],
  controllers: [ScoringController],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class ScoringModule {}
