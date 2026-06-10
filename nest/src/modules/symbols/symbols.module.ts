import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SymbolsController } from './symbols.controller';
import { SymbolsService } from './symbols.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SymbolsController],
  providers: [SymbolsService],
  exports: [SymbolsService],
})
export class SymbolsModule {}
