/**
 * StrategyRegistryService — the MATERIALISE step (#875).
 * ======================================================
 * The derived view (`StrategyDerivationService`) stays PURE: computed per read, keyed by a
 * content hash over the whole configuration, disposable. This service is the durable half:
 *
 *   • a STABLE id that never changes (the handle),
 *   • an optional owner NAME (renaming never mints a second strategy),
 *   • the ACCEPTED parts snapshot + accepted strategyKey (drift = current key ≠ accepted key),
 *   • `reaccept()` to accept the current configuration after a part was edited.
 *
 * ⚠️ KEY vs ID — do not conflate them. `strategyKey` is CONTENT (changes when a part changes; that
 * is what makes drift visible). `id` is IDENTITY (stable forever; what a name pins to, and what
 * backups/attribution should reference). #875's acceptance hinges on both existing separately:
 * "editing a part does not silently orphan the name" is impossible with a hash alone.
 *
 * AUTO-REGISTRATION (the owner's design: "if a generated card is new then it can also
 * automatically be registered and get an ID"). `syncAuto()` — called from the automation loop, NOT
 * from the derived GET (a read must not write, and registering on render would mint identities for
 * combinations that only ever appeared in a list) — registers a combination when it is
 * MATERIALISED: it has a live bot (`active`), is not a duplicate group, and none of its bots are
 * already covered by a registered row. That last condition is load-bearing: when a registered bot's
 * config is edited, the successor combination must NOT get a parallel identity — it is the SAME
 * strategy DRIFTED, and the owner resolves it with `reaccept()`.
 */

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { DerivedStrategy, StrategyDerivationService } from './strategy-derivation.service';

/** The accepted parts snapshot — the whole combination. Seeds the full-pipeline backup (#875 B). */
export interface StrategyParts {
  protocolIds: string[];
  protocolRoles: string[];
  botIds: string[];
  botNames: string[];
  symbols: string[];
  scoringStrategyIds: string[];
  brokers: string[];
  treatment: DerivedStrategy['treatment'];
}

/** One field that changed between the accepted snapshot and the current configuration. */
export interface RegistryChange {
  field: string;
  from: string;
  to: string;
}

export interface RegisteredStrategyView {
  id: string;
  strategyKey: string;
  name: string | null;
  source: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  parts: StrategyParts;
  /**
   * steady         — the current derived key equals the accepted key.
   * drifted        — the parts were edited; `changed` lists the differences.
   * unmaterialised — none of this strategy's bots currently derives anything (bot deleted or
   *                  lost its protocol link). The name is kept; nothing derives into it.
   */
  status: 'steady' | 'drifted' | 'unmaterialised';
  current?: {
    strategyKey: string;
    botNames: string[];
    symbols: string[];
    treatment: DerivedStrategy['treatment'];
  };
  changed: RegistryChange[];
}

@Injectable()
export class StrategyRegistryService {
  private readonly logger = new Logger(StrategyRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly derivation: StrategyDerivationService,
  ) {}

  /**
   * Register a derived combination. Idempotent by `strategyKey`; a name supplied for an existing
   * UNNAMED row fills it (auto rows arrive unnamed and this is how they get named).
   * Refuses a key that is not currently materialised — a registry entry must describe something
   * that exists, or backup/restore would carry ghosts.
   */
  async register(strategyKey: string, opts: { name?: string; source?: 'owner' | 'auto' } = {}) {
    const key = (strategyKey ?? '').trim();
    if (!key) throw new BadRequestException('strategyKey is required');

    const existing = await this.prisma.strategyRegistry.findUnique({ where: { strategyKey: key } });
    if (existing) {
      if (opts.name && !existing.name) {
        const renamed = await this.rename(existing.id, opts.name);
        return { ...renamed, created: false };
      }
      return { ...existing, created: false };
    }

    const card = await this.findCard(key);
    if (!card) {
      throw new BadRequestException(
        `No materialised strategy has key ${key}. A strategy can only be registered while a bot's ` +
          `current configuration derives it — check the derived list for the current key (#875).`,
      );
    }

    const row = await this.prisma.strategyRegistry.create({
      data: {
        id: crypto.randomUUID(),
        strategyKey: key,
        name: opts.name?.trim().slice(0, 120) || null,
        source: opts.source === 'auto' ? 'auto' : 'owner',
        parts: this.partsOf(card) as any,
      },
    });
    this.logger.log(
      `Strategy registered (${row.source}): ${key}${row.name ? ` as "${row.name}"` : ''} — ${card.botNames.join(' · ')}`,
    );
    return { ...row, created: true };
  }

