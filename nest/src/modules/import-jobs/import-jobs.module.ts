import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ImportJobsController } from './import-jobs.controller';
import { ImportJobsService } from './import-jobs.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ImportJobsController],
  providers: [ImportJobsService],
  exports: [ImportJobsService],
})
export class ImportJobsModule {}
