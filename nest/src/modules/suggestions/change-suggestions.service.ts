/**
 * change-suggestions.service.ts — THE QUEUE OF CHANGES WE INTEND TO TRY.
 * =======================================================================
 *
 * Owner, 2026-11-18: *"Create a new procedure for suggested/queued changes to make to a protocol…
 * We will also display that same information in the Strategies area on the strategies page so that at
 * the end: the combined suggestion changes to try for both protocol and bot are in one place.
 * Eventually we will automate backtesting and A/B comparison to try changes automatically and I think
 * this is a key step towards guiding that for a bit."*
 *
 * ── WHY THIS IS A TABLE AND NOT A LIST IN A DOCUMENT ──────────────────────────────────────────────
 * A suggested change has a LIFECYCLE: `queued → accepted → applied`, or `rejected`, or `blocked` when
 * it depends on something unbuilt. Prose cannot hold a lifecycle, so a list of intended changes in a
 * document decays into a wish list nobody can act on, audit, or later automate.
 *
 * ── THE THREE RULES THIS SERVICE EXISTS TO ENFORCE ────────────────────────────────────────────────
 *
 * **1. `currentValue = null` IS NOT ZERO.** It means "this does not exist yet". A missing directive and
 * a directive that scores 0 are different facts, and collapsing them is this repo's most expensive
 * defect signature (plausible output, no error). `coverage()` reports them separately.
 *
 * **2. A `missing-directive` row is NOT a directive.** It is a placeholder naming something unbuilt.
 * It is deliberately kept out of the directive registry: a directive that is selectable but computes
 * nothing would let a protocol attach it and look healthy while scoring 0 — exactly the silent zero
 * that #1300 fixed on the backtest path.
 *
 * **3. `issueUrl = null` is REPORTED, not satisfied.** The issue is the durable record of *why*; the
 * row is working material. A queued idea with no issue is allowed, and surfaced, so it cannot quietly
 * become the only record.
 *
 * ── WHAT THIS SERVICE DOES NOT DO ────────────────────────────────────────────────────────────────
 * It does not apply a suggestion to a protocol. Applying means writing `protocol_directive_entry`
 * rows, which changes what a protocol SCORES — a money-path edit that must go through the same
 * parameterisation + A/B discipline as any other maths change. `status = 'applied'` records that
 * someone did it; it does not do it.
 *
 * ── DECISION (2026-11-19, TCS-Dev) ──
 * WHAT:       A queued change is a ROW with a lifecycle, and an unbuilt directive is a PLACEHOLDER row
 *             here — never a registered directive class.
 * WHY:        Prose cannot hold a lifecycle, so a list of intended changes in a document decays into a
 *             wish list nobody can act on, audit, or automate — and automating the trial of changes is
 *             the owner's stated next step. Registering an inert directive so it "shows up" would let a
 *             protocol attach it and look healthy while scoring 0: the silent zero #1300 fixed.
 * INSTEAD OF: A markdown list of intended changes, and `register a stub directive` for the 9 unbuilt
 *             ones. Both were considered; both reproduce a failure this repo already paid for.
 * REVERSE BY: Drop the table and the module. Nothing else reads it, and nothing stored or migrated
 *             depends on it.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 219
 * GUARD:     nest/src/modules/suggestions/change-suggestions.spec.ts
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** The shapes a suggestion can take. `missing-directive` is a placeholder, not an instruction. */
export const SUGGESTION_KINDS = [
  'add-directive',
  'remove-directive',
  'reweight-group',
  'missing-directive',
  'param',
  'bot-rule',
] as const;

export const SUGGESTION_STATUSES = ['queued', 'accepted', 'applied', 'rejected', 'blocked'] as const;

export const SUGGESTION_SCOPES = ['protocol', 'bot', 'strategy'] as const;

export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
export type SuggestionScope = (typeof SUGGESTION_SCOPES)[number];

export interface CreateSuggestionInput {
  scope?: SuggestionScope;
  protocolSlug?: string | null;
  botId?: string | null;
  kind: SuggestionKind;
  targetKey?: string | null;
  currentValue?: string | null;
  suggestedValue?: string | null;
  rationale: string;
  priority?: number;
  issueUrl?: string | null;
  createdBy?: string;
}

