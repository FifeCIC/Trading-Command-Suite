import { Module, OnModuleInit } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ModeService } from '../../config/mode.service';
import { ProvidersController } from './providers.controller';
import { Mt5Controller } from './mt5.controller';
import { ProvidersService } from './providers.service';
import { AdapterFactory } from './adapter-factory';
import { AlpacaAdapter } from './adapters/alpaca.adapter';
import { AlphaVantageAdapter } from './adapters/alpha-vantage.adapter';
import { Trading212Adapter } from './adapters/trading212.adapter';
import { Mt5Adapter } from './adapters/mt5.adapter';

@Module({
  imports: [DatabaseModule],
  controllers: [ProvidersController, Mt5Controller],
  providers: [
    ProvidersService,
    ModeService,
    AdapterFactory,
    AlpacaAdapter,
    AlphaVantageAdapter,
    Trading212Adapter,
    Mt5Adapter,
  ],
  exports: [ProvidersService, AdapterFactory],
})
export class ProvidersModule implements OnModuleInit {
  constructor(private readonly adapterFactory: AdapterFactory) {}

  onModuleInit() {
    this.adapterFactory.register('alpaca', AlpacaAdapter, {
      name: 'Alpaca Markets',
      apiKeyEnv: 'ALPACA_API_KEY',
      baseUrl: 'https://paper-api.alpaca.markets',
      capabilities: ['quotes', 'candles', 'profiles'],
      failoverPriority: 10,
    });

    this.adapterFactory.register('alphavantage', AlphaVantageAdapter, {
      name: 'Alpha Vantage',
      apiKeyEnv: 'ALPHA_VANTAGE_API_KEY',
      baseUrl: 'https://www.alphavantage.co',
      capabilities: ['quotes', 'candles'],
      failoverPriority: 20,
    });

    this.adapterFactory.register('trading212', Trading212Adapter, {
      name: 'Trading212',
      apiKeyEnv: 'TRADING212_API_KEY',
      baseUrl: 'https://live.trading212.com/api/v0',
      capabilities: ['quotes', 'candles', 'trades'],
      failoverPriority: 30,
    });

    this.adapterFactory.register('mt5', Mt5Adapter, {
      name: 'MetaTrader 5',
      apiKeyEnv: 'MT5_ACCOUNT',
      baseUrl: process.env.MT5_BRIDGE_URL || 'http://localhost:5000',
      capabilities: ['quotes', 'candles'],
      failoverPriority: 40,
    });
  }
}
