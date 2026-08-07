import { Controller, Get, Param } from '@nestjs/common';
import { BrokerConfigService } from './broker-config.service';

/**
 * GET /api/brokers — persisted broker capabilities.
 * Replaces the hardcoded PROTOCOL_BROKER_MAP in the frontend.
 */
@Controller('brokers')
export class BrokerConfigController {
  constructor(private readonly brokerConfig: BrokerConfigService) {}

  /** List all broker configs with capabilities. */
  @Get()
  async findAll() {
    const brokers = await this.brokerConfig.findAll();
    return { brokers };
  }

  /** Get a single broker's config. */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const broker = await this.brokerConfig.findOne(id);
    if (!broker) return { error: 'Broker not found' };
    return broker;
  }
}
