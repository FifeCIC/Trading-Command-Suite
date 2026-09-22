import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { APP_VERSION } from './version';
import { QueueConfigService } from './config/queue-config.service';
import { LoggingValidationPipe } from './common/pipes/validation.pipe';
import { PrismaService } from './database/prisma.service';
import { ApiActivityService } from './modules/api-activity/api-activity.service';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { SlowRequestInterceptor } from './common/interceptors/slow-request.interceptor';
import { NoticeExceptionFilter } from './common/notices/notice.filter';

/**
 * BigInt must be serialisable before anything can return one (2026-09-22).
 *
 * ⚠️ WHY THIS EXISTS. Four ticket columns were widened from `int` to `BIGINT` because MySQL
 * runs non-strict here (`sql_mode` is empty) and was **silently clamping** real 12-digit MT5
 * tickets to 2147483647 rather than rejecting them. Prisma returns a JS `BigInt` for a BIGINT
 * column, and `JSON.stringify` THROWS on a BigInt:
 *
 *     TypeError: Do not know how to serialize a BigInt
 *
 * That failure would land at response time, in whichever endpoint happened to return a row
 * containing a ticket — which is most of the trading surfaces. Registering `toJSON` once, here,
 * converts that guaranteed 500 into a correct value: the ticket is an IDENTIFIER, never a
 * quantity, so rendering it as a decimal string is the right shape and is lossless for
 * 64-bit values that a JS `number` could not hold exactly anyway.
 *
 * This is deliberately global and additive. It changes no existing behaviour — a number is
 * unaffected — and it removes a class of crash rather than one instance of it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function toJSON(this: bigint): string {
  return this.toString();
};

const logger = new Logger('Bootstrap');

async function bootstrap() {
  // ─── Pre-startup checks ─────────────────────────────────
  if (!process.env.DATABASE_URL) {
    logger.warn('DATABASE_URL not configured. Copy .env.example to .env and set your credentials.');
  } else {
    logger.log(`DATABASE_URL found, pointing to: ${process.env.DATABASE_URL.replace(/\/\/.*@/, '//***@')}`);
  }

  if (!process.env.ALPACA_API_KEY) {
    logger.warn('Alpaca not configured (ALPACA_API_KEY) — no real data will flow.');
  }

  // ─── Create app ─────────────────────────────────────────
  const app = await NestFactory.create(AppModule);
  const apiActivity = app.get(ApiActivityService);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    let responseSize = 0;

    res.write = (chunk: any, ...args: any[]) => {
      if (chunk) responseSize += Buffer.byteLength(chunk as Buffer | string);
      return originalWrite(chunk, ...args as [any]);
    };

    res.end = (chunk: any, ...args: any[]) => {
      if (chunk) responseSize += Buffer.byteLength(chunk as Buffer | string);
      return originalEnd(chunk, ...args as [any]);
    };

    res.on('finish', () => {
      const endpoint = req.originalUrl.split('?')[0];
      if (!endpoint.startsWith('/api') || endpoint.startsWith('/api/api-activity')) {
        return;
      }

      void apiActivity.record({
        endpoint: endpoint.replace(/^\/api/, '') || '/',
        method: req.method,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        responseSize,
      });
    });

    next();
  });

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Restrict to known local origins: Vite dev ports (5173-5179) and the local
      // Intranet (port 80). Non-browser requests (no Origin header) pass through.
      // Previously ANY localhost port was allowed, letting any locally-running app
      // make authenticated-looking cross-origin calls to the trading API.
      if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1):(80|517[3-9])$/.test(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new LoggingValidationPipe());
  app.useGlobalInterceptors(new SlowRequestInterceptor(), new TimeoutInterceptor());
  // THE error serialiser (#826 Phase 1). Every failure leaves the API carrying a stable code, so a
  // log line, a UI report and a GitHub issue can be joined by the same string. Registered here
  // rather than via APP_FILTER so it sits beside the pipes/interceptors it works with — and so a
  // reader of bootstrap can see that error shape is decided in exactly one place.
  app.useGlobalFilters(new NoticeExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Trader Core API')
    .setDescription('NestJS backend for Trader.CORE')
    .setVersion(APP_VERSION)
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  // Log queue status on startup
  const queueConfig = app.get(QueueConfigService);
  queueConfig.logStatus();

  // Wait for Prisma to attempt connection
  const prisma = app.get(PrismaService);

  // ─── Startup log summary ────────────────────────────────
  const port = process.env.PORT ?? 3201;
  logger.log('');
  logger.log('='.repeat(44));
  logger.log(`  Trading Command Suite v${APP_VERSION}`);
  logger.log(`  Database:   ${prisma.isAvailable ? '✅ Connected' : '❌ Not connected (degraded mode)'}`);
  logger.log(`  Alpaca:     ${process.env.ALPACA_API_KEY ? '✅ Configured' : '⚠️  Not configured (set ALPACA_API_KEY)'}`);
  logger.log(`  MT5:        ❌ Bridge not running`);
  logger.log(`  Queue:      ${process.env.QUEUE_MODE === 'local' ? '✅ Local mode' : '⚠️  Disabled (QUEUE_MODE=off)'}`);
  logger.log(`  Port:       ${port}`);
  logger.log('='.repeat(44));
  logger.log('');

  await app.listen(port);
  logger.log(`🚀 Application is running on: http://localhost:${port}/api`);
}

bootstrap().catch((err) => {
  logger.error('Failed to start application:', err);
  process.exit(1);
});
