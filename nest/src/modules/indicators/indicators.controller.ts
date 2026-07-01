import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IndicatorsService } from './indicators.service';

@ApiTags('indicators')
@Controller('indicators')
export class IndicatorsController {
  constructor(private readonly indicatorsService: IndicatorsService) {}

  @Get(':symbol/support-resistance')
  @ApiOperation({ summary: 'Support & resistance levels for a symbol' })
  async supportResistance(
    @Param('symbol') symbol: string,
    @Query('tf') tf = 'H1',
  ) {
    const bars = await this.indicatorsService.getBars(symbol.toUpperCase(), tf);
    const levels = this.indicatorsService.computeSupportResistance(bars, symbol.toUpperCase(), tf);
    // Include last 200 bars for chart rendering
    const chartBars = bars.slice(-200).map((b) => ({
      time: b.timestamp instanceof Date ? b.timestamp.toISOString().split('T')[0] : String(b.timestamp).split('T')[0],
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    return { ...levels, bars: chartBars };
  }

  @Get(':symbol/volatility')
  @ApiOperation({ summary: 'Volatility metrics (ATR, Bollinger, historical vol)' })
  async volatility(
    @Param('symbol') symbol: string,
    @Query('tf') tf = 'H1',
  ) {
    const bars = await this.indicatorsService.getBars(symbol.toUpperCase(), tf);
    const metrics = this.indicatorsService.computeVolatility(bars, symbol.toUpperCase(), tf);
    // Include last 200 bars for chart rendering
    const chartBars = bars.slice(-200).map((b) => ({
      time: b.timestamp instanceof Date ? b.timestamp.toISOString().split('T')[0] : String(b.timestamp).split('T')[0],
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    return { ...metrics, bars: chartBars };
  }

  @Get(':symbol/:indicator')
  @ApiOperation({ summary: 'Compute a specific indicator' })
  async indicator(
    @Param('symbol') symbol: string,
    @Param('indicator') indicator: string,
    @Query('tf') tf = 'H1',
    @Query('period') period = '14',
  ) {
    const bars = await this.indicatorsService.getBars(symbol.toUpperCase(), tf);
    return this.indicatorsService.computeIndicator(bars, indicator, Number(period), symbol.toUpperCase(), tf);
  }

  @Get('correlation/:symA/:symB')
  @ApiOperation({ summary: 'Pearson correlation between two symbols' })
  async correlation(
    @Param('symA') symA: string,
    @Param('symB') symB: string,
    @Query('tf') tf = 'D1',
  ) {
    const barsA = await this.indicatorsService.getBars(symA.toUpperCase(), tf);
    const barsB = await this.indicatorsService.getBars(symB.toUpperCase(), tf);
    const corr = this.indicatorsService.computeCorrelation(barsA, barsB);
    return { symA: symA.toUpperCase(), symB: symB.toUpperCase(), timeframe: tf, correlation: corr };
  }

  @Get('sectors/performance')
  @ApiOperation({ summary: 'Sector ETF performance across timeframes' })
  async sectorPerformance(@Query('tf') tf = 'D1') {
    const etfs = ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLRE', 'XLU', 'XLC'];
    const barsByEtf: Record<string, any[]> = {};
    for (const etf of etfs) {
      barsByEtf[etf] = await this.indicatorsService.getBars(etf, tf);
    }
    return this.indicatorsService.computeSectorPerformance(barsByEtf);
  }
}
