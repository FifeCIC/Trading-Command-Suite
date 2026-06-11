import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationInterceptor } from '../../common/interceptors/pagination.interceptor';
import { Symbol } from '@prisma/client';
import { ModeService } from '../../config/mode.service';
import { CreateSymbolDto } from './dto/create-symbol.dto';
import { UpdateSymbolDto } from './dto/update-symbol.dto';
import { SymbolsService } from './symbols.service';

@ApiTags('symbols')
@Controller('symbols')
export class SymbolsController {
  constructor(
    private readonly symbolsService: SymbolsService,
    private readonly modeService: ModeService,
  ) {}

  private modeMeta() {
    const info = this.modeService.getModeInfo();
    return {
      mode: info.mode,
      services: {
        database: info.database,
        queue: info.queue,
        redis: info.redis,
      },
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new trading symbol' })
  @ApiOkResponse({ description: 'Created symbol' })
  async create(@Body() dto: CreateSymbolDto) {
    const symbol = await this.symbolsService.create(dto);
    return { ...this.modeMeta(), symbol };
  }

  @Get()
  @UseInterceptors(new PaginationInterceptor('symbols'))
  @ApiOperation({ summary: 'List all symbols' })
  @ApiOkResponse({ description: 'All symbols' })
  async findAll() {
    const symbols = await this.symbolsService.findAll();
    return { ...this.modeMeta(), symbols };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a symbol by id' })
  @ApiOkResponse({ description: 'Single symbol' })
  async findOne(@Param('id') id: string) {
    const symbol = await this.symbolsService.findOne(id);
    return { ...this.modeMeta(), symbol };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update symbol fields' })
  @ApiOkResponse({ description: 'Updated symbol' })
  async update(@Param('id') id: string, @Body() dto: UpdateSymbolDto) {
    const symbol = await this.symbolsService.update(id, dto);
    return { ...this.modeMeta(), symbol };
  }

  @Patch(':id/active')
  @ApiOperation({ summary: 'Toggle symbol active status' })
  @ApiOkResponse({ description: 'Updated symbol active state' })
  async setActive(
    @Param('id') id: string,
    @Query('value', ParseBoolPipe) value: boolean,
  ) {
    const symbol = await this.symbolsService.setActive(id, value);
    return { ...this.modeMeta(), symbol };
  }
}
