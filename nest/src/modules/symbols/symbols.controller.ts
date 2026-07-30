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
  Logger,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationInterceptor } from '../../common/interceptors/pagination.interceptor';
import { Symbol } from '@prisma/client';
import { ModeService } from '../../config/mode.service';
import { PrismaService } from '../../database/prisma.service';
import { CreateSymbolDto } from './dto/create-symbol.dto';
import { UpdateSymbolDto } from './dto/update-symbol.dto';
import { SymbolsService } from './symbols.service';
import { SymbolNameEnricherService } from './symbol-name-enricher.service';
import { SymbolResolverService, type SymbolTier, type ResolutionFeature } from './symbol-resolver.service';

@ApiTags('symbols')
@Controller('symbols')
export class SymbolsController {
  constructor(
    private readonly symbolsService: SymbolsService,
    private readonly modeService: ModeService,
    private readonly prisma: PrismaService,
    private readonly enricher: SymbolNameEnricherService,
    private readonly symbolResolver: SymbolResolverService,
  ) {}

  private readonly logger = new Logger(SymbolsController.name);

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

  @Post('enrich')
  @ApiOperation({ summary: 'Enrich symbol names from providers (MT5, Yahoo, Alpaca)' })
  async enrich(@Body() body?: { ticker?: string }) {
    if (body?.ticker) {
      const name = await this.enricher.enrichOne(body.ticker);
      return { ...this.modeMeta(), ticker: body.ticker.toUpperCase(), name };
    }
    const result = await this.enricher.enrichAll();
    return { ...this.modeMeta(), ...result };
  }

  @Get()
  @UseInterceptors(new PaginationInterceptor('symbols'))
  @ApiOperation({ summary: 'List all symbols. Use ?tag= to filter by tag.' })
  @ApiOkResponse({ description: 'All symbols' })
  async findAll(@Query('tag') tag?: string, @Query('search') search?: string) {
    const symbols = tag
      ? await this.symbolsService.findByTag(tag)
      : await this.symbolsService.findAll(search);
    return { ...this.modeMeta(), symbols };
  }

  @Get('with-bars')
  async withBars() {
    if (!this.prisma.isAvailable) return { ...this.modeMeta(), tickers: [] };

    // Get distinct tickers that have at least one MarketBar
    const rows = await this.prisma.marketBar.findMany({
      distinct: ['symbolId'],
      select: { symbolId: true },
    });

    const symbolIds = rows.map((r) => r.symbolId);

    const symbols = await this.prisma.symbol.findMany({
      where: { id: { in: symbolIds }, active: true },
      select: { ticker: true },
      orderBy: { ticker: 'asc' },
    });

    const tickers = symbols.map((s) => s.ticker);
    this.logger.log(`with-bars: ${tickers.length} symbols have market data`);
    return { ...this.modeMeta(), tickers };
  }

  @Get('resolution')
  @ApiOperation({ summary: 'Resolve symbols by tier or feature using the shared resolver' })
  async resolution(
    @Query('tier') tier?: string,
    @Query('feature') feature?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;

    if (feature) {
      const validFeatures: ResolutionFeature[] = ['news', 'bar-refresh', 'scoring', 'automation'];
      if (!validFeatures.includes(feature as ResolutionFeature)) {
        return { ...this.modeMeta(), error: `Invalid feature "${feature}". Valid: ${validFeatures.join(', ')}` };
      }
      const selection = await this.symbolResolver.getSymbolsForFeature(feature as ResolutionFeature, limitNum);
      return { ...this.modeMeta(), ...selection };
    }

    if (tier) {
      const validTiers: SymbolTier[] = [
        'positions', 'active-strategies', 'active-protocols',
        'watchlist-starred', 'macro', 'sector', 'forex-floor', 'all-active',
      ];
      if (!validTiers.includes(tier as SymbolTier)) {
        return { ...this.modeMeta(), error: `Invalid tier "${tier}". Valid: ${validTiers.join(', ')}` };
      }
      const symbols = await this.symbolResolver.getSymbolsByTier(tier as SymbolTier, limitNum);
      return { ...this.modeMeta(), tier, symbols, count: symbols.length };
    }

    // No tier or feature specified — return all
    const symbols = await this.symbolResolver.getAllSymbols(limitNum);
    return { ...this.modeMeta(), symbols, count: symbols.length };
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

  @Get(':ticker/overview')
  @ApiOperation({ summary: 'Get aggregated symbol overview (price, positions, freshness)' })
  async getOverview(@Param('ticker') ticker: string) {
    const overview = await this.symbolsService.getOverview(ticker);
    return { ...this.modeMeta(), ...overview };
  }

  @Get(':ticker/protocols')
  @ApiOperation({ summary: 'Get cross-protocol scores for a symbol' })
  async getProtocols(@Param('ticker') ticker: string) {
    const data = await this.symbolsService.getProtocols(ticker);
    return { ...this.modeMeta(), ...data };
  }

  @Get(':ticker/focus')
  @ApiOperation({ summary: 'Single-symbol focus view — protocols, strategies, decisions, outcomes' })
  async getFocus(@Param('ticker') ticker: string) {
    const data = await this.symbolsService.getFocus(ticker);
    return { ...this.modeMeta(), ...data };
  }
}
