import { Global, Module } from '@nestjs/common';
import { SystemLogService } from './log.service';
import { SystemLogController } from './system-log.controller';
import { MetricsMiddleware } from '../../common/middleware/metrics.middleware';

@Global()
@Module({
  providers: [SystemLogService, MetricsMiddleware],
  controllers: [SystemLogController],
  exports: [SystemLogService, MetricsMiddleware],
})
export class SystemModule {}
