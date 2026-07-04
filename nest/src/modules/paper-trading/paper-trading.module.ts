import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PaperTradingService } from './paper-trading.service';
import { PaperTradingController } from './paper-trading.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [PaperTradingController],
  providers: [PaperTradingService],
  exports: [PaperTradingService],
})
export class PaperTradingModule {}
