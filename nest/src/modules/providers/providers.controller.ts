import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
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
  @ApiOperation({ summary: 'Update provider health state manually or via adapter hooks' })
  @ApiOkResponse({ description: 'Updated provider health record' })
  updateHealth(
    @Param('provider') provider: string,
    @Query('status') status = 'healthy',
    @Query('message') message?: string,
    @Query('latencyMs', new ParseIntPipe({ optional: true })) latencyMs?: number,
  ) {
    return this.providersService.updateHealth(provider, status, message, latencyMs ?? null);
  }
}
