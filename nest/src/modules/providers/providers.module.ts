import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ModeService } from '../../config/mode.service';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { AlpacaAdapter } from './adapters/alpaca.adapter';
import { AlphaVantageAdapter } from './adapters/alpha-vantage.adapter';
import { Trading212Adapter } from './adapters/trading212.adapter';

@Module({
  imports: [DatabaseModule],
  controllers: [ProvidersController],
  providers: [
    ProvidersService,
    ModeService,
    AlpacaAdapter,
    AlphaVantageAdapter,
    Trading212Adapter,
  ],
  exports: [ProvidersService],
})
export class ProvidersModule {}
