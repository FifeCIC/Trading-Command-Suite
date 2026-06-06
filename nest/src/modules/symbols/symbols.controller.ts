import { Body, Controller, Get, Param, ParseBoolPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Symbol } from '@prisma/client';
import { CreateSymbolDto } from './dto/create-symbol.dto';
import { UpdateSymbolDto } from './dto/update-symbol.dto';
import { SymbolsService } from './symbols.service';

@ApiTags('symbols')
@Controller('symbols')
export class SymbolsController {
  constructor(private readonly symbolsService: SymbolsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new trading symbol' })
  @ApiOkResponse({ description: 'Created symbol' })
  create(@Body() dto: CreateSymbolDto): Promise<Symbol> {
    return this.symbolsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all symbols' })
  @ApiOkResponse({ description: 'All symbols' })
  findAll(): Promise<Symbol[]> {
    return this.symbolsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a symbol by id' })
  @ApiOkResponse({ description: 'Single symbol' })
  findOne(@Param('id') id: string): Promise<Symbol> {
    return this.symbolsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update symbol fields' })
  @ApiOkResponse({ description: 'Updated symbol' })
  update(@Param('id') id: string, @Body() dto: UpdateSymbolDto): Promise<Symbol> {
    return this.symbolsService.update(id, dto);
  }

  @Patch(':id/active')
  @ApiOperation({ summary: 'Toggle symbol active status' })
  @ApiOkResponse({ description: 'Updated symbol active state' })
  setActive(
    @Param('id') id: string,
    @Query('value', ParseBoolPipe) value: boolean,
  ): Promise<Symbol> {
    return this.symbolsService.setActive(id, value);
  }
}
