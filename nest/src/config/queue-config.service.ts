import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type QueueMode = 'off' | 'local';

@Injectable()
export class QueueConfigService {
  private readonly logger = new Logger(QueueConfigService.name);

  constructor(private configService: ConfigService) {}

  isQueueEnabled(): boolean {
    const mode = this.getQueueMode();
    const enabled = mode === 'local';

    if (enabled) {
      const hasRedis = this.hasRedisConfig();
      if (!hasRedis) {
        this.logger.warn(
          'QUEUE_MODE=local but Redis configuration is missing. Queue will not initialize.',
        );
        return false;
      }
    }

    return enabled;
  }

  getQueueMode(): QueueMode {
    const mode = this.configService
      .get<string>('QUEUE_MODE', 'off')
      .toLowerCase();
    return mode === 'local' ? 'local' : 'off';
  }

  hasRedisConfig(): boolean {
    const host = this.configService.get<string>('REDIS_HOST');
    return Boolean(host);
  }

  getRedisConfig() {
    return {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD', ''),
      db: this.configService.get<number>('REDIS_DB', 0),
    };
  }

  logStatus() {
    const mode = this.getQueueMode();
    const enabled = this.isQueueEnabled();
    const hasRedis = this.hasRedisConfig();

    this.logger.log(`Queue mode: ${mode}`);
    this.logger.log(`Queue enabled: ${enabled}`);
    this.logger.log(`Redis configured: ${hasRedis}`);

    if (mode === 'local' && !hasRedis) {
      this.logger.warn(
        'Queue mode set to "local" but REDIS_HOST not configured',
      );
    }

    if (mode === 'off') {
      this.logger.log(
        'Queue processing is disabled. Set QUEUE_MODE=local to enable.',
      );
    }
  }
}
