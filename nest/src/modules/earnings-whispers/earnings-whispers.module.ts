import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { EarningsWhispersController } from './earnings-whispers.controller';
import { EarningsWhispersService } from './earnings-whispers.service';

@Module({
  imports: [DatabaseModule],
  controllers: [EarningsWhispersController],
  providers: [EarningsWhispersService],
  exports: [EarningsWhispersService],
})
export class EarningsWhispersModule {}
