import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SystemMode = 'fallback' | 'full';

export interface ModeInfo {
  mode: SystemMode;
  database: boolean;
  queue: boolean;
  redis: boolean;
}

@Injectable()
export class ModeService {
  private cachedMode: ModeInfo | null = null;

  constructor(private configService: ConfigService) {}

  detectMode(): ModeInfo {
    if (this.cachedMode) {
      return this.cachedMode;
    }

    const hasDatabaseUrl = Boolean(this.configService.get('DATABASE_URL'));
    const hasRedis = Boolean(this.configService.get('REDIS_HOST'));
    const queueMode = this.configService.get('QUEUE_MODE', 'off');

    const database = hasDatabaseUrl;
    const queue = hasRedis && queueMode === 'local';
    const redis = hasRedis;

    const mode: SystemMode = database && queue ? 'full' : 'fallback';

    this.cachedMode = {
      mode,
      database,
      queue,
      redis,
    };

    return this.cachedMode;
  }

  getMode(): SystemMode {
    return this.detectMode().mode;
  }

  getModeInfo(): ModeInfo {
    return this.detectMode();
  }
}
