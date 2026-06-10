import { Module } from '@nestjs/common';
import { StrategiesService } from './strategies.service';

@Module({
  providers: [StrategiesService],
  exports: [StrategiesService],
})
export class StrategiesModule {}
