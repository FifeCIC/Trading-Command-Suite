import { Module } from '@nestjs/common';
import { DecoderController } from './decoder.controller';
import { DecoderService } from './decoder.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [DecoderController],
  providers: [DecoderService],
})
export class DecoderModule {}
