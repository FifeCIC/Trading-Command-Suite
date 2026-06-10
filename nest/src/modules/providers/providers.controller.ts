import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProvidersService } from './providers.service';

@ApiTags('providers')
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get('health')
  @ApiOperation({ summary: 'Get provider connectivity and credential health' })
  @ApiOkResponse({ description: 'Provider health state list' })
  health() {
    return this.providersService.getHealth();
  }

  @Post('health/:provider')
  @ApiOperation({
    summary: 'Update provider health state manually or via adapter hooks',
  })
  @ApiOkResponse({ description: 'Updated provider health record' })
  updateHealth(
    @Param('provider') provider: string,
    @Query('status') status = 'healthy',
    @Query('message') message?: string,
    @Query('latencyMs', new ParseIntPipe({ optional: true }))
    latencyMs?: number,
  ) {
    return this.providersService.updateHealth(
      provider,
      status,
      message,
      latencyMs ?? null,
    );
  }

  @Get('test/:provider/:symbol')
  @ApiOperation({ summary: 'Test adapter getQuote method with a symbol' })
  @ApiOkResponse({
    description: 'Quote data from the specified provider adapter',
  })
  async testAdapter(
    @Param('provider') providerId: string,
    @Param('symbol') symbol: string,
  ) {
    const adapter = this.providersService.getAdapter(providerId);

    if (!adapter) {
      return {
        error: 'Provider adapter not found',
        providerId,
        availableProviders: ['alpaca', 'alphavantage', 'trading212'],
      };
    }

    const quote = await adapter.getQuote(symbol);
    const healthOk = await adapter.healthCheck();

    return {
      provider: providerId,
      adapterName: adapter.name,
      symbol,
      quote,
      healthOk,
      timestamp: new Date().toISOString(),
    };
  }
}
