import { SupporterService } from './supporter.service';

/**
 * The guard for the Supporter Programme's ONE load-bearing rule (#1147, SETTLED-DECISIONS row 182).
 *
 * The rule: a prompt appears only when every input could be READ and the cadence has elapsed.
 * Everything else — an unreadable setting, an unreadable history table, an unknown install age, a
 * corrupt snooze date — must produce `eligible: false`.
 *
 * WHY THIS IS THE RULE WORTH GUARDING: the September 2026 donation panel was deleted because its
 * only reachable state was the *unresolved-view fallback* — it appeared exactly when the app could
 * not answer. A prompt is an interruption, so an interruption produced by an error is a defect that
 * users experience rather than one that shows up in a log. Each case below is a distinct way for
 * that to happen, and each fails if the corresponding check is removed.
 */

const DAY = 86_400_000;

type SettingMap = Record<string, { value: unknown; source?: string; error?: string }>;

function build(opts: {
  settings?: SettingMap;
  daysActive?: number | null;
  last?: { shownAt: Date; response?: string | null } | null;
  historyThrows?: boolean;
  progressionThrows?: boolean;
  setCalls?: Array<[string, unknown]>;
}) {
  const defaults: SettingMap = {
    'supporter.enabled': { value: true },
    'supporter.cadenceDays': { value: 90 },
    'supporter.snoozedUntil': { value: '' },
    'supporter.donate.url': { value: 'https://example.test/donate' },
    ...(opts.settings || {}),
  };

  const settings = {
    resolve: async (key: string) => {
      const s = defaults[key];
      return { key, value: s.value, source: s.source ?? 'default', ...(s.error ? { error: s.error } : {}) };
    },
    set: async (key: string, value: unknown) => {
      opts.setCalls?.push([key, value]);
      return { key, value };
    },
  };

  const progression = {
    getView: async () => {
      if (opts.progressionThrows) throw new Error('counts unavailable');
      if (opts.daysActive === null) return { status: 'unavailable', reason: 'no tables' };
      return { status: 'ok', counts: { closedTrades: 0, backtestRuns: 0, daysActive: opts.daysActive ?? 200 } };
    },
  };

  const prisma = {
    supporterInteraction: {
      findFirst: async () => {
        if (opts.historyThrows) throw new Error('table missing');
        return opts.last ?? null;
      },
      create: async ({ data }: any) => ({ shownAt: data.shownAt ?? new Date() }),
      update: async () => ({}),
    },
  };

  const service = new SupporterService(
    prisma as any,
    settings as any,
    progression as any,
  );
  return service;
}

describe('SupporterService.getStatus — asks only when it can judge', () => {
  it('is eligible when enabled, old enough, and never shown', async () => {
    const status = await build({ daysActive: 200 }).getStatus();
    expect(status.status).toBe('ok');
    expect(status.eligible).toBe(true);
    expect(status.reason).toBe('eligible');
    expect(status.targets.some((t) => t.kind === 'donate')).toBe(true);
  });

  it('does not ask when switched off', async () => {
    const status = await build({
      settings: { 'supporter.enabled': { value: false } },
    }).getStatus();
    expect(status.eligible).toBe(false);
    expect(status.reason).toBe('disabled');
  });

  it('does not ask while snoozed', async () => {
    const status = await build({
      settings: { 'supporter.snoozedUntil': { value: new Date(Date.now() + 5 * DAY).toISOString() } },
    }).getStatus();
    expect(status.eligible).toBe(false);
    expect(status.reason).toBe('snoozed');
  });

  it('asks again once the snooze has expired', async () => {
    const status = await build({
      settings: { 'supporter.snoozedUntil': { value: new Date(Date.now() - 5 * DAY).toISOString() } },
    }).getStatus();
    expect(status.eligible).toBe(true);
  });

  it('never asks a new installation, however long the cadence is set to', async () => {
    const status = await build({ daysActive: 12 }).getStatus();
    expect(status.eligible).toBe(false);
    expect(status.reason).toBe('too-new');
  });

  it('does not ask again inside the cadence window', async () => {
    const status = await build({ last: { shownAt: new Date(Date.now() - 30 * DAY) } }).getStatus();
    expect(status.eligible).toBe(false);
    expect(status.reason).toBe('recently-shown');
  });

  // ── the four "cannot judge" paths ───────────────────────────────────────────

  it('does not ask when the history table cannot be read', async () => {
    const status = await build({ historyThrows: true }).getStatus();
    expect(status.status).toBe('unavailable');
    expect(status.eligible).toBe(false);
    expect(status.reason).toBe('unavailable');
  });

  it('does not ask when the install age cannot be read', async () => {
    const status = await build({ daysActive: null }).getStatus();
    expect(status.status).toBe('unavailable');
    expect(status.eligible).toBe(false);
  });

  it('does not ask when the progression service throws', async () => {
    const status = await build({ progressionThrows: true }).getStatus();
    expect(status.status).toBe('unavailable');
    expect(status.eligible).toBe(false);
  });

  it('does not ask when a setting holds an unparseable value', async () => {
    const status = await build({
      settings: { 'supporter.cadenceDays': { value: 90, source: 'invalid', error: 'expected a number' } },
    }).getStatus();
    expect(status.status).toBe('unavailable');
    expect(status.eligible).toBe(false);
    // The reason names the key, so a corrupt row is fixable rather than mysterious.
    expect(status.detail).toContain('supporter.cadenceDays');
  });

  it('does not treat a corrupt snooze date as "not snoozed"', async () => {
    const status = await build({
      settings: { 'supporter.snoozedUntil': { value: 'soon' } },
    }).getStatus();
    expect(status.status).toBe('unavailable');
    expect(status.eligible).toBe(false);
  });
});

describe('SupporterService.record — an answer is applied, not merely stored', () => {
  it('snoozing sets a snooze date', async () => {
    const setCalls: Array<[string, unknown]> = [];
    const service = build({ setCalls, last: { shownAt: new Date() } });
    const result = await service.record({ response: 'snoozed' });
    expect(setCalls.map(([k]) => k)).toEqual(['supporter.snoozedUntil']);
    expect(result.recorded).toBe('response');
  });

  it('muting switches the system off', async () => {
    const setCalls: Array<[string, unknown]> = [];
    const service = build({ setCalls, last: { shownAt: new Date() } });
    await service.record({ response: 'muted' });
    expect(setCalls).toEqual([['supporter.enabled', false]]);
  });

  it('dismissing changes no frequency — the user asked for nothing', async () => {
    const setCalls: Array<[string, unknown]> = [];
    const service = build({ setCalls, last: { shownAt: new Date() } });
    await service.record({ response: 'dismissed' });
    expect(setCalls).toEqual([]);
  });

  it('refuses an unknown response rather than storing it', async () => {
    const service = build({});
    await expect(service.record({ response: 'maybe-later' })).rejects.toThrow(/unknown response/);
  });

  it('refuses an unknown kind rather than creating invisible history', async () => {
    const service = build({});
    await expect(service.record({ kind: 'popup', response: 'snoozed' })).rejects.toThrow(/unknown prompt kind/);
  });
});
