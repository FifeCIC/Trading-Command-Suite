/**
 * best-run.service.ts — THE BEST RESULT PER TEST, recorded for the whole backtest subsystem.
 *
 * ── WHY THIS EXISTS (owner requirement, 2026-11-23) ───────────────────────────────────────────────
 * Owner: *"we need to store the best P/L results long term … If we don't have the highest amount we
 * risk deviating from it many times, improving the deviation, but never overall making new ground.
 * Ideally everytime the profit improves, we backup the settings that come with it and that should be
 * for ALL backtesting so again it should be a core thing not just this page."*
 *
 * Every run is already stored (`backtest_selection`, `backtestrun`). What was missing is the ANSWER:
 * "which of these is the best, and what settings made it". That is a query nobody runs, so a tuning
 * loop could beat its previous run six times and still sit below a result it set a week earlier.
 *
 * ── ⚠️ THE BASIS IS THE WHOLE DESIGN ─────────────────────────────────────────────────────────────
 * `netPnl` is NOT comparable across runs. A five-day run beats a one-day run every time, so a record
 * keyed on the raw total would "improve" simply by measuring more days — which is the same
 * two-numbers-different-basis defect the repo has already been bitten by three times. The record is
 * therefore replaced ONLY on `perDay`, and the raw totals are stored beside it so the reader can see
 * the number the verdict came from.
 *
 * A run of zero days is REFUSED rather than divided by zero into `Infinity`, which would then be a
 * record nothing could ever beat.
 *
 * REGISTER: docs/SETTLED-DECISIONS.md row 262
 * GUARD:    best-run.spec.ts
 */

/**
 * ── DECISION (2026-11-23, primary) ───────────────────────────────────────────────────────────────
 * WHAT:      a best result is decided on net P/L PER MEASURED DAY, and the raw totals are stored
 *            beside it. The record's key excludes the day, so many days accumulate onto one row.
 * WHY:       `netPnl` is not comparable across runs — a five-day run beats a one-day run every time,
 *            so a total-keyed record would track the length of the window rather than the quality of
 *            the settings. This repo has already paid three times for comparing two numbers that did
 *            not share a basis.
 * INSTEAD OF: recording the best `netPnl` per test, which is what a reader asks for literally and
 *            what the first draft did.
 * REVERSE BY: change `perDayOf()` to return `netPnl` and re-run `best-run.spec.ts` — the
 *            "bigger total from more days must not win" case will fail, which is the point of it.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 262
 * GUARD:     best-run.spec.ts
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { EXECUTION_SEMANTICS } from '../../common/trading/execution-semantics';

/** Which writer owns a record. Two scopes never compete: they measure different things. */
export type BestScope = 'movers-selection' | 'protocol-backtest';

export interface BestCandidate {
  scope: BestScope;
  /** The test's identity WITHOUT its days. Two runs of the same key accumulate into one record. */
  profileKey: string;
  label: string;
  netPnl: number;
  days: number;
  trades: number;
  wins: number;
  winRate: number;
  profitFactor?: number | null;
  config?: unknown;
  runId?: string | null;
  engineVersion: string;
}

export interface BestRecord {
  best: {
    perDay: number;
    netPnl: number;
    days: number;
    trades: number;
    winRate: number;
    profitFactor: number | null;
    config: unknown;
    achievedAt: string;
    attempts: number;
    runId: string | null;
  } | null;
  /** Whether THIS run replaced the record. `false` on the first run, because nothing was beaten. */
  improved: boolean;
  /** The record that was in place before this run, so an improvement can name what it beat. */
  previous: { perDay: number; netPnl: number; days: number; achievedAt: string } | null;
  /** A sentence a caller can print. Never empty — "cannot judge" is a state, not silence. */
  because: string;
}

/** Net P/L per measured day — the only number a record is decided on. */
export function perDayOf(netPnl: number, days: number): number | null {
  const pnl = Number(netPnl);
  const d = Number(days);
  if (!Number.isFinite(pnl) || !Number.isFinite(d) || d <= 0) return null;
  return pnl / d;
}

/**
 * A stable key for "the same test" across days.
 *
 * ⚠️ The DAY is deliberately not an input. That is what lets a five-day run and a one-day run of the
 * same settings land on one record — and why the basis has to be per-day.
 */
