/**
 * StrategyRegistryController — the naming/pinning surface (#875).
 * ===============================================================
 * GET    /api/scoring/strategy-registry               — registered identities + drift status
 * POST   /api/scoring/strategy-registry               — register a derived strategy (by strategyKey)
 * PATCH  /api/scoring/strategy-registry/:id           — rename (never mints a second strategy)
 * POST   /api/scoring/strategy-registry/:id/reaccept  — accept the current config after drift
 *
 * ⚠️ WHY NOT UNDER `scoring/strategies`: that prefix belongs to `ScoringStrategyController`, whose
 * `@Get(':id')` route registered FIRST in the module order and swallowed `strategies/registered` —
 * the live result was a 404 reading *"Scoring strategy registered not found"* (the word "registered"
 * parsed as an id). A static route can lose to a dynamic one depending on registration order, so
 * this surface gets a prefix that cannot collide rather than relying on array order.
 *
 * The DERIVED surface (`GET /api/scoring/strategies/derived`) stays pure and unnamed; this is the
 * materialise step. A name pins to a stable `id`, never to the content key.
 */
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { StrategyRegistryService } from './strategy-registry.service';

@Controller('scoring/strategy-registry')
export class StrategyRegistryController {
  constructor(private readonly registry: StrategyRegistryService) {}

  @Get()
  @ApiOperation({ summary: 'Registered (named or auto) strategies joined with the live derivation' })
  @ApiOkResponse({ description: 'Each row carries status steady|drifted|unmaterialised and, when drifted, the changed fields' })
  async list() {
    return this.registry.list();
  }

  @Post()
  @ApiOperation({ summary: 'Register a derived strategy by strategyKey (idempotent)' })
  async register(@Body() body: { strategyKey: string; name?: string }) {
    return this.registry.register(body?.strategyKey, { name: body?.name, source: 'owner' });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a registered strategy (id and accepted parts are untouched)' })
  async rename(@Param('id') id: string, @Body() body: { name: string }) {
    return this.registry.rename(id, body?.name);
  }

  @Post(':id/reaccept')
  @ApiOperation({ summary: 'Accept the CURRENT configuration as this strategy definition (drift resolution)' })
  async reaccept(@Param('id') id: string) {
    return this.registry.reaccept(id);
  }
}
