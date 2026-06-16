import { Global, Module } from '@nestjs/common';
import { SystemLogService } from './log.service';
import { SystemLogController } from './system-log.controller';
import { ProcessManagerService } from './process-manager.service';
import { ProcessManagerController } from './process-manager.controller';
import { MetricsMiddleware } from '../../common/middleware/metrics.middleware';

@Global()
@Module({
  providers: [SystemLogService, ProcessManagerService, MetricsMiddleware],
  controllers: [SystemLogController, ProcessManagerController],
  exports: [SystemLogService, ProcessManagerService, MetricsMiddleware],
})
export class SystemModule {}
