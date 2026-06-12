import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { QueueConfigService } from './config/queue-config.service';
import { LoggingValidationPipe } from './common/pipes/validation.pipe';
import { PrismaService } from './database/prisma.service';

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

  app.enableCors({
    origin: [
      'http://localhost:5188',
      'http://127.0.0.1:5188',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new LoggingValidationPipe());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Trader Core API')
    .setDescription('NestJS backend for Trader.CORE')
    .setVersion('0.1.0')
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
  logger.log(`  Trading Command Suite v${process.env.npm_package_version || '0.1.0'}`);
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
