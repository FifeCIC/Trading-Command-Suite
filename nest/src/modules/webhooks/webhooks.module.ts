import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
