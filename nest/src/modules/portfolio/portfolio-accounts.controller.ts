import { Controller, Get, Post, Param, Body, HttpCode } from '@nestjs/common';
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

  /**
   * POST /api/portfolio/accounts/:id — toggle an account or category (id `cat:live`/`cat:demo`).
   *
   * ⚠️ `@HttpCode(200)` IS LOAD-BEARING (fixed 2026-11-06). Without it Nest answers POST with **201
   * Created**, so a REFUSAL (`{ success: false }` for an unknown account) was delivered as
   * `201 Created` and read as a success by any caller checking `res.ok`. This is a toggle — nothing is
   * created — so `200` is also the honest code for the success path. Failures now throw (400/404) from
   * the service rather than travelling in the body.
   */
  @Post(':id')
  @HttpCode(200)
  setEnabled(@Param('id') id: string, @Body() body: { enabled?: boolean }) {
    return this.accountsService.setEnabled(id, body.enabled !== false);
  }
}
