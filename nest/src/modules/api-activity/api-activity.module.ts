import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ApiActivityController } from './api-activity.controller';
import { ApiActivityService } from './api-activity.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ApiActivityController],
  providers: [ApiActivityService],
  exports: [ApiActivityService],
})
export class ApiActivityModule {}
