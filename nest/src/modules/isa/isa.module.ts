import { Module } from '@nestjs/common';
import { IsaController } from './isa.controller';
import { IsaService } from './isa.service';

@Module({
  controllers: [IsaController],
  providers: [IsaService],
  exports: [IsaService],
})
export class IsaModule {}
