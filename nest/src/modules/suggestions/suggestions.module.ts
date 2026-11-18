import { Module } from '@nestjs/common';
import { ChangeSuggestionsController } from './change-suggestions.controller';
import { ChangeSuggestionsService } from './change-suggestions.service';

/**
 * SuggestionsModule — the queue of changes we intend to try, for protocols and for bots.
 *
 * ⚠️ NO `PrismaModule` IMPORT. `PrismaService` is provided globally in this app (every other module
 * injects it without importing anything), so importing it here would be a second registration path
 * for one service — the duplication this repo's shared-core rule exists to prevent.
 */
@Module({
  controllers: [ChangeSuggestionsController],
  providers: [ChangeSuggestionsService],
  exports: [ChangeSuggestionsService],
})
export class SuggestionsModule {}
