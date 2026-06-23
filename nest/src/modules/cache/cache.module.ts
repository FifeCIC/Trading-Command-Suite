import { Module, Global } from '@nestjs/common';
import { CacheService } from '../../common/cache/cache.service';
import { TraceCacheService } from './trace-cache.service';
import { CacheController } from './cache.controller';

@Global()
@Module({
  controllers: [CacheController],
  providers: [CacheService, TraceCacheService],
  exports: [CacheService, TraceCacheService],
})
export class CacheModule {}
