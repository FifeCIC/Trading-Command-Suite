import { Controller, Get, Post, Delete, Param, Body, HttpCode } from '@nestjs/common';
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

  /**
   * DELETE /api/portfolio/accounts/:id — remove (archive) an account so it stops appearing in the
   * portfolio lists and totals.
   *
   * ⚠️ This is an ARCHIVE, not a deletion at the broker — the broker account and its credential are
   * untouched. It exists because Trading212/Capital accounts are defined by keys in `nest/.env`,
   * which this app cannot edit; without it there is no way to take a closed practice account out of
   * the portfolio at all. MT5 is refused here on purpose (see `setRemoved`) — it has a real,
   * bridge-side removal.
   *
   * `204 No Content` is deliberately NOT used: the client needs the resulting state to render the
   * "Removed" list without re-fetching, and an empty body would make a success indistinguishable
   * from a proxy dropping the response.
   */
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.accountsService.setRemoved(id, true);
  }

  /** POST /api/portfolio/accounts/:id/restore — undo a removal. */
  @Post(':id/restore')
  @HttpCode(200)
  restore(@Param('id') id: string) {
    return this.accountsService.setRemoved(id, false);
  }
}
