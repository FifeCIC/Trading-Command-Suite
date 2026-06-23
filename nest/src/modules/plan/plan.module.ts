import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PlanService } from './plan.service';
import { PlanController } from './plan.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [PlanController],
  providers: [PlanService],
  exports: [PlanService],
})
export class PlanModule {}
