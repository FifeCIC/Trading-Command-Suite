import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { Trading212Adapter } from '../providers/adapters/trading212.adapter';
import { WatchlistsController } from './watchlists.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [WatchlistsController],
  providers: [Trading212Adapter],
})
export class WatchlistsModule {}
