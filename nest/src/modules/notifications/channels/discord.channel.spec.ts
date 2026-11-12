import { DiscordChannel } from './discord.channel';
import type { NotificationMessage } from '../notifications.service';

/**
 * DiscordChannel — the PUBLIC FEED policy (2026-11-06).
 *
 * Two owner rules are pinned here, and each is canaried from BOTH sides because a threshold that
 * only ever passes is indistinguishable from one that never runs:
 *
 *   "I do not want ALL signals to be shared. Only one per day for now…"
 *   "I don't think we should share trade wins and losses that are within a dollar."
 *   "…once per hour for each strategy" (the 2026-11-06 revision — see the ration block below)
 *
 * ⚠️ AND THE THIRD CASE, WHICH IS THE DANGEROUS ONE: a closed trade with NO recorded P&L must be
 * published NOWHERE. The tempting implementation routes an unknown outcome to `wins` because the
 * loss channel is scary; that would put a fabricated success in front of an audience.
 *
 * The settings are faked with an in-memory map so the policy is exercised without a database or an
 * HTTP call — these rules are arithmetic, and arithmetic does not need Postgres.
 */
describe('DiscordChannel — public feed policy', () => {
  function makeChannel(initial: Record<string, unknown> = {}) {
    const store = new Map<string, unknown>(Object.entries(initial));
    const settings: any = {
      resolve: jest.fn(async (key: string) => ({
        key,
        value: store.has(key) ? store.get(key) : undefined,
        source: store.has(key) ? 'db' : 'default',
      })),
      // Families have NO default and are NEVER seeded — `present: false` is the honest answer for
      // a strategy that has never published, and the policy must read it as "not throttled".
      resolveFamily: jest.fn(async (key: string) => {
        const present = store.has(key);
        return {
          key,
          family: 'discordSignalLastPost',
          subject: key.split('.')[4] ?? '',
          field: 'at',
          present,
          value: present ? store.get(key) : undefined,
          source: present ? 'db' : 'absent',
          owner: 'notifications',
          userChangeable: false,
        };
      }),
      set: jest.fn(async (key: string, value: unknown) => {
        store.set(key, value);
        return { key, value, source: 'db' };
      }),
      clear: jest.fn(async (key: string) => {
        const deleted = store.delete(key) ? 1 : 0;
        return { key, deleted, previousSource: 'db' };
      }),
    };
    // The constructor injects SettingsResolverService; the fake satisfies the surface used.
    const channel = new DiscordChannel(settings);
    return { channel, store, settings };
  }

  const msg = (over: Partial<NotificationMessage>): NotificationMessage =>
    ({ title: 't', body: 'b', event: 'signal-suggestion', ...over }) as NotificationMessage;

  describe('routing — which channel, if any', () => {
    it('a SIGNAL SUGGESTION goes to the signals channel', async () => {
      const { channel } = makeChannel();
      expect(await channel.feedChannelFor(msg({ event: 'signal-suggestion' }))).toBe('signals');
    });

    it('⚠️ an EXECUTED entry-signal is NOT published — that is an order, not a suggestion', async () => {
      const { channel } = makeChannel();
      expect(await channel.feedChannelFor(msg({ event: 'entry-signal' }))).toBeNull();
    });

    it('a profitable close goes to wins', async () => {
      const { channel } = makeChannel();
      const m = msg({ event: 'position-closed', metadata: { pnl: 12.5 } });
      expect(await channel.feedChannelFor(m)).toBe('wins');
    });

    it('a losing close goes to losses', async () => {
      const { channel } = makeChannel();
      const m = msg({ event: 'position-closed', metadata: { pnl: -12.5 } });
      expect(await channel.feedChannelFor(m)).toBe('losses');
    });

    it('an unrelated event is not published at all', async () => {
      const { channel } = makeChannel();
      expect(await channel.feedChannelFor(msg({ event: 'drawdown-warning' }))).toBeNull();
      expect(await channel.feedChannelFor(msg({ event: 'daily-summary' }))).toBeNull();
    });
  });

  describe('the ±$1 rule — measured from both sides of the boundary', () => {
    const at = async (pnl: unknown) => {
      const { channel } = makeChannel();
      return channel.feedChannelFor(msg({ event: 'position-closed', metadata: { pnl } }));
    };

    it('+1.00 IS published (the threshold is inclusive)', async () => {
      expect(await at(1)).toBe('wins');
    });

    it('-1.00 IS published (absolute value)', async () => {
      expect(await at(-1)).toBe('losses');
    });

    it('+0.99 is NOT published — noise', async () => {
      expect(await at(0.99)).toBeNull();
    });

    it('-0.99 is NOT published — noise', async () => {
      expect(await at(-0.99)).toBeNull();
    });

    it('zero is neither a win nor a loss', async () => {
      expect(await at(0)).toBeNull();
    });

    it('a numeric STRING is accepted (payloads travel as JSON)', async () => {
      expect(await at('-7.25')).toBe('losses');
    });

    it('⚠️ NO P&L is published NOWHERE — an unknown outcome is not a win', async () => {
      expect(await at(undefined)).toBeNull();
      expect(await at(null)).toBeNull();
      expect(await at('not a number')).toBeNull();
    });

    it('the threshold is a SETTING, so raising it suppresses more', async () => {
      const { channel } = makeChannel({ 'notifications.discord.minPnlToAnnounce': 25 });
      const m = msg({ event: 'position-closed', metadata: { pnl: 10 } });
      expect(await channel.feedChannelFor(m)).toBeNull();

      const m2 = msg({ event: 'position-closed', metadata: { pnl: 25 } });
      expect(await channel.feedChannelFor(m2)).toBe('wins');
    });
  });

  describe('the hourly PER-STRATEGY ration', () => {
    const T0 = new Date('2026-11-06T12:00:00.000Z');
    const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
    const KEY = (s: string) => `notifications.discord.lastSignal.${s}.at`;

    // ⚠️ The channel-wide ceiling is DISABLED here so these cases isolate the per-strategy rule.
    // Without that, "a different strategy is not blocked" would pass or fail on the ceiling rather
    // than on the rule it names — a test that cannot tell which gate it measured.
    const strategyOnly = (initial: Record<string, unknown> = {}) =>
      makeChannel({ 'notifications.discord.signalMinGlobalIntervalMinutes': 0, ...initial });

    it('the FIRST signal for a strategy claims a window', async () => {
      const { channel } = strategyOnly();
      expect(await channel.claimSignalSlot('vix-spike-v1-long', T0)).not.toBeNull();
    });

    it('a SECOND signal from the SAME strategy inside the window is refused', async () => {
      const { channel } = strategyOnly();
      await channel.claimSignalSlot('vix-spike-v1-long', T0);
      expect(await channel.claimSignalSlot('vix-spike-v1-long', at(30))).toBeNull();
    });

    it('⚠️ a DIFFERENT strategy is NOT blocked — the ration is per strategy, not global', async () => {
      // This is the regression the change exists for: the previous global daily allowance let the
      // first strategy to print silence every other strategy until midnight.
      const { channel } = strategyOnly();
      await channel.claimSignalSlot('vix-spike-v1-long', T0);
      expect(await channel.claimSignalSlot('gold-breakout-v1-long', at(1))).not.toBeNull();
    });

    it('⚠️ the boundary is INCLUSIVE: 60 minutes may publish, 59 may not', async () => {
      const { channel } = strategyOnly();
      await channel.claimSignalSlot('vix-spike-v1-long', T0);

      expect(await channel.claimSignalSlot('vix-spike-v1-long', at(59))).toBeNull();
      expect(await channel.claimSignalSlot('vix-spike-v1-long', at(60))).not.toBeNull();
    });

    it('the interval is a SETTING, so a longer window suppresses more', async () => {
      const { channel } = strategyOnly({
        'notifications.discord.signalMinIntervalMinutes': 120,
      });
      await channel.claimSignalSlot('vix-spike-v1-long', T0);
      expect(await channel.claimSignalSlot('vix-spike-v1-long', at(60))).toBeNull();
      expect(await channel.claimSignalSlot('vix-spike-v1-long', at(120))).not.toBeNull();
    });

    it('0 disables the throttle but still records the publish time', async () => {
      const { channel, store } = strategyOnly({
        'notifications.discord.signalMinIntervalMinutes': 0,
      });
      await channel.claimSignalSlot('vix-spike-v1-long', T0);
      expect(await channel.claimSignalSlot('vix-spike-v1-long', at(1))).not.toBeNull();
      // Recorded, so raising the number again takes effect from the LAST post, not the next one.
      expect(store.get(KEY('vix-spike-v1-long'))).toBe(at(1).toISOString());
    });

    it('a missing row means "never published", not an error', async () => {
      const { channel } = strategyOnly();
      expect(await channel.isSignalThrottled('vix-spike-v1-long', T0)).toBe(false);
    });

    it('⚠️ an unparseable stored value is treated as never published, and says so', async () => {
      // Refusing for ever on one corrupt row would silence that strategy permanently; publishing
      // one extra signal is the lesser fault. The warning is what stops it being silent.
      const { channel } = strategyOnly({ [KEY('vix-spike-v1-long')]: 'not-a-timestamp' });
      expect(await channel.isSignalThrottled('vix-spike-v1-long', T0)).toBe(false);
    });

    it('a released window is available again — a failed post costs nothing', async () => {
      const { channel } = strategyOnly();
      const slot = await channel.claimSignalSlot('vix-spike-v1-long', T0);
      expect(slot).not.toBeNull();
      expect(await channel.claimSignalSlot('vix-spike-v1-long', at(1))).toBeNull();

      await channel.releaseSignalSlot(slot!);
      expect(await channel.claimSignalSlot('vix-spike-v1-long', at(1))).not.toBeNull();
    });

    it('release restores the EXACT previous timestamp, not an empty one', async () => {
      const previous = at(-90).toISOString();
      const { channel, store } = strategyOnly({ [KEY('vix-spike-v1-long')]: previous });
      const slot = await channel.claimSignalSlot('vix-spike-v1-long', T0);
      await channel.releaseSignalSlot(slot!);
      expect(store.get(KEY('vix-spike-v1-long'))).toBe(previous);
    });

    it('⚠️ release DELETES the row when there was none — it must not leave a false publish time', async () => {
      const { channel, store } = strategyOnly();
      const slot = await channel.claimSignalSlot('vix-spike-v1-long', T0);
      expect(store.has(KEY('vix-spike-v1-long'))).toBe(true);

      await channel.releaseSignalSlot(slot!);
      // A row left behind here would throttle the strategy for an hour on the strength of a post
      // that never happened.
      expect(store.has(KEY('vix-spike-v1-long'))).toBe(false);
    });
  });

  describe('the channel-wide ceiling, on top of the per-strategy window', () => {
    const T0 = new Date('2026-11-06T12:00:00.000Z');
    const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
    const GLOBAL = 'notifications.discord.lastSignalAt';

    it('⚠️ a DIFFERENT strategy inside 15 minutes is refused — the channel ceiling', async () => {
      // The per-strategy rule alone allowed ~15 messages/hour once 13-19 strategies were actionable.
      const { channel } = makeChannel();
      expect(await channel.claimSignalSlot('vix-spike-v1-long', T0)).not.toBeNull();
      expect(await channel.claimSignalSlot('gold-breakout-v1-long', at(1))).toBeNull();
    });

    it('a different strategy IS allowed once the ceiling has passed', async () => {
      const { channel } = makeChannel();
      await channel.claimSignalSlot('vix-spike-v1-long', T0);
      expect(await channel.claimSignalSlot('gold-breakout-v1-long', at(15))).not.toBeNull();
    });

    it('the ceiling boundary is INCLUSIVE: 14 refused, 15 allowed', async () => {
      const { channel } = makeChannel();
      await channel.claimSignalSlot('vix-spike-v1-long', T0);
      expect(await channel.claimSignalSlot('gold-breakout-v1-long', at(14))).toBeNull();
      expect(await channel.claimSignalSlot('gold-breakout-v1-long', at(15))).not.toBeNull();
    });

    it('the ceiling is a SETTING, so it can be widened', async () => {
      const { channel } = makeChannel({
        'notifications.discord.signalMinGlobalIntervalMinutes': 60,
      });
      await channel.claimSignalSlot('vix-spike-v1-long', T0);
      expect(await channel.claimSignalSlot('gold-breakout-v1-long', at(15))).toBeNull();
      expect(await channel.claimSignalSlot('gold-breakout-v1-long', at(60))).not.toBeNull();
    });

    it('0 disables the ceiling — every strategy may publish immediately', async () => {
      const { channel } = makeChannel({
        'notifications.discord.signalMinGlobalIntervalMinutes': 0,
      });
      await channel.claimSignalSlot('vix-spike-v1-long', T0);
      expect(await channel.claimSignalSlot('gold-breakout-v1-long', at(1))).not.toBeNull();
    });

    it('⚠️ both gates bind independently: ceiling free but strategy throttled', async () => {
      const { channel } = makeChannel();
      await channel.claimSignalSlot('vix-spike-v1-long', T0);
      // 20 minutes later the CEILING is clear, but this strategy's own 60-minute window is not.
      expect(await channel.claimSignalSlot('vix-spike-v1-long', at(20))).toBeNull();
    });

    it('the claim records BOTH timestamps', async () => {
      const { channel, store } = makeChannel();
      await channel.claimSignalSlot('vix-spike-v1-long', T0);
      expect(store.get(GLOBAL)).toBe(T0.toISOString());
      expect(store.get('notifications.discord.lastSignal.vix-spike-v1-long.at')).toBe(
        T0.toISOString(),
      );
    });

    it('⚠️ release restores the ceiling too, so a failed post does not block the channel', async () => {
      const { channel, store } = makeChannel();
      const slot = await channel.claimSignalSlot('vix-spike-v1-long', T0);
      await channel.releaseSignalSlot(slot!);
      expect(store.get(GLOBAL) ?? '').toBe('');
      // And the channel is immediately usable by another strategy.
      expect(await channel.claimSignalSlot('gold-breakout-v1-long', at(1))).not.toBeNull();
    });

    it('⚠️ a blank ceiling value is BLANK, not a corrupt timestamp', async () => {
      // The declared key is seeded as '', so a fresh install must not log a warning every tick.
      const { channel } = makeChannel({ [GLOBAL]: '' });
      expect(await channel.isSignalThrottled('vix-spike-v1-long', T0)).toBe(false);
    });
  });

  /**
   * ⚠️ THE LAYOUT IS THE FEATURE (owner, 2026-11-12): *"The messages sent to Discord for signals,
   * wins and losses aren't layed out the same… a uniformal approach should be applied and ensure
   * that both protocol and bot is included."*
   *
   * These tests exist because the OLD defect was invisible: two of the three kinds had a different
   * number of fields, and nothing failed. A published message cannot be un-published, so the shape
   * has to be pinned by a test rather than by review.
   *
   * The builder is private and reached through `as any` on purpose — the thing worth asserting is
   * the embed a reader sees, not an internal call signature.
   */
  describe('the public layout — one shape for signals, wins and losses', () => {
    const embed = (
      channel: DiscordChannel,
      kind: 'signals' | 'wins' | 'losses',
      m: NotificationMessage,
    ) => (channel as any).buildFeedEmbed(kind, m) as { title: string; description: string; fields: Array<{ name: string; value: string }> };
    const names = (e: { fields: Array<{ name: string }> }) => e.fields.map((f) => f.name);

    it('⚠️ ALL THREE kinds carry Protocol and Bot, in the same order', () => {
      const { channel } = makeChannel();
      const sig = embed(channel, 'signals', msg({ metadata: { protocolId: 'p1', signalPct: 8 } }));
      const win = embed(channel, 'wins', msg({ event: 'position-closed', metadata: { pnl: 52 } }));
      const loss = embed(channel, 'losses', msg({ event: 'position-closed', metadata: { pnl: -20 } }));

      for (const e of [sig, win, loss]) {
        expect(names(e).slice(0, 2)).toEqual(['Protocol', 'Bot']);
        expect(names(e)).toHaveLength(3);
      }
      // ⚠️ The THIRD label is allowed to differ, and only the third: it names the quantity, and a
      // signal strength is not a profit. Naming it "Signal" when it holds money would be worse than
      // an inconsistency. What must never drift is the COUNT, the ORDER, and the two identity fields.
      expect(names(sig)).toEqual(['Protocol', 'Bot', 'Signal']);
      expect(names(win)).toEqual(['Protocol', 'Bot', 'Profit']);
      expect(names(loss)).toEqual(['Protocol', 'Bot', 'Profit']);
    });

    it('protocol and bot are read from the metadata, name preferred over id', () => {
      const { channel } = makeChannel();
      const e = embed(channel, 'wins', msg({
        event: 'position-closed',
        metadata: { pnl: 10, protocolId: 'slug-1', protocolName: 'Gold Session', strategyName: 'gold-breakout' },
      }));
      expect(e.fields[0].value).toBe('Gold Session');
      expect(e.fields[1].value).toBe('gold-breakout');
    });

    it('⚠️ a missing bot is a DASH — never an invented name', () => {
      const { channel } = makeChannel();
      const e = embed(channel, 'signals', msg({ metadata: { signalPct: 7 } }));
      expect(e.fields[1].value).toBe('—');
      expect(e.fields[0].value).toBe('—');
    });

    it('the information sits on separate lines, not one joined string', () => {
      const { channel } = makeChannel();
      const e = embed(channel, 'signals', msg({ metadata: { protocolId: 'p1', signalPct: 8, opportunityPct: 12 } }));
      const lines = e.description.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(4);
      expect(lines).toContain('Signal **8%** of capacity');
      expect(lines).toContain('Opportunity **12%**');
      expect(e.description).not.toMatch(/ · Protocol/);
    });

    it('🚀 appears on a $50 win and not on $49.99', () => {
      const { channel } = makeChannel();
      const big = embed(channel, 'wins', msg({ event: 'position-closed', metadata: { pnl: 50 } }));
      const small = embed(channel, 'wins', msg({ event: 'position-closed', metadata: { pnl: 49.99 } }));
      expect(big.title.startsWith('🚀')).toBe(true);
      expect(small.title.startsWith('🚀')).toBe(false);
    });

    it('no rocket on a signal or a loss, whatever the number', () => {
      const { channel } = makeChannel();
      expect(embed(channel, 'signals', msg({ metadata: { signalPct: 9 } })).title.startsWith('🚀')).toBe(false);
      expect(embed(channel, 'losses', msg({ event: 'position-closed', metadata: { pnl: -60 } })).title.startsWith('🚀')).toBe(false);
    });
  });

  describe('which strategy a signal belongs to', () => {
    it('reads metadata.protocolId', () => {
      const { channel } = makeChannel();
      expect(channel.signalSubject({ metadata: { protocolId: 'vix-spike-v1-long' } })).toBe(
        'vix-spike-v1-long',
      );
    });

    it('⚠️ an unusable subject folds into "any" rather than being lost', () => {
      // The family pattern is `[a-z0-9][a-z0-9-]*`; writing anything else would throw and drop the
      // post entirely. `any` is a real subject, so those signals are still rationed as a group.
      const { channel } = makeChannel();
      expect(channel.signalSubject({})).toBe('any');
      expect(channel.signalSubject({ metadata: { protocolId: 'BTC/USD' } })).toBe('any');
      expect(channel.signalSubject({ metadata: { protocolId: 42 } })).toBe('any');
    });
  });
});
