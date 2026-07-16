import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DiversificationController } from './diversification.controller';
import { GlobalDiversificationService } from './global-diversification.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DiversificationController],
  providers: [GlobalDiversificationService],
  exports: [GlobalDiversificationService],
})
export class DiversificationModule {}
