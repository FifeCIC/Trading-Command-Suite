import { Module, Global } from '@nestjs/common';
import { CacheService } from '../../common/cache/cache.service';
import { CacheController } from './cache.controller';

@Global()
@Module({
  controllers: [CacheController],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
