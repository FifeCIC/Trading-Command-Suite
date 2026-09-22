import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ProvidersModule } from '../providers/providers.module';
import { SymbolsController } from './symbols.controller';
import { BrokerSymbolsController } from './broker-symbols.controller';
import { SymbolsService } from './symbols.service';
import { SymbolNameEnricherService } from './symbol-name-enricher.service';
import { SymbolResolverService } from './symbol-resolver.service';
import { BrokerSymbolDiscoveryService } from './broker-symbol-discovery.service';

@Module({
  imports: [DatabaseModule, ProvidersModule],
  controllers: [SymbolsController, BrokerSymbolsController],
  providers: [
    SymbolsService,
    SymbolNameEnricherService,
    SymbolResolverService,
    BrokerSymbolDiscoveryService,
  ],
  exports: [
    SymbolsService,
    SymbolNameEnricherService,
    SymbolResolverService,
    BrokerSymbolDiscoveryService,
  ],
})
export class SymbolsModule {}
