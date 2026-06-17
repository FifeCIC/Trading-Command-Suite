import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiActivityService } from './api-activity.service';

@ApiTags('api-activity')
@Controller('api-activity')
export class ApiActivityController {
  constructor(private readonly activity: ApiActivityService) {}

  @Get()
  @ApiOperation({ summary: 'List recent API activity records' })
  list(@Query('provider') provider?: string, @Query('limit') limit?: string) {
    return this.activity.list({
      provider: provider || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Summarize API activity, errors, and latency' })
  summary(@Query('provider') provider?: string) {
    return this.activity.summary({ provider: provider || undefined });
  }

  @Get('endpoint-usage')
  @ApiOperation({ summary: 'Return endpoint call usage for catalog status' })
  endpointUsage(@Query('provider') provider?: string) {
    return this.activity.endpointUsage(provider || undefined);
  }
}
