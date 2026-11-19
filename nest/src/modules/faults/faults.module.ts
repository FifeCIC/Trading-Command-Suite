/**
 * FaultsModule — the persistent fault registry (schema model `Fault` → table `fault`).
 *
 * Exported so the subsystems that OBSERVE a fault can record it on a transition rather than only
 * holding it in memory. The guardrail that keeps this registry from becoming a second list nobody
 * visits is `scripts/validate-fault-taxonomy.cjs` (in `prebuild`); the reasoning is in
 * `docs/FAULT-TAXONOMY-GUARDRAILS.md`.
 */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { FaultsController } from './faults.controller';
import { FaultsService } from './faults.service';

@Module({
  imports: [DatabaseModule],
  controllers: [FaultsController],
  providers: [FaultsService],
  exports: [FaultsService],
})
export class FaultsModule {}
