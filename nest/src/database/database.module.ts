import { Global, Module } from '@nestjs/common';
import { ModeService } from '../config/mode.service';
import { PrismaService } from './prisma.service';
import { DatabaseController } from './database.controller';

@Global()
@Module({
  controllers: [DatabaseController],
  providers: [PrismaService, ModeService],
  exports: [PrismaService, ModeService],
})
export class DatabaseModule {}
