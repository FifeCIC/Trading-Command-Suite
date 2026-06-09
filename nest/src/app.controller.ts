import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ModeService } from './config/mode.service';
import { PrismaService } from './database/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly modeService: ModeService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('version')
  getVersion() {
    const modeInfo = this.modeService.getModeInfo();
    return {
      version: 'nest-0.1.0',
      status: 'ok',
      timestamp: new Date().toISOString(),
      mode: modeInfo.mode,
      services: {
        database: modeInfo.database,
        databaseConnected: this.prisma.isAvailable,
        queue: modeInfo.queue,
        redis: modeInfo.redis,
      },
    };
  }
}
