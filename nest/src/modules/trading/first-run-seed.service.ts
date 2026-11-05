import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ProtocolDbService } from '../scoring/protocol-db.service';
import { TradingStrategyService } from './trading-strategy.service';
import { ProgressionService } from '../progression/progression.service';
import { DEFAULT_TRADING_STRATEGIES } from './strategy-seed-data';

/**
 * FirstRunSeedService — give a NEW installation its shipped strategies, once.
 *
 * ── WHY THIS EXISTS (measured 2026-11-02) ──
 *
 * The 2026-11-02 packaging split reduced the shipped seed to three protocols and three bots.
 * Reviewing that work, an empty database was built and the API booted against it, and the result
 * was **zero protocols, zero bots, zero directive groups**. The seeders existed the whole time but
 * only ever ran from an API call (`POST /api/scoring/gated/protocols/seed`,
 * `POST /api/trading/strategies/seed`) — nothing invoked them on install. So the app booted healthy,
 * reported no error, and offered the user nothing: "a package with three strategies" was, in
 * practice, a package with none.
 *
 * ⚠️ THIS SEEDS ONLY WHEN THE TABLE IS EMPTY, and that is the whole safety argument. The seeders
 * themselves are CONVERGENT (#833) — running `seedDefaults()` on a live install would rewrite every
 * bot field the seed declares, reverting deliberate local changes (it once flipped five bots to
 * `semi-auto` and nulled four gold time-stops). Gating on `count() === 0` means an existing
 * installation is never touched, and a fresh one gets exactly what the package ships.
 *
 * ⚠️ ORDER MATTERS. Bots reference a protocol by slug (`trading_strategy.protocolId`), so the
 * protocols must exist first. Both steps are sequential for that reason, not by accident.
 *
 * ⚠️ IT MUST NOT BLOCK BOOT. A failure here is logged and swallowed: a seeding problem must not
 * stop the API from starting, because then nothing can be diagnosed through it.
 */
@Injectable()
export class FirstRunSeedService implements OnModuleInit {
  private readonly logger = new Logger(FirstRunSeedService.name);

  /**
   * Boot work runs after the Nest graph is up and after the DB client is connected — the existing
   * `ScoringStrategyService` uses the same delayed-start shape for the same reason. 5s rather than
   * 3s so protocols land before the bot seeder looks for them.
   */
  private static readonly START_DELAY_MS = 5000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly protocolDb: ProtocolDbService,
    private readonly tradingStrategy: TradingStrategyService,
    private readonly progression: ProgressionService,
  ) {}

  onModuleInit(): void {
    setTimeout(() => {
      void this.seedIfEmpty().catch((err) => {
        this.logger.warn(`First-run seed did not complete: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, FirstRunSeedService.START_DELAY_MS);
  }

  /**
   * The shipped bots, with the ones beyond this install's active-bot ceiling created INACTIVE (#1193).
   *
   * ⚠️ WHY HERE AND NOWHERE ELSE. A fresh install has no activity, so its progression level is 1 and
   * its ceiling is one bot. Seeding all of them ACTIVE would hand a first-day user exactly the
   * concurrency the guardrail exists to withhold — and it would make the limit true only for bots
   * added later, which is not a limit at all.
   *
   * ⚠️ IT CANNOT RETRO-DEACTIVATE ANYTHING, and that is why it is safe: this class only runs when
   * `trading_strategy` is EMPTY. `seedDefaults()` convergence on an existing install is deliberately
   * left ungated — reverting a live bot's active flag because a level changed would be a silent
   * TRADING action taken by a seed run.
   *
   * ⚠️ FAIL-OPEN. If the level cannot be judged, every shipped bot keeps its seeded active flag: a
   * guardrail that cannot read its input must not quietly ship a one-bot install.
   */
  private async seedForInstallLevel() {
    const { limit, judged } = await this.progression.activeBotsForFreshInstall();
    if (!judged || limit === null) {
      this.logger.log(
        judged
          ? 'FIRST RUN — no active-bot ceiling at this level, so the shipped active flags are kept.'
          : 'FIRST RUN — progression level unreadable, so the shipped active flags are kept (fail-open).',
      );
      return DEFAULT_TRADING_STRATEGIES;
    }
    const seeded = DEFAULT_TRADING_STRATEGIES.map((s, index) =>
      index < limit ? s : { ...s, active: false },
    );
    const deactivated = seeded.filter((s, i) => (DEFAULT_TRADING_STRATEGIES[i] as any).active !== false && i >= limit).length;
    this.logger.log(
      `FIRST RUN — progression level allows ${limit} active bot(s); ` +
        `${deactivated} shipped bot(s) created INACTIVE (#1193).`,
    );
    return seeded;
  }

  /** Exposed so the behaviour can be exercised without waiting for a timer. */
  async seedIfEmpty(): Promise<{
    protocolsSeeded: number | null;
    botsCreated: number | null;
    skippedBecause: string | null;
  }> {
    if (!this.prisma.isAvailable) {
      // "Cannot judge" is not "empty". Seeding against an unreachable database would be a guess.
      return { protocolsSeeded: null, botsCreated: null, skippedBecause: 'database unavailable' };
    }

    let protocolsSeeded: number | null = null;
    let botsCreated: number | null = null;

    const protocolCount = await (this.prisma as any).protocol.count();
    if (protocolCount === 0) {
      const r = await this.protocolDb.seedProtocolsToDatabase();
      protocolsSeeded = r.seeded;
      this.logger.log(
        `FIRST RUN — seeded ${r.seeded} protocol(s), ${r.groups} group(s), ${r.entries} directive entr(ies). ` +
          'This runs once, when the database holds no protocols.',
      );
    }

    const botCount = await (this.prisma as any).tradingStrategy.count();
    if (botCount === 0) {
      const hasProtocols = (await (this.prisma as any).protocol.count()) > 0;
      if (!hasProtocols) {
        // ⚠️ REFUSES rather than seeding a bot whose protocol does not exist — the same rule
        // `split-seed-packaging.cjs` enforces at seed time, applied at install time.
        this.logger.warn(
          'FIRST RUN — no protocols exist, so the seeded bots were NOT created. ' +
            'A bot pointing at a missing protocol would look active and never trade.',
        );
      } else {
        const r = await this.tradingStrategy.seedDefaults(await this.seedForInstallLevel());
        botsCreated = r.created;
        this.logger.log(
          `FIRST RUN — created ${r.created} bot(s) (${r.unchanged} already present, ${r.failed} failed).`,
        );
      }
    }

    return { protocolsSeeded, botsCreated, skippedBecause: null };
  }
}
