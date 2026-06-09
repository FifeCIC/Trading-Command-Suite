import { Global, Module } from '@nestjs/common';
import { ModeService } from '../config/mode.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, ModeService],
  exports: [PrismaService, ModeService],
})
export class DatabaseModule {}
