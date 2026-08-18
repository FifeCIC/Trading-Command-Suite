import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SuitabilityController } from './suitability.controller';
import { SuitabilityService } from './suitability.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SuitabilityController],
  providers: [SuitabilityService],
  exports: [SuitabilityService],
})
export class SuitabilityModule {}
