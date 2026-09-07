import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { PortfolioAccountsService } from './portfolio-accounts.service';

/**
 * PortfolioAccountsController — account-management API for the multi-account
 * portfolio view. The page calls these endpoints; no account logic in the UI.
 */
@Controller('portfolio/accounts')
export class PortfolioAccountsController {
  constructor(private readonly accountsService: PortfolioAccountsService) {}

  /** GET /api/portfolio/accounts — categories, accounts, and totals for enabled accounts */
  @Get()
  getOverview() {
    return this.accountsService.getOverview();
  }

  /** POST /api/portfolio/accounts/:id — toggle an account or category (id `cat:live`/`cat:demo`) */
  @Post(':id')
  setEnabled(@Param('id') id: string, @Body() body: { enabled?: boolean }) {
    return this.accountsService.setEnabled(id, body.enabled !== false);
  }
}
