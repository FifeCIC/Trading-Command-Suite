import { Module } from '@nestjs/common';
import { ArchitectureController } from './architecture.controller';
import { ArchitectureService } from './architecture.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ArchitectureController],
  providers: [ArchitectureService],
  exports: [ArchitectureService],
})
export class ArchitectureModule {}
