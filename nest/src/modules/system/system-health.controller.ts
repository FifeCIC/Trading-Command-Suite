import { Controller, Get } from '@nestjs/common';
import { SystemHealthService } from './system-health.service';

@Controller('system')
export class SystemHealthController {
  constructor(private readonly health: SystemHealthService) {}

  @Get('health-check')
  async healthCheck() {
    return this.health.runAllChecks();
  }
}
