import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DevtoolsModule } from '@nestjs/devtools-integration';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { QueueModule } from './queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { SymbolsModule } from './modules/symbols/symbols.module';
import { StrategiesModule } from './modules/strategies/strategies.module';
import { DirectivesModule } from './modules/directives/directives.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { SignalsModule } from './modules/signals/signals.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { DatabaseModule } from './database/database.module';
import { ImportJobsModule } from './modules/import-jobs/import-jobs.module';
import { MarketDataModule } from './modules/market-data/market-data.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ScenariosModule } from './modules/scenarios/scenario.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { RiskModule } from './modules/risk/risk.module';
import { TradingGatesModule } from './modules/trading-gates/trading-gates.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { SystemModule } from './modules/system/system.module';
import { BacktestModule } from './modules/backtest/backtest.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ExportModule } from './modules/export/export.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { CacheModule } from './modules/cache/cache.module';
import { TrainingModule } from './modules/training/training.module';
import { NewsModule } from './modules/news/news.module';
import { SnapshotsModule } from './modules/snapshots/snapshots.module';
import { TimelineModule } from './modules/timeline/timeline.module';
import { JournalModule } from './modules/journal/journal.module';
import { CalibrationModule } from './modules/calibration/calibration.module';
import { IndicatorsModule } from './modules/indicators/indicators.module';
import { MacroModule } from './modules/macro/macro.module';
import { TradingModule } from './modules/trading/trading.module';
import { ApiActivityModule } from './modules/api-activity/api-activity.module';
import { RateLimiterMiddleware } from './common/middleware/rate-limiter.middleware';
import { MetricsMiddleware } from './common/middleware/metrics.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DevtoolsModule.register({
      http: process.env.NODE_ENV !== 'production',
    }),
    QueueModule.forRoot(),
    AuthModule,
    SymbolsModule,
    StrategiesModule,
    DirectivesModule,
    ScoringModule,
    SignalsModule,
    PortfolioModule,
    DatabaseModule,
    ImportJobsModule,
    MarketDataModule,
    ProvidersModule,
    WebhooksModule,
    ScenariosModule,
    SchedulerModule,
    RiskModule,
    TradingGatesModule,
    PerformanceModule,
    SystemModule,
    BacktestModule,
    NotificationsModule,
    AlertsModule,
    ExportModule,
    CacheModule,
    TrainingModule,
    NewsModule,
    SnapshotsModule,
    TimelineModule,
    JournalModule,
    CalibrationModule,
    IndicatorsModule,
    MacroModule,
    TradingModule,
    ApiActivityModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(MetricsMiddleware)
      .forRoutes('*');
    consumer
      .apply(RateLimiterMiddleware)
      .forRoutes('api/providers', 'api/webhooks');
  }
}
