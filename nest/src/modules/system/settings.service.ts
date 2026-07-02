import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface AppSettings {
  earnings: {
    importHorizonMonths: number;
    autoRefreshDays: number;
  };
  correlation: {
    refreshMinutes: number;
    warningThreshold: number;
  };
  seasonality: {
    weightMultiplier: number;
  };
  analyst: {
    refreshHours: number;
  };
  data: {
    stalenessHours: number;
  };
}

const DEFAULTS: AppSettings = {
  earnings: { importHorizonMonths: 3, autoRefreshDays: 7 },
  correlation: { refreshMinutes: 360, warningThreshold: 0.7 },
  seasonality: { weightMultiplier: 1.0 },
  analyst: { refreshHours: 24, },
  data: { stalenessHours: 24 },
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(process.cwd(), 'app-settings.json');
  }

  get(): AppSettings {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return { ...DEFAULTS, ...JSON.parse(raw) };
      }
    } catch (err) {
      this.logger.warn(`Failed to read settings, using defaults: ${(err as Error).message}`);
    }
    return { ...DEFAULTS };
  }

  update(partial: Partial<AppSettings>): AppSettings {
    const current = this.get();
    const merged = this.deepMerge(current, partial);
    fs.writeFileSync(this.filePath, JSON.stringify(merged, null, 2));
    this.logger.log('Settings updated');
    return merged;
  }

  reset(): AppSettings {
    if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    return { ...DEFAULTS };
  }

  private deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target };
    for (const key of Object.keys(source) as (keyof T)[]) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] as any, source[key] as any);
      } else if (source[key] !== undefined) {
        result[key] = source[key] as any;
      }
    }
    return result;
  }
}
