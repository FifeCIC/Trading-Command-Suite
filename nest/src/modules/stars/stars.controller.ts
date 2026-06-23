import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StarsService } from './stars.service';

@ApiTags('stars')
@Controller('stars')
export class StarsController {
  constructor(private readonly starsService: StarsService) {}

  @Post('toggle')
  @ApiOperation({ summary: 'Toggle star on/off for an item' })
  @ApiOkResponse({ description: 'New star state' })
  async toggle(
    @Body() body: { itemType: string; itemId: string; userId?: string },
  ) {
    const result = await this.starsService.toggle(
      body.itemType,
      body.itemId,
      body.userId,
    );
    return result;
  }

  @Get()
  @ApiOperation({ summary: 'Get all starred items' })
  async findAll(@Query('type') types?: string | string[]) {
    // Handle both single ?type=symbol and ?type=symbol&type=protocol
    const typeArray = types
      ? Array.isArray(types)
        ? types
        : [types]
      : undefined;
    const result = await this.starsService.findAll('default', typeArray);
    return result;
  }

  @Get('symbols')
  @ApiOperation({ summary: 'Get starred symbol tickers' })
  async getStarredSymbols() {
    const ids = await this.starsService.getStarredIds('symbol');
    return { symbols: ids };
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Bulk star multiple items' })
  async bulkStar(
    @Body()
    body: {
      items: { itemType: string; itemId: string }[];
      action: 'star' | 'unstar';
    },
  ) {
    const count =
      body.action === 'star'
        ? await this.starsService.bulkStar(body.items)
        : await this.starsService.bulkUnstar(body.items);
    return { count };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a star by ID' })
  async remove(@Param('id') id: string) {
    await this.starsService.remove(id);
    return { success: true };
  }
}
