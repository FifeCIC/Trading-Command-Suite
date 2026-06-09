import { DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QueueConfigService } from '../config/queue-config.service';

@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    return {
      module: QueueModule,
      global: true,
      imports: [
        BullModule.forRootAsync({
          inject: [ConfigService, QueueConfigService],
          useFactory: async (configService: ConfigService, queueConfigService: QueueConfigService) => {
            const isEnabled = queueConfigService.isQueueEnabled();

            if (!isEnabled) {
              // Return minimal config that won't connect
              return {
                connection: {
                  host: 'disabled',
                  port: 0,
                  lazyConnect: true,
                  maxRetriesPerRequest: 0,
                },
              };
            }

            const redisConfig = queueConfigService.getRedisConfig();

            return {
              connection: {
                host: redisConfig.host,
                port: redisConfig.port,
                password: redisConfig.password || undefined,
                db: redisConfig.db,
              },
            };
          },
        }),
      ],
      providers: [QueueConfigService],
      exports: [QueueConfigService],
    };
  }
}
