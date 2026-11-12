import { Injectable, Logger } from '@nestjs/common';
import { SettingsResolverService } from '../../../common/settings/settings-resolver.service';
import type { NotificationMessage } from '../notifications.service';

/**
 * A claimed signal window, carrying BOTH previous values so a failed post can restore them exactly.
 * `null` means "there was no row", which releases by DELETING rather than by writing an empty value.
 */
export interface SignalSlot {
  subject: string;
  previous: string | null;
  /** Raw previous value of the channel-wide key — `''` when it was blank, so restore is exact. */
  globalPrevious: string;
}

/**
 * DiscordChannel — TWO DESTINATIONS, and they are not the same thing.
 *
 *   1. THE OPERATOR FEED (`DISCORD_WEBHOOK_URL`) — every event, unchanged since #652/#653. One
 *      webhook, one private channel, no policy. Existing behaviour preserved exactly, including
 *      throwing on failure so notification history records a failure.
 *
 *   2. THE PUBLIC FEED (`signals` / `wins` / `losses`) — published through the Intranet gateway by
 *      CHANNEL KEY, subject to the owner's publishing policy. Added 2026-11-06.
 *
 * ── WHY A POLICY LIVES HERE AND NOT IN THE DISPATCHER ───────────────────────────────────────────
 * `notifications.service.ts` answers "who should be told about this event". That is a different
 * question from "is this worth publishing publicly". Merging them would mean muting a noisy public
 * feed also muted an operator alert — the failure mode the mandatory-event rule already exists to
 * prevent. So per-event preferences stay where they are, and these rules sit in the channel that
 * actually speaks in public.
 *
 * ── THE OWNER'S RULES ───────────────────────────────────────────────────────────────────────────
 *   "I do not want ALL signals to be shared. Only one per day for now to create the system and keep
 *    it well tested."                                            -> the RATION (see below)
 *   "I don't think we should share trade wins and losses that are within a dollar. That might reduce
 *    what is essentially noise."                                  -> minPnlToAnnounce (default 1)
 *   "change the rule to message the signals channel once per hour for each strategy" (2026-11-06)
 *                                                    -> signalMinIntervalMinutes (default 60)
 *
 * ⚠️ THE RATION IS PER STRATEGY, NOT GLOBAL (changed 2026-11-06). It was one signal per UTC day for
 * the whole app, keyed on two settings (`lastSignalDate` / `lastSignalCount`). That answered "has
 * the feed published today" — not "has THIS strategy published recently" — so the first strategy to
 * print a signal spent the whole day's allowance and every other strategy was silenced until
 * midnight. The feed ended up reporting the calendar rather than the market. The per-strategy
 * timestamp now lives in the `discordSignalLastPost` setting FAMILY, which is never seeded, so an
 * install that never publishes never carries the data (the owner's stated reason for wanting
 * metadata rather than a column).
 *
 * Both numbers are SETTINGS, not constants. A published message cannot be un-published, so the
 * numbers that decide what goes out must be inspectable and changeable without a deploy.
 *
 * ⚠️ "CANNOT JUDGE" IS NOT "A WIN". A closed trade with no usable P&L is NOT published. Routing an
 * unknown outcome to `wins` would put a fabricated success in front of an audience.
 *
 * ── DECISION (2026-11-06, primary) ──
 * WHAT:      TWO gates on the signal feed, both claimed before the post:
 *              `signalMinGlobalIntervalMinutes` (15) — the CHANNEL ceiling, shared by all strategies
 *              `signalMinIntervalMinutes` (60)       — each STRATEGY's own window
 *            The per-strategy memory is the `discordSignalLastPost` setting FAMILY; the channel
 *            memory is one declared setting, `notifications.discord.lastSignalAt`.
 * WHY:       two different failures, so one number cannot fix both. A GLOBAL-only daily allowance let
 *            the first strategy to print consume the whole day. A PER-STRATEGY-only window then
 *            measured ~15 messages/hour in a public channel, because the ladder routinely carries
 *            13-19 actionable strategies. The owner chose "global cap plus per-strategy window" on
 *            2026-11-06. The family is the only home that costs an install which never publishes
 *            exactly nothing, which is the owner's stated reason for wanting metadata over a column.
 *            ⚠️ The channel key is deliberately NOT a family: it has one member, and a one-member
 *            family is an individual declaration wearing a pattern.
 * INSTEAD OF: (a) one signal per UTC day for the whole app — the original implementation;
 *            (b) per-strategy only, with no channel ceiling — good for ~11 minutes of live traffic
 *            and then demonstrably a flood; (c) an in-memory Map, which dies on every `build:api`;
 *            (d) a new column on `protocol` / `trading_strategy`, which ships to every install.
 * REVERSE BY: set `signalMinGlobalIntervalMinutes` to 0 — that disables the ceiling without
 *            removing the mechanism, and one setting is a cheaper reversal than a code change.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 152
 * GUARD:     nest/src/modules/notifications/channels/discord.channel.spec.ts — both windows are
 *            canaried from BOTH sides (59/60 minutes; 14/15 minutes), the interaction (ceiling clear
 *            but strategy throttled) is pinned, and the per-strategy cases DISABLE the ceiling so a
 *            pass cannot come from the wrong gate.
 */
