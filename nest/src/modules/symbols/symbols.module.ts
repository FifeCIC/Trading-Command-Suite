import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ProvidersModule } from '../providers/providers.module';
import { SymbolsController } from './symbols.controller';
import { SymbolsService } from './symbols.service';
import { SymbolNameEnricherService } from './symbol-name-enricher.service';
import { SymbolResolverService } from './symbol-resolver.service';

@Module({
  imports: [DatabaseModule, ProvidersModule],
  controllers: [SymbolsController],
  providers: [SymbolsService, SymbolNameEnricherService, SymbolResolverService],
  exports: [SymbolsService, SymbolNameEnricherService, SymbolResolverService],
})
export class SymbolsModule {}
