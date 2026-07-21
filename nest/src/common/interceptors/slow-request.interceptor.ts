/**
 * SlowRequestInterceptor — logs a warning via SystemLogService when any request
 * exceeds the slow threshold. These entries appear in /api/system/logs,
 * the daily log file, and the frontend System Log page (/status/system-log).
 *
 * Registered globally in main.ts via app.useGlobalInterceptors().
 */

import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Inject, Optional, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { SystemLogService } from '../../modules/system/log.service';

const SLOW_THRESHOLD_MS = 2000;

@Injectable()
export class SlowRequestInterceptor implements NestInterceptor {
  private readonly logger = new Logger('SlowRequest');

  constructor(@Optional() @Inject(SystemLogService) private readonly syslog?: SystemLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = Date.now();
    const req = context.switchToHttp().getRequest<Request>();
    const label = `${req.method} ${req.originalUrl || req.url}`;

    return next.handle().pipe(
      tap({
        finalize: () => {
          const ms = Date.now() - start;
          if (ms > SLOW_THRESHOLD_MS) {
            const msg = `${label} — ${ms}ms (slow)`;
            this.logger.warn(msg);
            this.syslog?.warn('SlowRequest', msg);
          }
        },
      }),
    );
  }
}