@Injectable()
export class DiscordChannel {
  private readonly logger = new Logger(DiscordChannel.name);

  /** The family member holding one strategy's last publish time. */
  private static lastPostKey(subject: string): string {
    return `notifications.discord.lastSignal.${subject}.at`;
  }

  /** The channel-wide ceiling's memory — ONE value, so a declared setting and not a family. */
  private static readonly GLOBAL_LAST_POST_KEY = 'notifications.discord.lastSignalAt';

  constructor(private readonly settings: SettingsResolverService) {}

  /** The legacy single-channel operator webhook. Unchanged behaviour. */
  private get webhookUrl(): string {
    return process.env.DISCORD_WEBHOOK_URL || '';
  }

  async send(msg: NotificationMessage): Promise<void> {
    // 1. Operator feed — exactly as before. Failures still throw so history records them.
    if (this.webhookUrl) {
      await this.postWebhook(this.webhookUrl, this.buildEmbed(msg));
    }

    // 2. Public feed — never throws; a public post failing is not an operator-notification failure.
    try {
      await this.publishToFeed(msg);
    } catch (err) {
      this.logger.warn(`Discord feed publish failed: ${(err as Error).message}`);
    }
  }

  // ── Public feed ────────────────────────────────────────────────────────────

  private async publishToFeed(msg: NotificationMessage): Promise<void> {
    const enabled = await this.booleanSetting('notifications.discord.publishEnabled', true);
    if (!enabled) return;

    const channel = await this.feedChannelFor(msg);
    if (channel === null) return;

    // The ration applies ONLY to signals; a closed trade is a fact about money and is not rationed.
    let slot: SignalSlot | null = null;
    if (channel === 'signals') {
      slot = await this.claimSignalSlot(this.signalSubject(msg));
      if (slot === null) {
        // Debug, not log: this fires on EVERY tick for the rest of the window once a strategy's
        // allowance is spent, and a warning that repeats by design trains the reader to ignore it.
        this.logger.debug(
          `Signal not published — "${this.signalSubject(msg)}" is inside its interval`,
        );
        return;
      }
    }

    try {
      await this.deliver(channel, this.buildFeedEmbed(channel, msg));
      this.logger.log(`Discord feed published to "${channel}": ${msg.title}`);
    } catch (err) {
      // The claim is released on failure: a post that never landed must not consume the window,
      // or one bad minute would silence that strategy until the interval elapsed.
      if (slot) await this.releaseSignalSlot(slot);
      throw err;
    }
  }

