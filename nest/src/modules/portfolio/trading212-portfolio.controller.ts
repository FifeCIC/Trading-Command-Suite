import { Controller, Get, Post } from '@nestjs/common';
import { Trading212ImportService } from './trading212-import.service';

@Controller('api/portfolio/trading212')
export class Trading212PortfolioController {
  constructor(private readonly importService: Trading212ImportService) {}

  @Get('validate')
  validate() {
    return this.importService.validateConnection();
  }

  @Post('import')
  importPortfolio() {
    return this.importService.importPortfolio();
  }
}
