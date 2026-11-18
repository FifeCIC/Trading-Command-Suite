/**
 * change-suggestions.controller.ts — the API surface for the suggestion queue.
 *
 * ⚠️ ROUTE ORDER MATTERS. `@Get('protocol/:slug')` is declared BEFORE any catch-all, because a
 * parameterised route registered first shadows the named ones (the trap `symbols.controller.ts`
 * documents at its own `protocol-counts` route).
 */
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ChangeSuggestionsService,
  coverageOf,
  type CreateSuggestionInput,
  type SuggestionStatus,
} from './change-suggestions.service';

@ApiTags('suggestions')
@Controller('suggestions')
export class ChangeSuggestionsController {
  constructor(private readonly suggestions: ChangeSuggestionsService) {}

  @Get()
  @ApiOperation({
    summary: 'List queued change suggestions, optionally narrowed by scope / protocol / bot / status',
  })
  @ApiOkResponse({ description: '{ suggestions, coverage }' })
  async list(
    @Query('scope') scope?: string,
    @Query('protocolSlug') protocolSlug?: string,
    @Query('botId') botId?: string,
    @Query('status') status?: string,
    @Query('kinds') kinds?: string,
  ) {
    const rows = await this.suggestions.list({
      scope,
      protocolSlug,
      botId,
      status,
      kinds: kinds ? kinds.split(',').map((k) => k.trim()).filter(Boolean) : undefined,
    });
    return { suggestions: rows, coverage: coverageOf(rows) };
  }

  /**
   * forProtocol() — the COMBINED view: this protocol's suggestions plus those of every bot subscribed
   * to it. This is the endpoint the Strategies page and the Protocols page both read, so the two
   * surfaces cannot disagree about what is queued.
   */
  @Get('protocol/:slug')
  @ApiOperation({ summary: "A protocol's queued changes PLUS those of its subscribing bots" })
  async forProtocol(@Param('slug') slug: string) {
    return this.suggestions.forProtocol(slug);
  }

  @Post()
  @ApiOperation({ summary: 'Queue a change suggestion' })
  async create(@Body() body: CreateSuggestionInput) {
    return this.suggestions.create(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Move a suggestion through its lifecycle (status / priority / issue link)" })
  async update(
    @Param('id') id: string,
    @Body() body: { status?: SuggestionStatus; priority?: number; issueUrl?: string | null; suggestedValue?: string | null },
  ) {
    return this.suggestions.update(id, body);
  }
}
