import { Module } from '@nestjs/common';
import { ResearchController } from './research.controller';
import { ResearchImportService } from './research-import.service';
import { FinnhubAdapter } from '../providers/adapters/finnhub.adapter';

@Module({
  controllers: [ResearchController],
  providers: [FinnhubAdapter, ResearchImportService],
})
export class ResearchModule {}
