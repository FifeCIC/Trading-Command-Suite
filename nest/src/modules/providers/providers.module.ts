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
import { YahooFinanceAdapter } from './adapters/yahoo-finance.adapter';
import { PolygonAdapter } from './adapters/polygon.adapter';
import { FinnhubAdapter } from './adapters/finnhub.adapter';
import { TwelveDataAdapter } from './adapters/twelve-data.adapter';
import { FmpAdapter } from './adapters/fmp.adapter';
import { RateLimitGovernor } from './rate-limit-governor.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ProvidersController, Mt5Controller],
  providers: [
    ProvidersService,
    ModeService,
    AdapterFactory,
    RateLimitGovernor,
    AlpacaAdapter,
    AlphaVantageAdapter,
    Trading212Adapter,
    Mt5Adapter,
    YahooFinanceAdapter,
    PolygonAdapter,
    FinnhubAdapter,
    TwelveDataAdapter,
    FmpAdapter,
  ],
  exports: [ProvidersService, AdapterFactory, FinnhubAdapter, FmpAdapter, Mt5Adapter, AlphaVantageAdapter, RateLimitGovernor],
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
      baseUrl: process.env.MT5_BRIDGE_URL || 'http://localhost:5001',
      capabilities: ['quotes', 'candles'],
      failoverPriority: 40,
    });

    this.adapterFactory.register('yahoo', YahooFinanceAdapter, {
      name: 'Yahoo Finance',
      apiKeyEnv: '', // No API key required
      baseUrl: 'https://query1.finance.yahoo.com',
      capabilities: ['quotes', 'candles', 'profiles'],
      failoverPriority: 60,
    });

    this.adapterFactory.register('polygon', PolygonAdapter, {
      name: 'Polygon.io',
      apiKeyEnv: 'POLYGON_API_KEY',
      baseUrl: 'https://api.polygon.io',
      capabilities: ['quotes', 'candles', 'profiles'],
      failoverPriority: 45,
    });

    this.adapterFactory.register('finnhub', FinnhubAdapter, {
      name: 'Finnhub',
      apiKeyEnv: 'FINNHUB_API_KEY',
      baseUrl: 'https://finnhub.io/api/v1',
      capabilities: ['quotes', 'candles', 'profiles', 'news', 'fundamentals'],
      failoverPriority: 50,
    });

    this.adapterFactory.register('twelvedata', TwelveDataAdapter, {
      name: 'Twelve Data',
      apiKeyEnv: 'TWELVE_DATA_API_KEY',
      baseUrl: 'https://api.twelvedata.com',
      capabilities: ['quotes', 'candles'],
      failoverPriority: 55,
    });

    this.adapterFactory.register('fmp', FmpAdapter, {
      name: 'FMP',
      apiKeyEnv: 'FMP_API_KEY',
      baseUrl: 'https://financialmodelingprep.com/api/v3',
      capabilities: ['quotes', 'candles', 'profiles', 'fundamentals'],
      failoverPriority: 50,
    });
  }
}
