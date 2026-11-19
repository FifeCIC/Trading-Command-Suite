import { Module } from '@nestjs/common';
import { Trading212ReferenceService } from './t212-reference.service';

/**
 * T212ReferenceModule — the Trading212 lookup tables (instrument names, pie membership).
 *
 * ⚠️ ITS OWN MODULE ON PURPOSE. The two consumers are `PortfolioModule` and `IsaModule`, and
 * `PortfolioModule` already imports `IsaModule` (for the ISA dashboard) — so hanging this service
 * off either one would need a `forwardRef` cycle to reach the other. A third, dependency-free module
 * is the shape that avoids that entirely.
 */
@Module({
  providers: [Trading212ReferenceService],
  exports: [Trading212ReferenceService],
})
export class T212ReferenceModule {}