  /**
   * The strategy a signal belongs to — the ration's unit.
   *
   * ⚠️ A ladder card has NO bot attached, so the closest stable identifier is `metadata.protocolId`,
   * written by `automation-loop.service.ts`. `any` is a REAL subject, not a null: it is what the
   * loop writes when a card names no protocol, and grouping those under one key is deliberate —
   * the alternative is an unrationed channel, which is the one outcome the owner ruled out.
   */
  signalSubject(msg: { metadata?: Record<string, unknown> }): string {
    const raw = msg.metadata?.protocolId;
    const subject = typeof raw === 'string' ? raw.trim() : '';
    // The family pattern is `[a-z0-9][a-z0-9-]*`; anything outside it would throw on write and
    // drop the signal. Fold unknown shapes into `any` rather than losing the post.
    return /^[a-z0-9][a-z0-9-]*$/.test(subject) ? subject : 'any';
  }

  /**
   * Which public channel this event belongs in, or `null` for "do not publish".
   * Deliberately not `private` so the policy can be unit-tested without an HTTP call.
   */
  async feedChannelFor(msg: NotificationMessage): Promise<'signals' | 'wins' | 'losses' | null> {
    // ⚠️ `signal-suggestion`, NOT `entry-signal` (changed 2026-11-06 at the owner's direction).
    // `entry-signal` fires only after a bot PLACES AN ORDER, so publishing it would have shared
    // executions while calling them suggestions. The Signals area is a suggestion to enter,
    // generated from scoring with no bot attached — and that is what the feed publishes.
    if (msg.event === 'signal-suggestion') return 'signals';

    if (msg.event === 'position-closed') {
      const pnl = this.pnlOf(msg);
      if (pnl === null) {
        this.logger.warn(
          `Closed trade not published — no usable P&L in metadata (${msg.symbol ?? 'unknown symbol'}). ` +
            'An unknown outcome is not a win.',
        );
        return null;
      }
      if (pnl === 0) return null; // break-even: neither a win nor a loss

      const min = await this.numberSetting('notifications.discord.minPnlToAnnounce', 1);
      if (Math.abs(pnl) < min) {
        this.logger.log(
          `Closed trade not published — |${pnl.toFixed(2)}| is below minPnlToAnnounce (${min}).`,
        );
        return null;
      }
      return pnl > 0 ? 'wins' : 'losses';
    }

    return null;
  }

