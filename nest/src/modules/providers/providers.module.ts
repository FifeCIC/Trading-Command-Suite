import { Module, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
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
import { Mt5ConnectionManager } from './mt5/mt5-connection-manager.service';
import { Mt5SymbolRouter } from './mt5/mt5-symbol-router.service';
// #992 option B — recovers a bridge whose MT5 session died, from OUTSIDE the bridge's own process.
// `@Interval` is available here because `ScheduleModule.forRoot()` is registered globally (see
// `scheduler.module.ts`), which is the same reason `LogService` can use it.
import { Mt5SessionRecoveryService } from './mt5/mt5-session-recovery.service';
import { Mt5BridgeConfig, resolveMt5BridgeUrl } from './mt5/mt5-bridge.config';
import { YahooFinanceAdapter } from './adapters/yahoo-finance.adapter';
import { PolygonAdapter } from './adapters/polygon.adapter';
import { FinnhubAdapter } from './adapters/finnhub.adapter';
import { TwelveDataAdapter } from './adapters/twelve-data.adapter';
import { FmpAdapter } from './adapters/fmp.adapter';
import { BinanceAdapter } from './adapters/binance.adapter';
import { CapitalComAdapter } from './adapters/capital-com.adapter';
import { InteractiveBrokersAdapter } from './adapters/interactive-brokers.adapter';
import { CryptoProviderRouter } from './crypto-provider-router.service';
import { RateLimitGovernor } from './rate-limit-governor.service';
import { ProviderDegradationService } from './provider-degradation.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationService } from '../notifications/notifications.service';
import { BridgeEventService } from './bridge-event.service';
import { ProviderCacheService } from './provider-cache.service';
import { PositionSyncService } from './position-sync.service';

@Module({
  imports: [DatabaseModule, NotificationsModule],
  controllers: [ProvidersController, Mt5Controller],
  providers: [
    ProvidersService,
    ModeService,
    AdapterFactory,
    RateLimitGovernor,
    ProviderDegradationService,
    CryptoProviderRouter,
    Mt5ConnectionManager,
    Mt5SymbolRouter,
    Mt5SessionRecoveryService,
    Mt5BridgeConfig,
    BridgeEventService,
    AlpacaAdapter,
    AlphaVantageAdapter,
    Trading212Adapter,
    Mt5Adapter,
    YahooFinanceAdapter,
    PolygonAdapter,
    FinnhubAdapter,
    TwelveDataAdapter,
    FmpAdapter,
    BinanceAdapter,
    CapitalComAdapter,
    InteractiveBrokersAdapter,
    ProviderCacheService,
    PositionSyncService,
  ],
  exports: [ProvidersService, AdapterFactory, FinnhubAdapter, FmpAdapter, Mt5Adapter, AlphaVantageAdapter, RateLimitGovernor, ProviderDegradationService, CryptoProviderRouter, BinanceAdapter, CapitalComAdapter, InteractiveBrokersAdapter, Mt5ConnectionManager, Mt5SymbolRouter, Mt5BridgeConfig, BridgeEventService, ProviderCacheService, PositionSyncService, Mt5SessionRecoveryService],
})
export class ProvidersModule implements OnModuleInit {
  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly degradation: ProviderDegradationService,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit() {
    // Wire NotificationService into degradation for provider alerts
    this.degradation.setNotificationService(this.notificationService);

    // ── Binance (crypto primary — free, no auth, 24/7) ──
    this.adapterFactory.register('binance', BinanceAdapter, {
      name: 'Binance',
      apiKeyEnv: 'BINANCE_API_KEY',
      baseUrl: 'https://api.binance.com',
      capabilities: ['quotes', 'candles', 'profiles'],
      failoverPriority: 15, // Low number = high priority (preferred for crypto)
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
      baseUrl: resolveMt5BridgeUrl(),
      capabilities: ['quotes', 'candles', 'trades'],
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
      enabled: true, // Re-enabled 2026-08-22 — key verified live (earnings calendar returns 500+ events)
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

    this.adapterFactory.register('capital.com', CapitalComAdapter, {
      name: 'Capital.com',
      apiKeyEnv: 'CAPITAL_COM_API_KEY',
      baseUrl: process.env.CAPITAL_COM_BASE_URL || 'https://demo-api-capital.backend-capital.com',
      capabilities: ['quotes', 'candles', 'trades'],
      failoverPriority: 25,
    });

    this.adapterFactory.register('interactive-brokers', InteractiveBrokersAdapter, {
      name: 'Interactive Brokers',
      apiKeyEnv: 'IBKR_MODE',
      baseUrl: 'http://localhost:4001',
      // ⚠️ NOT 'profiles' (#966). The capability list is a CLAIM about what a provider can
      // deliver, and this one used to deliver a hardcoded `Technology / Software / $50B` for
      // every symbol. `getProfile()` now returns null, so declaring the capability would be a
      // false claim — and `AdapterFactory.resolveProfile()` trusts this list to pick candidates.
      // Re-add it only alongside a real TWS/Gateway fundamentals call.
      capabilities: ['quotes', 'candles'],
      failoverPriority: 10,
    });
  }
}
