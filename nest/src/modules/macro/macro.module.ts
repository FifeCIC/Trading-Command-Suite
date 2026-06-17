import { Module } from '@nestjs/common';
import { MacroController } from './macro.controller';
import { FredAdapter } from '../providers/adapters/fred.adapter';
import { EcbAdapter } from '../providers/adapters/ecb.adapter';

@Module({
  controllers: [MacroController],
  providers: [FredAdapter, EcbAdapter],
})
export class MacroModule {}