  /** `metadata.pnl` as a number, or `null` when absent or unusable. Never a guess. */
  pnlOf(msg: NotificationMessage): number | null {
    const raw = msg.metadata?.pnl;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Claim this strategy's signal window, or `null` when it is still inside the interval.
   *
   * ⚠️ TWO GATES, BOTH CLAIMED BEFORE THE POST (owner direction 2026-11-06):
   *   1. `signalMinGlobalIntervalMinutes` — the CHANNEL ceiling, shared by every strategy.
   *   2. `signalMinIntervalMinutes` — this STRATEGY's window.
   * They do different jobs. Without (1), 13–19 actionable strategies each taking their own hour
   * produced ~15 messages/hour in a public channel — measured live. Without (2), one strategy can
   * dominate the channel for the whole period. Neither number alone is a working policy.
   *
   * CLAIMED BEFORE THE POST, NOT AFTER: two signals can be evaluated in the same tick, and checking
   * then posting would let both pass a window that allows one. Both claims are rolled back if the
   * post fails.
   *
   * ⚠️ `present: false` is NOT an error and NOT "publish now unconditionally" — it means "never
   * published", which passes the interval check on its merits. A value that cannot be PARSED is a
   * third thing: it is treated as "never published" but logged, because refusing to publish forever
   * on one corrupt row is worse than publishing one extra signal, and silence would hide the fault.
   *
   * Returns the EXACT previous values so `releaseSignalSlot` can restore them. The earlier global
   * implementation returned `0` for "different day" and the release path then rewrote history;
   * `null` means there was no row at all, which releases by DELETING.
   */
  async claimSignalSlot(subject: string, now: Date = new Date()): Promise<SignalSlot | null> {
    const globalPrevious = await this.readRaw(DiscordChannel.GLOBAL_LAST_POST_KEY);
    if (
      await this.withinWindow(
        globalPrevious,
        'the signal channel',
        now,
        'notifications.discord.signalMinGlobalIntervalMinutes',
        15,
      )
    ) {
      return null;
    }

    const { key, previous } = await this.lastPostFor(subject);
    if (
      await this.withinWindow(
        previous,
        subject,
        now,
        'notifications.discord.signalMinIntervalMinutes',
        60,
      )
    ) {
      return null;
    }

    await this.settings.set(DiscordChannel.GLOBAL_LAST_POST_KEY, now.toISOString());
    await this.settings.set(key, now.toISOString());
    return { subject, previous, globalPrevious };
  }

  /**
   * Read-only peek: may this strategy publish now? Used by the automation loop to CHOOSE a card, so
   * that a throttled top-ranked strategy does not silence the feed.
   *
   * ⚠️ A peek is a HINT, not the gate. The gate is the claim, which is the only thing that writes —
   * so two callers racing here can still only produce one post per window.
   */
  async isSignalThrottled(subject: string, now: Date = new Date()): Promise<boolean> {
    const globalPrevious = await this.readRaw(DiscordChannel.GLOBAL_LAST_POST_KEY);
    if (
      await this.withinWindow(
        globalPrevious,
        'the signal channel',
        now,
        'notifications.discord.signalMinGlobalIntervalMinutes',
        15,
      )
    ) {
      return true;
    }
    const { previous } = await this.lastPostFor(subject);
    return this.withinWindow(
      previous,
      subject,
      now,
      'notifications.discord.signalMinIntervalMinutes',
      60,
    );
  }

  /** The family member's current value for one strategy. Never throws. */
  private async lastPostFor(subject: string): Promise<{ key: string; previous: string | null }> {
    const key = DiscordChannel.lastPostKey(subject);
    let previous: string | null = null;
    try {
      const resolved = await this.settings.resolveFamily(key);
      if (resolved.source === 'invalid') {
        this.logger.warn(
          `Signal throttle: "${key}" holds an unparseable value (${resolved.error ?? 'no detail'}) — ` +
            'treating it as never published.',
        );
      } else if (resolved.present || resolved.value !== undefined) {
        previous = typeof resolved.value === 'string' ? resolved.value : null;
      }
    } catch (err) {
      // A read failure must not block the public feed: fall through with `previous = null`.
      this.logger.warn(`Signal throttle: "${key}" could not be read — ${(err as Error).message}`);
    }
    return { key, previous };
  }

  /** A declared (non-family) string setting, exactly as stored. `''` when blank or unset. */
  private async readRaw(key: string): Promise<string> {
    try {
      const resolved = await this.settings.resolve(key);
      return typeof resolved.value === 'string' ? resolved.value.trim() : '';
    } catch (err) {
      this.logger.warn(`Signal throttle: "${key}" could not be read — ${(err as Error).message}`);
      return '';
    }
  }

  /**
   * Is `previous` inside the window named by `settingKey`?
   *
   * ⚠️ `minutes <= 0` disables that gate BUT the publish time is still recorded, so raising the
   * number again takes effect immediately rather than after the first post of the next window.
   */
  private async withinWindow(
    previous: string | null,
    label: string,
    now: Date,
    settingKey: string,
    fallback: number,
  ): Promise<boolean> {
    // ⚠️ An empty string is BLANK, not a corrupt timestamp: the declared channel-wide key is seeded
    // as `''`, so treating it as unparseable would log a warning on every tick of a fresh install
    // and train the reader to ignore the one warning that matters.
    if (!previous || previous.trim().length === 0) return false;

    const last = Date.parse(previous);
    if (!Number.isFinite(last)) {
      this.logger.warn(
        `Signal throttle: last publish for "${label}" is not a timestamp ("${previous}") — ` +
          'treating it as never published.',
      );
      return false;
    }
    const minutes = await this.numberSetting(settingKey, fallback);
    if (minutes <= 0) return false;

    const elapsedMinutes = (now.getTime() - last) / 60_000;
    // ⚠️ `elapsed >= minutes` is INCLUSIVE: at exactly 60 minutes the strategy may publish. The
    // boundary is named here and in a test because an off-by-one here is invisible in use.
    return elapsedMinutes < minutes;
  }

  /** Undo a claim after a failed post, restoring BOTH gates exactly. */
  async releaseSignalSlot(slot: SignalSlot): Promise<void> {
    // The channel-wide key is a DECLARED setting seeded as `''`, so it is restored by writing its
    // previous value back — never deleted, which would make `present` flicker between installs.
    await this.restoreKey(DiscordChannel.GLOBAL_LAST_POST_KEY, slot.globalPrevious);
    // The per-strategy member is a FAMILY member: it exists only because a strategy published, so
    // "no row before" must become "no row now" — an empty string would report `present: true` for a
    // post that never happened, and throttle that strategy for an hour on nothing.
    await this.restoreKey(DiscordChannel.lastPostKey(slot.subject), slot.previous, true);
  }

  private async restoreKey(key: string, previous: string | null, deleteWhenNull = false): Promise<void> {
    try {
      if (previous === null) {
        if (deleteWhenNull) await this.settings.clear(key);
        return;
      }
      await this.settings.set(key, previous);
    } catch (err) {
      this.logger.warn(`Signal throttle: "${key}" could not be restored — ${(err as Error).message}`);
    }
  }

  /**
   * Deliver to the named channel.
   *
   * The Intranet gateway is preferred because it is the one place credentials live and the one place
   * an external action is logged. The direct per-channel webhook is the fallback, so the feed keeps
   * working when WAMP is down — the app should not lose a public post because a second process is
   * not running.
   */
  private async deliver(channel: 'signals' | 'wins' | 'losses', embed: Record<string, unknown>): Promise<void> {
    const intranetUrl = process.env.INTRANET_GATEWAY_URL || '';
    const intranetKey = process.env.INTRANET_API_KEY || '';

    if (intranetUrl && intranetKey) {
      const res = await fetch(intranetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${intranetKey}`,
        },
        body: JSON.stringify({ gateway: 'discord', action: 'post', params: { channel, embed } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`Intranet gateway refused the post: HTTP ${res.status}`);
      }
      return;
    }

    const direct = process.env[`DISCORD_WEBHOOK_${channel.toUpperCase()}`] || '';
    if (!direct) {
      throw new Error(
        `no transport for "${channel}" — set INTRANET_GATEWAY_URL + INTRANET_API_KEY, ` +
          `or DISCORD_WEBHOOK_${channel.toUpperCase()}`,
      );
    }
    await this.postWebhook(direct, embed);
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  private async postWebhook(url: string, embed: Record<string, unknown>): Promise<void> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Discord ${res.status}`);
  }

  private buildEmbed(msg: NotificationMessage): Record<string, unknown> {
    const color =
      msg.event === 'drawdown-warning' ? 0xef4444 : msg.event === 'entry-signal' ? 0x22c55e : 0x64748b;
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
    if (msg.symbol) fields.push({ name: 'Symbol', value: msg.symbol, inline: true });
    if (msg.score != null) fields.push({ name: 'Score', value: String(msg.score), inline: true });
    return { title: msg.title, description: msg.body, color, fields, timestamp: new Date().toISOString() };
  }

  /**
   * buildFeedEmbed() — ONE layout for all three public message kinds.
   *
   * Owner, 2026-11-12: *"The messages sent to Discord for signals, wins and losses aren't layed out
   * the same… a uniformal approach should be applied and ensure that both protocol and bot is
   * included. Put the information on additional lines too and maybe we could use rocket emoji on a
   * $50 profit."*
   *
   * ⚠️ WHY THIS IS ONE FUNCTION AND NOT THREE BRANCHES. It used to build a SIGNAL embed with NO
   * fields at all and a closed-trade embed with ONE (`Profit`), so a single feed produced two
   * different shapes and a reader could not compare a signal against its result. One builder cannot
   * drift from itself — the kind now changes the WORDS, never the shape.
   *
   * Field order is fixed for every kind: **Protocol, Bot**, then the kind's own number. A dash is
   * printed where a value is genuinely unknown. ⚠️ Never substitute a placeholder NAME for a missing
   * bot: a fabricated identity in a public feed is worse than an honest dash, and this repo has
   * already paid for that once (#1018 — attribution must come from a recorded id, not a guess).
   *
   * The rocket is deliberately ONE condition (`profit ≥ 50`), not a tier system. It is brightness,
   * not a claim about performance.
   */
  private buildFeedEmbed(channel: 'signals' | 'wins' | 'losses', msg: NotificationMessage): Record<string, unknown> {
    const pnl = this.pnlOf(msg);
    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    const text = (v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      return s.length > 0 && s !== 'null' && s !== 'undefined' ? s : null;
    };

    const symbol = text(msg.symbol) ?? text(meta.symbol) ?? '—';
    const protocol = text(meta.protocolName) ?? text(meta.protocolId) ?? '—';
    const bot = text(meta.strategyName) ?? text(meta.botName) ?? text(meta.strategyId) ?? '—';
    const direction = text(meta.direction);
    const reason = text(meta.closeReason);

    const isSignal = channel === 'signals';
    const isWin = channel === 'wins';
    const badge = isSignal ? '📡' : isWin ? '🟢' : '🔴';
    const kind = isSignal ? 'SIGNAL' : isWin ? 'WIN' : 'LOSS';
    const rocket = isWin && pnl !== null && pnl >= 50 ? '🚀 ' : '';

    // ── One fact per line, in the same order for every kind ────────────────────────────────────
    const lines: string[] = [];
    lines.push(`**${symbol}**${direction ? ` · ${direction}` : ''}${isSignal ? '' : ' · closed'}`);
    if (isSignal) {
      const signalPct = text(meta.signalPct);
      const opportunityPct = text(meta.opportunityPct);
      lines.push(`Signal **${signalPct ?? '—'}%** of capacity`);
      lines.push(`Opportunity **${opportunityPct ?? '—'}%**`);
      lines.push('Suggestion only — no order was placed');
    } else {
      lines.push(`Profit **${pnl === null ? '—' : pnl.toFixed(2)}**`);
      lines.push(reason ? `Closed by **${reason}**` : 'Closed by **unrecorded**');
    }

    const fields = [
      { name: 'Protocol', value: protocol, inline: true },
      { name: 'Bot', value: bot, inline: true },
      isSignal
        ? { name: 'Signal', value: `${text(meta.signalPct) ?? '—'}%`, inline: true }
        : { name: 'Profit', value: pnl === null ? '—' : pnl.toFixed(2), inline: true },
    ];

    return {
      title: `${rocket}${badge} ${kind} — ${symbol}`,
      description: lines.join('\n'),
      color: isSignal || isWin ? 0x22c55e : 0xef4444,
      fields,
      footer: {
        text: isSignal
          ? 'Trading Command Suite · signal suggestion'
          : 'Trading Command Suite · closed trade',
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async numberSetting(key: string, fallback: number): Promise<number> {
    try {
      const resolved = await this.settings.resolve(key);
      const n = Number(resolved.value);
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }

  private async booleanSetting(key: string, fallback: boolean): Promise<boolean> {
    try {
      const resolved = await this.settings.resolve(key);
      return Boolean(resolved.value);
    } catch {
      return fallback;
    }
  }
}
