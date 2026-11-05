import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ProgressionController } from './progression.controller';
import { ProgressionService } from './progression.service';

/**
 * ProgressionModule (#1193) — the earned level and the active-bot ceiling.
 *
 * ⚠️ `exports` is the point of this module. `TradingStrategyService` gates activation on the cap, so
 * the service must be injectable there. Exporting it — rather than letting the trading module
 * re-derive the level from its own Prisma reads — is what keeps ONE definition of "how many bots
 * may run". A second reader would drift, and it would drift silently: a cap that disagrees with the
 * panel that explains it is indistinguishable from a bug.
 *
 * ⚠️ No `SettingsModule` import: `SettingsResolverService` comes from `SystemModule`, which is
 * `@Global()`. Importing a settings module that does not exist is how this file first failed to
 * compile — the resolver is global, so the injection just works.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [ProgressionController],
  providers: [ProgressionService],
  exports: [ProgressionService],
})
export class ProgressionModule {}
