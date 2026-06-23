import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { StarsController } from './stars.controller';
import { StarsService } from './stars.service';

@Module({
  imports: [DatabaseModule],
  controllers: [StarsController],
  providers: [StarsService],
  exports: [StarsService],
})
export class StarsModule {}
