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
import { DirectiveInput, DirectiveResult, IDirective } from './interfaces/directive.interface';

@Injectable()
export class DirectivesService {
  private readonly logger = new Logger(DirectivesService.name);
  private readonly registry = new Map<string, IDirective>();

  register(directive: IDirective): void {
    if (this.registry.has(directive.id)) {
      this.logger.warn(`Directive ${directive.id} already registered — overwriting.`);
    }
    this.registry.set(directive.id, directive);
    this.logger.log(`Registered directive: ${directive.id} (${directive.name})`);
  }

  get(id: string): IDirective | undefined {
    return this.registry.get(id);
  }

  list(): IDirective[] {
    return Array.from(this.registry.values());
  }

  /** Run all registered directives against the same input. */
  async runAll(input: DirectiveInput): Promise<Map<string, DirectiveResult>> {
    const results = new Map<string, DirectiveResult>();

    for (const [id, directive] of this.registry) {
      try {
        results.set(id, directive.calculate(input));
      } catch (error) {
        this.logger.error(`Directive ${id} threw: ${String(error)}`);
        results.set(id, { score: 0, confidence: 0, reason: `Error: ${String(error)}` });
      }
    }

    return results;
  }
}
