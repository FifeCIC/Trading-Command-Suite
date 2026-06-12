import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { FaqController } from './faq.controller';
import { FaqService } from './faq.service';

@Module({
  imports: [DatabaseModule],
  controllers: [FaqController],
  providers: [FaqService],
  exports: [FaqService],
})
export class FaqModule {}
