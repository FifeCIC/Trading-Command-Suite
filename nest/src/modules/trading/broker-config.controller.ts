import { Controller, Get, Param } from '@nestjs/common';
import { BrokerConfigService } from './broker-config.service';
import { BrokerCapabilityService } from './broker-capability.service';

/**
 * GET /api/brokers — persisted broker capabilities.
 * Replaces the hardcoded PROTOCOL_BROKER_MAP in the frontend.
 */
@Controller('brokers')
export class BrokerConfigController {
  constructor(
    private readonly brokerConfig: BrokerConfigService,
    private readonly brokerCapability: BrokerCapabilityService,
  ) {}

  /** List all broker configs with capabilities. */
  @Get()
  async findAll() {
    const brokers = await this.brokerConfig.findAll();
    return { brokers };
  }

  /**
   * GET /api/brokers/status — the JOINED view: config intent + adapter registration +
   * PROVEN runtime capability + observed connection state, in one response.
   *
   * ⚠️ DECLARED BEFORE `@Get(':id')` ON PURPOSE. Nest matches routes in declaration
   * order, so with `:id` first this path would be captured as broker id "status" and
   * return `{ error: 'Broker not found' }` — a 200 with a body that reads like a data
   * problem, on a route that is fine. Do not reorder these two methods.
   */
  @Get('status')
  async status() {
    return this.brokerCapability.getBrokerStatus();
  }

  /** Get a single broker's config. */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const broker = await this.brokerConfig.findOne(id);
    if (!broker) return { error: 'Broker not found' };
    return broker;
  }
}
