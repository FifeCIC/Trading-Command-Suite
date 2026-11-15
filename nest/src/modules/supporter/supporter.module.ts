import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ProgressionModule } from '../progression/progression.module';
import { SupporterController } from './supporter.controller';
import { SupporterService } from './supporter.service';

/**
 * SupporterModule (#1147) — the in-app support prompt, named "Supporter Programme" by the owner on
 * 2026-11-15 (SETTLED-DECISIONS row 182).
 *
 * ⚠️ `ProgressionModule` IS imported, and it is the only import that matters. The prompt's cooldown
 * needs "how long has this been in use", which `ProgressionService` already measures from the
 * earliest recorded activity. Re-deriving it here would create a second definition of install age
 * that drifts — and it would drift silently, because both numbers are plausible.
 *
 * ⚠️ No settings import: `SettingsResolverService` comes from `SystemModule`, which is `@Global()`.
 * Nothing is exported from this module: nobody else decides whether to ask for support.
 */
@Module({
  imports: [DatabaseModule, ProgressionModule],
  controllers: [SupporterController],
  providers: [SupporterService],
})
export class SupporterModule {}
