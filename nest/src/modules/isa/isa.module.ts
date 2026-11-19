import { Module } from '@nestjs/common';
import { IsaController } from './isa.controller';
import { IsaService } from './isa.service';
import { T212ReferenceModule } from '../portfolio/t212-reference.module';

@Module({
  imports: [T212ReferenceModule],
  controllers: [IsaController],
  providers: [IsaService],
  exports: [IsaService],
})
export class IsaModule {}