  /**
   * Rename a registered strategy. NEVER mints a second strategy — the id and accepted parts are
   * untouched. An empty name clears the label (the row stays registered).
   */
  async rename(id: string, name: string) {
    const row = await this.prisma.strategyRegistry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Registered strategy ${id} not found`);
    const trimmed = (name ?? '').trim();
    if (trimmed.length > 120) throw new BadRequestException('name must be 120 characters or fewer');
    const updated = await this.prisma.strategyRegistry.update({
      where: { id },
      data: { name: trimmed || null },
    });
    if (trimmed) this.logger.log(`Strategy renamed: ${row.strategyKey} -> "${trimmed}"`);
    return updated;
  }

  /**
   * Re-accept the CURRENT configuration as this strategy's definition (the drift resolution).
   * Updates the accepted key + parts to what the bots derive now, after reporting what changed.
   * Refuses when the target key is already held by ANOTHER row — that is a merge the owner must
   * make deliberately, not something to guess at.
   */
  async reaccept(id: string) {
    const row = await this.prisma.strategyRegistry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Registered strategy ${id} not found`);
    const parts = (row.parts ?? {}) as unknown as StrategyParts;

    const derived = await this.derivation.deriveAll();
    const current = this.cardForBots(derived.strategies, parts.botIds ?? []);
    if (!current) {
      throw new BadRequestException(
        `None of this strategy's ${(parts.botIds ?? []).length} bot(s) currently derives a strategy — ` +
          `the bot may have been deleted or lost its protocol link. Nothing to re-accept.`,
      );
    }

    const changed = current.strategyKey === row.strategyKey ? [] : this.diff(parts, current);
    if (current.strategyKey !== row.strategyKey) {
      const clash = await this.prisma.strategyRegistry.findUnique({
        where: { strategyKey: current.strategyKey },
      });
      if (clash && clash.id !== id) {
        throw new ConflictException(
          `The current configuration (${current.strategyKey}) is already registered as ` +
            `"${clash.name ?? clash.id}". Two identities for one combination would be worse than ` +
            `the drift — resolve or remove that row first.`,
        );
      }
    }

