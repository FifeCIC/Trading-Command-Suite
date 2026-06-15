import { Module } from '@nestjs/common';
import { TrainingController } from './training.controller';
import { PatternDetectorService } from './pattern-detector.service';
import { DirectivesModule } from '../directives/directives.module';

@Module({
  imports: [DirectivesModule],
  controllers: [TrainingController],
  providers: [PatternDetectorService],
})
export class TrainingModule {}
