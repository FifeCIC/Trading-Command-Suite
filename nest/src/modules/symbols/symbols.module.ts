import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ProvidersModule } from '../providers/providers.module';
import { SymbolsController } from './symbols.controller';
import { BrokerSymbolsController } from './broker-symbols.controller';
import { SymbolsService } from './symbols.service';
import { SymbolNameEnricherService } from './symbol-name-enricher.service';
import { SymbolResolverService } from './symbol-resolver.service';
import { BrokerSymbolDiscoveryService } from './broker-symbol-discovery.service';
import { SymbolProtocolAuthorityService } from './symbol-protocol-authority.service';

@Module({
  imports: [DatabaseModule, ProvidersModule],
  controllers: [SymbolsController, BrokerSymbolsController],
  providers: [
    SymbolsService,
    SymbolNameEnricherService,
    SymbolResolverService,
    BrokerSymbolDiscoveryService,
    // #926 — THE authority for "which protocols apply to this symbol". Exported so other
    // modules read the one answer rather than growing a mechanism of their own.
    SymbolProtocolAuthorityService,
  ],
  exports: [
    SymbolsService,
    SymbolNameEnricherService,
    SymbolResolverService,
    BrokerSymbolDiscoveryService,
    SymbolProtocolAuthorityService,
  ],
})
export class SymbolsModule {}