export interface SuggestionRow {
  id: string;
  scope: string;
  protocolSlug: string | null;
  botId: string | null;
  kind: string;
  targetKey: string | null;
  currentValue: string | null;
  suggestedValue: string | null;
  rationale: string;
  status: string;
  priority: number;
  issueUrl: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * validateSuggestion() — the admission rules, as a PURE function so they can be asserted without a
 * database. Returns the field that is wrong, or null.
 *
 * ⚠️ Validated on WRITE, not on read. A bad row that reaches the table is displayed to the owner as a
 * requirement, which is worse than a refused request.
 */
export function validateSuggestion(input: Partial<CreateSuggestionInput>): string | null {
  if (!input.kind) return 'kind is required';
  if (!SUGGESTION_KINDS.includes(input.kind as SuggestionKind)) {
    return `kind must be one of ${SUGGESTION_KINDS.join(', ')}`;
  }
  if (input.scope && !SUGGESTION_SCOPES.includes(input.scope as SuggestionScope)) {
    return `scope must be one of ${SUGGESTION_SCOPES.join(', ')}`;
  }
  // A rationale is the whole point of the row. Empty prose here is how a queue becomes noise.
  if (!input.rationale || input.rationale.trim().length < 12) {
    return 'rationale is required and must say why (at least 12 characters)';
  }
  // A protocol-scoped suggestion with no protocol cannot be displayed on the protocol page.
  if ((input.scope ?? 'protocol') === 'protocol' && !input.protocolSlug) {
    return 'protocolSlug is required when scope is "protocol"';
  }
  if (input.scope === 'bot' && !input.botId) {
    return 'botId is required when scope is "bot"';
  }
  const p = input.priority;
  if (p !== undefined && p !== null && (!Number.isInteger(p) || p < 1 || p > 5)) {
    return 'priority must be an integer 1–5 (1 = do first)';
  }
  return null;
}

@Injectable()
export class ChangeSuggestionsService {
  private readonly logger = new Logger(ChangeSuggestionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * list() — the queue, optionally narrowed. Ordered by priority then age, so "what first" is the
   * default reading rather than something the caller has to ask for.
   */
  async list(
    filter: {
      scope?: string;
      protocolSlug?: string;
      botId?: string;
      botIds?: string[];
      status?: string;
      kinds?: string[];
    } = {},
  ): Promise<SuggestionRow[]> {
    const where: Record<string, unknown> = {};
    if (filter.scope) where.scope = filter.scope;
    if (filter.protocolSlug) where.protocolSlug = filter.protocolSlug;
    if (filter.botId) where.botId = filter.botId;
    if (filter.botIds?.length) where.botId = { in: filter.botIds };
    if (filter.status) where.status = filter.status;
    if (filter.kinds?.length) where.kind = { in: filter.kinds };

    const rows = await this.prisma.protocolChangeSuggestion.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return rows as unknown as SuggestionRow[];
  }

  /**
   * forProtocol() — everything queued against a protocol, PLUS everything queued against the bots
   * that subscribe to it.
   *
   * ⚠️ THE BOT LEG IS WHY THIS IS A JOIN AND NOT A FILTER. The owner's requirement is that the
   * combined protocol+bot suggestions appear in ONE place. A protocol-only filter would show half the
   * plan and read as the whole plan — the failure this repo calls "plausible output, no error".
   */
  async forProtocol(slug: string): Promise<{
    protocol: SuggestionRow[];
    bots: SuggestionRow[];
    coverage: SuggestionCoverage;
  }> {
    const protocol = await this.list({ protocolSlug: slug });
    const subs = await this.prisma.strategyProtocol.findMany({
      where: { protocolId: slug },
      select: { strategyId: true },
    });
    const botIds = [...new Set(subs.map((s) => s.strategyId))];
    const bots = botIds.length ? await this.list({ scope: 'bot', botIds }) : [];
    return { protocol, bots, coverage: coverageOf([...protocol, ...bots]) };
  }

  async create(input: CreateSuggestionInput): Promise<SuggestionRow> {
    const problem = validateSuggestion(input);
    if (problem) throw new BadRequestException(problem);

    const scope = (input.scope ?? 'protocol') as SuggestionScope;
    const row = await this.prisma.protocolChangeSuggestion.create({
      data: {
        scope,
        protocolSlug: input.protocolSlug ?? null,
        botId: input.botId ?? null,
        kind: input.kind,
        targetKey: input.targetKey ?? null,
        currentValue: input.currentValue ?? null,
        suggestedValue: input.suggestedValue ?? null,
        rationale: input.rationale.trim(),
        status: 'queued',
        priority: input.priority ?? 3,
        issueUrl: input.issueUrl ?? null,
        createdBy: input.createdBy ?? 'agent',
      },
    });
    this.logger.log(
      `suggestion queued: ${row.kind} ${row.targetKey ?? ''} on ${row.protocolSlug ?? row.botId}`,
    );
    return row as unknown as SuggestionRow;
  }

  /**
   * update() — move a suggestion through its lifecycle.
   *
   * ⚠️ `status: 'applied'` is a RECORD, not an action. It says a human/agent changed the protocol;
   * nothing here writes `protocol_directive_entry`. Claiming otherwise would make this service look
   * like it applies changes it does not.
   */
  async update(
    id: string,
    patch: {
      status?: SuggestionStatus;
      priority?: number;
      issueUrl?: string | null;
      suggestedValue?: string | null;
    },
  ): Promise<SuggestionRow> {
    const existing = await this.prisma.protocolChangeSuggestion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Suggestion ${id} not found`);
    if (patch.status && !SUGGESTION_STATUSES.includes(patch.status)) {
      throw new BadRequestException(`status must be one of ${SUGGESTION_STATUSES.join(', ')}`);
    }
    if (
      patch.priority !== undefined
      && (!Number.isInteger(patch.priority) || patch.priority < 1 || patch.priority > 5)
    ) {
      throw new BadRequestException('priority must be an integer 1–5');
    }
    const row = await this.prisma.protocolChangeSuggestion.update({
      where: { id },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.issueUrl !== undefined ? { issueUrl: patch.issueUrl } : {}),
        ...(patch.suggestedValue !== undefined ? { suggestedValue: patch.suggestedValue } : {}),
      },
    });
    return row as unknown as SuggestionRow;
  }
}

export interface SuggestionCoverage {
  total: number;
  /** Placeholders for directives that do not exist yet. The real backlog. */
  missingDirectives: number;
  /** Rows with no GitHub issue — allowed, and reported. */
  withoutIssue: number;
  byStatus: Record<string, number>;
}

export function coverageOf(rows: SuggestionRow[]): SuggestionCoverage {
  const byStatus: Record<string, number> = {};
  for (const s of SUGGESTION_STATUSES) byStatus[s] = 0;
  let missingDirectives = 0;
  let withoutIssue = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.kind === 'missing-directive') missingDirectives += 1;
    if (!r.issueUrl) withoutIssue += 1;
  }
  return { total: rows.length, missingDirectives, withoutIssue, byStatus };
}
