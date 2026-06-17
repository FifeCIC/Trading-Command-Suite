import { Module } from '@nestjs/common';
import { NewsController } from './news.controller';
import { NewsCollectorService } from './news-collector.service';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ProvidersModule],
  controllers: [NewsController],
  providers: [NewsCollectorService],
  exports: [NewsCollectorService],
})
export class NewsModule {}
