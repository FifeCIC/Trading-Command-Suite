import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ProvidersModule } from '../providers/providers.module';
import { ModeService } from '../../config/mode.service';
import { ImportJobsController } from './import-jobs.controller';
import { ImportJobsService } from './import-jobs.service';

@Module({
  imports: [DatabaseModule, ProvidersModule],
  controllers: [ImportJobsController],
  providers: [ImportJobsService, ModeService],
  exports: [ImportJobsService],
})
export class ImportJobsModule {}
