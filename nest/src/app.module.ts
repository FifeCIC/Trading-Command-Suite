import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DevtoolsModule } from '@nestjs/devtools-integration';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DevtoolsModule.register({
      http: process.env.NODE_ENV !== 'production',
    }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
