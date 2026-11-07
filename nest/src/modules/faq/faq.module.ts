/* ── PLANNED IN #1228 ──
 * MISSING:  reachability. Nothing in src/ or nest/src/ names this file — no import, no route,
 *           no dynamic load. Either it is dead code, or it is a capability nobody wired up, and
 *           those two need opposite responses.
 * TODAY:    found by the name-reference scan in scripts/audit-code-health.cjs (see
 *           docs/CODE-HEALTH.md). Decide DELETE / WIRE UP / KEEP+explain, record it on the
 *           issue, then re-bank: node scripts/audit-code-health.cjs --write
 * WHEN BUILT: the file is either gone, or reachable and named by something.
 * CODE-HEALTH-MARKER — written by scripts/audit-code-health.cjs; re-run it rather than editing.
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { FaqController } from './faq.controller';
import { FaqService } from './faq.service';

@Module({
  imports: [DatabaseModule],
  controllers: [FaqController],
  providers: [FaqService],
  exports: [FaqService],
})
export class FaqModule {}