    const updated = await this.prisma.strategyRegistry.update({
      where: { id },
      data: { strategyKey: current.strategyKey, parts: this.partsOf(current) as any },
    });
    this.logger.log(
      `Strategy re-accepted: ${row.strategyKey} -> ${current.strategyKey}` +
        (changed.length ? ` (${changed.length} field change(s))` : ' (no change)'),
    );
    return { ...updated, status: changed.length ? ('reaccepted' as const) : ('steady' as const), changed };
  }

  /** Registered strategies joined with the live derivation: steady / drifted / unmaterialised. */
  async list() {
    const [rows, derived] = await Promise.all([
      this.prisma.strategyRegistry.findMany({ orderBy: { createdAt: 'asc' } }),
      this.derivation.deriveAll(),
    ]);

    const strategies: RegisteredStrategyView[] = rows.map((row) => {
      const parts = (row.parts ?? {}) as unknown as StrategyParts;
      const base = {
        id: row.id,
        strategyKey: row.strategyKey,
        name: row.name,
        source: row.source,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        parts,
      };
      const current = this.cardForBots(derived.strategies, parts.botIds ?? []);
      if (!current) return { ...base, status: 'unmaterialised' as const, changed: [] };
      if (current.strategyKey === row.strategyKey) {
        return { ...base, status: 'steady' as const, current: this.currentOf(current), changed: [] };
      }
      return {
        ...base,
        status: 'drifted' as const,
        current: this.currentOf(current),
        changed: this.diff(parts, current),
      };
    });

    return {
      strategies,
      total: strategies.length,
      named: strategies.filter((s) => !!s.name).length,
      drifted: strategies.filter((s) => s.status === 'drifted').length,
      unmaterialised: strategies.filter((s) => s.status === 'unmaterialised').length,
      derivedAt: derived.derivedAt,
    };
  }

  /**
   * Auto-registration (called by the automation loop — see the header for why not on read).
   * Registers ONLY newly materialised combinations; successors of registered bots are skipped so
   * one combination never gets two identities. Idempotent, safe to call every tick.
   */
  async syncAuto(): Promise<{ created: number; checked: number }> {
    const derived = await this.derivation.deriveAll();
    const rows = await this.prisma.strategyRegistry.findMany({
      select: { strategyKey: true, parts: true },
    });
    const registeredKeys = new Set(rows.map((r) => r.strategyKey));
    const registeredBots = new Set<string>();
    for (const r of rows) {
      for (const b of ((r.parts as any)?.botIds ?? []) as string[]) registeredBots.add(b);
    }

    const fresh = derived.strategies.filter(
      (c) =>
        c.active &&
        c.botCount === 1 && // a duplicate group is a fault to fix, not an identity to mint
        !registeredKeys.has(c.strategyKey) &&
        c.botIds.every((b) => !registeredBots.has(b)),
    );

    if (fresh.length === 0) return { created: 0, checked: derived.strategies.length };

    const res = await this.prisma.strategyRegistry.createMany({
      data: fresh.map((c) => ({
        id: crypto.randomUUID(),
        strategyKey: c.strategyKey,
        name: null,
        source: 'auto',
        parts: this.partsOf(c) as any,
      })),
      skipDuplicates: true,
    });
    if (res.count > 0) {
      this.logger.log(`Auto-registered ${res.count} newly materialised strategy(ies) (#875).`);
    }
    return { created: res.count, checked: derived.strategies.length };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────────────────────

  private async findCard(key: string): Promise<DerivedStrategy | null> {
    const derived = await this.derivation.deriveAll();
    return derived.strategies.find((s) => s.strategyKey === key) ?? null;
  }

  /** The current card containing ANY of the registered bots — drift is per-bot, not per-key. */
  private cardForBots(cards: DerivedStrategy[], botIds: string[]): DerivedStrategy | null {
    if (!botIds.length) return null;
    return cards.find((c) => c.botIds.some((b) => botIds.includes(b))) ?? null;
  }

  private partsOf(card: DerivedStrategy): StrategyParts {
    return {
      protocolIds: card.protocolIds,
      protocolRoles: card.protocolRoles,
      botIds: card.botIds,
      botNames: card.botNames,
      symbols: card.symbols,
      scoringStrategyIds: card.scoringStrategyIds,
      brokers: card.brokers,
      treatment: card.treatment,
    };
  }

  private currentOf(card: DerivedStrategy) {
    return {
      strategyKey: card.strategyKey,
      botNames: card.botNames,
      symbols: card.symbols,
      treatment: card.treatment,
    };
  }

  /** Field-level difference between the accepted snapshot and the current configuration. */
  private diff(parts: StrategyParts, card: DerivedStrategy): RegistryChange[] {
    const changes: RegistryChange[] = [];
    const listFields: Array<keyof StrategyParts & string> = ['protocolIds', 'protocolRoles', 'symbols', 'scoringStrategyIds', 'brokers'];
    for (const f of listFields) {
      const from = ((parts[f] as string[]) ?? []).join(', ');
      const to = ((card as any)[f] as string[] ?? []).join(', ');
      if (from !== to) changes.push({ field: f, from: from || '—', to: to || '—' });
    }
    const tFrom = (parts.treatment ?? {}) as Record<string, unknown>;
    const tTo = (card.treatment ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(tTo)) {
      const a = tFrom[k];
      const b = tTo[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        changes.push({
          field: k,
          from: a === null || a === undefined ? '—' : String(a),
          to: b === null || b === undefined ? '—' : String(b),
        });
      }
    }
    return changes;
  }
}
