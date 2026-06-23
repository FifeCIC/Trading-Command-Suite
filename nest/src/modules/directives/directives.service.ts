/**
 * PLACEHOLDER — implement per SPRINT.md Task 4.
 *
 * Directives Service
 * ==================
 * Registry and runner for all scoring directives.
 * - Registers directive implementations at module init.
 * - Runs all (or a filtered subset of) directives against input.
 * - Aggregates results for the scoring pipeline.
 *
 * Contract: directives are stateless — this service orchestrates them.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
  TimeModifier,
  TimeWindow,
} from './interfaces/directive.interface';

@Injectable()
export class DirectivesService {
  private readonly logger = new Logger(DirectivesService.name);
  private readonly registry = new Map<string, IDirective>();

  register(directive: IDirective): void {
    if (this.registry.has(directive.id)) {
      this.logger.warn(
        `Directive ${directive.id} already registered — overwriting.`,
      );
    }
    this.registry.set(directive.id, directive);
    this.logger.log(
      `Registered directive: ${directive.id} (${directive.name})`,
    );
  }

  get(id: string): IDirective | undefined {
    return this.registry.get(id);
  }

  list(): IDirective[] {
    return Array.from(this.registry.values());
  }

  /** Run all registered directives against the same input. */
  runAll(input: DirectiveInput): Map<string, DirectiveResult> {
    const results = new Map<string, DirectiveResult>();

    for (const [id, directive] of this.registry) {
      try {
        // ── Time-gate check (activeWindow) ──
        if (directive.activeWindow) {
          const inWindow = this.isInTimeWindow(directive.activeWindow);
          if (!inWindow) {
            results.set(id, {
              score: 0,
              confidence: 0,
              reason: `Outside active window (${directive.activeWindow.start}-${directive.activeWindow.end} ${directive.activeWindow.timezone})`,
              signalClass: 'neutral',
              timeGated: true,
            });
            continue;
          }
        }

        // ── Run the directive ──
        let result = directive.calculate(input);

        // ── Apply time modifiers (timeModifiers) ──
        if (directive.timeModifiers && directive.timeModifiers.length > 0) {
          const applied = this.evaluateTimeModifiers(directive.timeModifiers);
          if (applied.length > 0) {
            const totalAdjustment = applied.reduce((sum, m) => sum + m.adjustment, 0);
            const modifierReasons = applied.map((m) => m.reason).join('; ');
            result = {
              ...result,
              score: Math.max(0, result.score + totalAdjustment),
              reason: result.reason
                ? `${result.reason}. Time modifiers: ${modifierReasons}`
                : `Time modifiers applied: ${modifierReasons}`,
              timeModifiersApplied: applied,
            };
          }
        }

        results.set(id, result);
      } catch (error) {
        this.logger.error(`Directive ${id} threw: ${String(error)}`);
        results.set(id, {
          score: 0,
          confidence: 0,
          reason: `Error: ${String(error)}`,
        });
      }
    }

    return results;
  }

  /**
   * Check if the current time falls within an activeWindow.
   * Uses Node.js Intl.DateTimeFormat with IANA timezone strings (no external lib needed).
   */
  private isInTimeWindow(window: TimeWindow): boolean {
    try {
      const now = new Date();

      // Check daysOfWeek if specified
      if (window.daysOfWeek && window.daysOfWeek.length > 0) {
        const localDay = this.getDayInTimezone(now, window.timezone);
        if (!window.daysOfWeek.includes(localDay)) {
          return false;
        }
      }

      // Get current time in the target timezone
      const localTime = this.getTimeInTimezone(now, window.timezone);
      const [hours, minutes] = localTime.split(':').map(Number);

      const [startH, startM] = window.start.split(':').map(Number);
      const [endH, endM] = window.end.split(':').map(Number);

      const currentMinutes = hours * 60 + minutes;
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } catch (err) {
      this.logger.warn(`Time window check failed for ${window.timezone}: ${(err as Error).message}`);
      return true; // On error, let the directive run (fail-open)
    }
  }

  /**
   * Get the current HH:mm in a specific IANA timezone.
   */
  private getTimeInTimezone(date: Date, timezone: string): string {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(date); // "HH:mm"
  }

  /**
   * Get the day of week (0=Sun, 6=Sat) in a specific IANA timezone.
   */
  private getDayInTimezone(date: Date, timezone: string): number {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
    });
    const dayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3,
      Thu: 4, Fri: 5, Sat: 6,
    };
    return dayMap[formatter.format(date)] ?? new Date().getDay();
  }

  /**
   * Evaluate which time modifiers are currently active.
   * Returns the list of modifiers whose time windows contain the current time.
   */
  private evaluateTimeModifiers(modifiers: TimeModifier[]): { adjustment: number; reason: string }[] {
    const applied: { adjustment: number; reason: string }[] = [];
    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

    for (const modifier of modifiers) {
      const [afterH, afterM] = modifier.after.split(':').map(Number);
      const afterMinutes = afterH * 60 + afterM;

      if (modifier.before) {
        const [beforeH, beforeM] = modifier.before.split(':').map(Number);
        const beforeMinutes = beforeH * 60 + beforeM;
        if (currentMinutes >= afterMinutes && currentMinutes <= beforeMinutes) {
          applied.push({ adjustment: modifier.adjustment, reason: modifier.reason });
        }
      } else {
        if (currentMinutes >= afterMinutes) {
          applied.push({ adjustment: modifier.adjustment, reason: modifier.reason });
        }
      }
    }

    return applied;
  }
}
