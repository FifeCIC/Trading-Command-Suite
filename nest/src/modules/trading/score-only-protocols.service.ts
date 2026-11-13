/**
 * score-only-protocols.ts — WHICH PROTOCOLS A BOT MAY SCORE AGAINST BUT MUST NEVER TRADE.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (2026-11-13, #1258)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A maths-change copy exists to answer a scoring question. One of them deliberately must NOT be
 * able to spend money — `scripts/protocol-copies.json` says so in as many words for
 * `xau-speed-v1-long-copy`:
 *
 *   > *"Twin bot 'Silver Speed Scalp Bot (copy) Bot' scores XAGUSD only and its subscriptions were
 *   > DELETED, so it cannot queue an order — a scoring question must not spend demo money."*
 *
 * …and it carries the machine-readable flag `"scoreOnly": true` for exactly that reason.
 *
 * ⚠️ THE DEFECT THIS CLOSES. `seedDefaults()` repairs a missing `strategy_protocol` row for every
 * bot it seeds — correct, because a bot with no subscription silently never trades (#874). But it
 * cannot tell "the subscription was lost" from "the subscription was deleted ON PURPOSE", so once
 * the copy bot entered the seed (generated from the live fleet, #1258) a routine seed run would
 * RE-CREATE that subscription and hand a score-only bot the ability to place an order.
 *
 * **Measured 2026-11-13:** `POST /api/trading/strategies/seed?dryRun=true` reported
 * `subscriptionsRepaired: 1` — that one row. A seeder taking a trading action nobody asked for is
 * the class of change this repo treats as a money-path defect, not a tidy-up.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE SOURCE OF TRUTH IS `scripts/protocol-copies.json`, DELIBERATELY
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * That file already declares every `-copy` protocol, its experiment and its expected `active` flag,
 * and `audit-protocol-copies.cjs` fails the build when the declaration and the database disagree.
 * Reading it here means ONE declaration serves both the audit and the seeder — a second list in
 * TypeScript would drift and only one of the two would get the next fix.
 *
 * ⚠️ FAILS CLOSED. If the manifest cannot be read, subscription repair is SUPPRESSED and the reason
 * is logged. The alternative — assuming no protocol is score-only — would grant trading capability
 * to a bot that was deliberately made inert, and that is the one direction this must never drift.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/** Where the declaration lives, relative to the repository root. */
const MANIFEST_RELATIVE = path.join('scripts', 'protocol-copies.json');

export interface ScoreOnlyResolution {
  /** TRUE when subscription repair must be suppressed for this protocol. */
  scoreOnly: boolean;
  /** ⚠️ TRUE when the manifest could not be read — callers must fail CLOSED, not open. */
  unreadable: boolean;
  reason: string;
}

@Injectable()
export class ScoreOnlyProtocolService implements OnModuleInit {
  private readonly logger = new Logger(ScoreOnlyProtocolService.name);
  private set: Set<string> | null = null;
  private loadError: string | null = null;

  onModuleInit(): void {
    this.ensureLoaded();
  }

  /**
   * The repository root — found by WALKING UP until `scripts/protocol-copies.json` appears.
   *
   * ⚠️ WHY NOT A FIXED `../../..` DEPTH. Measured 2026-11-13: the compiled file lives at
   * `nest/dist/src/modules/trading/`, the source at `nest/src/modules/trading/`, and the manifest at
   * `<repo>/scripts/protocol-copies.json` — one level ABOVE `nest/`. A hardcoded depth resolved to
   * `nest/` under `dist` and the service reported the manifest unreadable, so the seed dry run said
   * `subscriptionsSuppressed: 75` (everything, fail-closed) instead of the one score-only protocol.
   * Walking up is depth-independent and cannot be got wrong by a later move.
   */
  private rootDir(): string {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, MANIFEST_RELATIVE))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    // Not found — return the best guess so the error message names a real path.
    return path.resolve(__dirname, '..', '..', '..', '..');
  }

  private ensureLoaded(): void {
    if (this.set || this.loadError) return;
    const file = path.join(this.rootDir(), MANIFEST_RELATIVE);
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const manifest = JSON.parse(raw) as Record<string, any>;
      const out = new Set<string>();
      for (const [slug, entry] of Object.entries(manifest)) {
        if (slug.startsWith('__')) continue; // `__comment`, `__abTestIds`, `__orphanScoreHistory`
        if (entry && typeof entry === 'object' && entry.scoreOnly === true) out.add(slug);
      }
      this.set = out;
      if (out.size) {
        this.logger.log(
          `Score-only protocol(s) — subscription repair suppressed: ${[...out].join(', ')}`,
        );
      }
    } catch (err: any) {
      this.loadError = `could not read ${MANIFEST_RELATIVE}: ${err?.message ?? err}`;
      this.logger.error(
        `ScoreOnlyProtocolService: ${this.loadError}. Subscription repair will be SUPPRESSED ` +
          '(failing closed) — a score-only bot must never be given a trading route because a file ' +
          'was missing.',
      );
    }
  }

  /**
   * May a bot be subscribed to this protocol by a SEED run?
   *
   * ⚠️ The answer is `true` only when the manifest was read AND the protocol is not marked
   * score-only. An unreadable manifest returns `false` for everything, with `unreadable: true` so
   * the caller can say why it skipped.
   */
  maySubscribe(protocolId: string): boolean {
    this.ensureLoaded();
    if (this.loadError) return false;
    return !(this.set?.has(protocolId) ?? false);
  }

  /** Why a subscription was suppressed, for the seed's `changes`/log line. */
  resolve(protocolId: string): ScoreOnlyResolution {
    this.ensureLoaded();
    if (this.loadError) {
      return { scoreOnly: false, unreadable: true, reason: this.loadError };
    }
    if (this.set?.has(protocolId)) {
      return {
        scoreOnly: true,
        unreadable: false,
        reason:
          `${protocolId} is declared "scoreOnly": true in scripts/protocol-copies.json — it exists ` +
          'to answer a SCORING question and must never be given an order route',
      };
    }
    return { scoreOnly: false, unreadable: false, reason: 'not score-only' };
  }
}
