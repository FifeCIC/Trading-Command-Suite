/**
 * RoadmapModule — dynamic roadmap interactive state (epic #681, Phase D).
 * The GitHub snapshot is produced at build time (scripts/roadmap-sync.cjs);
 * this module persists only what the board changes.
 */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { RoadmapService } from './roadmap.service';
import { RoadmapController } from './roadmap.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [RoadmapController],
  providers: [RoadmapService],
  exports: [RoadmapService],
})
export class RoadmapModule {}
