import { Module } from '@nestjs/common';
import { CapabilityController } from './capability.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [CapabilityController],
})
export class CapabilityModule {}