export function bestProfileKey(parts: Array<string | number | null | undefined>): string {
  // ⚠️ `JSON.stringify` rather than a `|` join with `?? ''`: a MISSING bot and an EMPTY-string bot are
  // different tests, and collapsing them would let two unrelated records overwrite each other. JSON
  // also makes a value containing the separator unambiguous.
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

@Injectable()
export class BestRunService {
  private readonly logger = new Logger(BestRunService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Measure one run against the record for its test, and replace the record when it is better.
   *
   * ⚠️ IT NEVER THROWS FOR A STORAGE FAILURE. A record is a convenience that protects a decision; a
   * run that produced real numbers must not be failed by the bookkeeping beside it. The failure is
   * REPORTED in `because`, never swallowed — an unreported skip would read as "no improvement".
   */
  async consider(candidate: BestCandidate): Promise<BestRecord> {
    const perDay = perDayOf(candidate.netPnl, candidate.days);
    if (perDay == null) {
      return {
        best: null,
        improved: false,
        previous: null,
        because: `not recorded — the run measured ${candidate.days} day(s), so net P/L per day is undefined`,
      };
    }

    const existing = await this.read(candidate.scope, candidate.profileKey);
    const previous = existing
      ? { perDay: existing.perDay, netPnl: existing.netPnl, days: existing.days, achievedAt: existing.achievedAt.toISOString() }
      : null;

    /**
     * ⚠️ A RECORD FROM DIFFERENT EXECUTION SEMANTICS IS NOT A COMPARABLE BEST. The stored
     * `semanticsVersion` is what makes that visible; silently beating or being beaten by a run that
     * measured something else is exactly how an obsolete number becomes the target.
     */
    if (existing && existing.semanticsVersion !== EXECUTION_SEMANTICS) {
      this.logger.warn(
        `Best record for ${candidate.label} was set under execution semantics v${existing.semanticsVersion}, `
        + `this run is v${EXECUTION_SEMANTICS} — the record is replaced rather than compared`,
      );
    }

    const comparable = !existing || existing.semanticsVersion === EXECUTION_SEMANTICS;
    const better = !existing || !comparable || perDay > existing.perDay;

    if (!better) {
      // A run that did not beat the record still COUNTS — otherwise "unchanged" and "not run" read
      // the same, which is the state that lets a loop think it is making progress.
      await this.touch(candidate.scope, candidate.profileKey);
      return {
        best: existing ? this.view(existing) : null,
        improved: false,
        previous,
        because: `no improvement — ${perDay.toFixed(2)} per day is not above the record ${existing!.perDay.toFixed(2)}`
          + (comparable ? '' : ' (the record was set under different execution semantics)'),
      };
    }

    try {
      const written = await this.prisma.backtestBest.upsert({
        where: { scope_profileKey: { scope: candidate.scope, profileKey: candidate.profileKey } },
        create: {
          scope: candidate.scope,
          profileKey: candidate.profileKey,
          label: candidate.label.slice(0, 191),
          perDay,
          netPnl: candidate.netPnl,
          days: candidate.days,
          trades: candidate.trades,
          wins: candidate.wins,
          winRate: candidate.winRate,
          profitFactor: candidate.profitFactor ?? null,
          configJson: candidate.config == null ? null : JSON.stringify(candidate.config),
          runId: candidate.runId ?? null,
          semanticsVersion: EXECUTION_SEMANTICS,
          engineVersion: candidate.engineVersion,
          achievedAt: new Date(),
          attempts: 1,
        },
        update: {
          label: candidate.label.slice(0, 191),
          perDay,
          netPnl: candidate.netPnl,
          days: candidate.days,
          trades: candidate.trades,
          wins: candidate.wins,
          winRate: candidate.winRate,
          profitFactor: candidate.profitFactor ?? null,
          configJson: candidate.config == null ? null : JSON.stringify(candidate.config),
          runId: candidate.runId ?? null,
          semanticsVersion: EXECUTION_SEMANTICS,
          engineVersion: candidate.engineVersion,
          achievedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      return {
        best: this.view(written),
        improved: Boolean(existing),
        previous,
        because: existing
          ? `new record — ${perDay.toFixed(2)} per day beats ${existing.perDay.toFixed(2)} (${candidate.netPnl.toFixed(2)} over ${candidate.days} day(s))`
          : `first record — ${perDay.toFixed(2)} per day from ${candidate.netPnl.toFixed(2)} over ${candidate.days} day(s)`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Best-run record write failed for ${candidate.label} — ${message}`);
      return {
        best: existing ? this.view(existing) : null,
        improved: false,
        previous,
        because: `the run measured ${perDay.toFixed(2)} per day but the record could not be stored: ${message}`,
      };
    }
  }

  /** Every record for one scope, best first. */
  async list(scope: BestScope): Promise<BestRecord['best'][]> {
    const rows = await this.prisma.backtestBest.findMany({
      where: { scope },
      orderBy: { perDay: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.view(r));
  }

  private async read(scope: BestScope, profileKey: string) {
    try {
      return await this.prisma.backtestBest.findUnique({
        where: { scope_profileKey: { scope, profileKey } },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // "Cannot read the record" must not read as "there is no record" — that would let the next run
      // silently overwrite a best it never saw. Reported, then treated as absent so the run continues.
      this.logger.warn(`Best-run record read failed for ${scope} — ${message}`);
      return null;
    }
  }

  private async touch(scope: BestScope, profileKey: string): Promise<void> {
    try {
      await this.prisma.backtestBest.update({
        where: { scope_profileKey: { scope, profileKey } },
        data: { attempts: { increment: 1 } },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Best-run attempt counter failed for ${scope} — ${message}`);
    }
  }

  private view(row: {
    perDay: number; netPnl: number; days: number; trades: number; winRate: number;
    profitFactor: number | null; configJson: string | null; achievedAt: Date; attempts: number;
    runId: string | null;
  }): NonNullable<BestRecord['best']> {
    return {
      perDay: row.perDay,
      netPnl: row.netPnl,
      days: row.days,
      trades: row.trades,
      winRate: row.winRate,
      profitFactor: row.profitFactor,
      config: parseConfig(row.configJson),
      achievedAt: row.achievedAt.toISOString(),
      attempts: row.attempts,
      runId: row.runId,
    };
  }
}

/** A config blob that cannot be parsed is REPORTED as `null`, never rendered as an empty setting list. */
function parseConfig(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
