import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';

@Module({
  imports: [DatabaseModule],
  controllers: [FxController],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
