/**
 * trade-config-coverage.spec.ts — NO BOT KNOB MAY BE SILENT.
 *
 * ── THE RULE THIS ENFORCES ──────────────────────────────────────────────────────────────────────
 * `trade-config.ts` must account for every field on the bot that `settings-inventory.ts` classifies:
 * an `ignored` field appears with `applied: false` and a reason, and an `honoured` field appears with
 * `applied: true`. The inventory and the provenance table are two hand-maintained lists of one fact,
 * so this is the check that stops them drifting — and the check that stops a NEW column being added and
 * silently not measured.
 *
 * ⚠️ WHY THIS IS A GUARD AND NOT A COMMENT. Measured 2026-11-20: `cooldownMinutes`, `maxPositions`,
 * `sessionWindow`, `maxPyramidTiers`, `sessionTags`, `exitBeforeUtc`, `exhaustion*` and `brokerId` were
 * all ignored by the engine and NONE of them appeared on a result. A reader saw a trade count and had no
 * way to know it was produced by a configuration the bot does not run. Listing them is not decoration;
 * it is the difference between a result and a claim.
 *
 * ⚠️ `symbol`/`timeframe`/`protocolId` ARE EXEMPT, and the reason is stated: they are IDENTITY, not
 * settings — they say WHICH market to measure, and the result already states them (`answerDate`,
 * `timeframe`, `protocolId`). A `mode`/`active` row is `reported-only` and likewise identity-ish.
 */
import { applyHoldReachability, buildTradeConfig } from './trade-config';
import { BOT_FIELDS } from './settings-inventory';

/** Fields the table does not need a row for, each with the reason it is exempt. */
const IDENTITY_EXEMPT: Record<string, string> = {
  symbol: 'identity — the run reports the symbol it measured per result row',
  timeframe: 'identity — the run reports `timeframe` on the result',
  protocolId: 'identity — the run reports `protocolId` on the result',
  mode: 'reported-only in the inventory; the result echoes the bot it resolved',
  active: 'reported-only in the inventory; the result echoes the bot it resolved',
};

/** Map an inventory key to the row id the table uses where they differ. */
const ROW_ID: Record<string, string> = {
  // The three trailing columns are one row: a plan needs all three or none.
  simTslActivationPct: 'simTslEnabled',
  simTslDistancePct: 'simTslEnabled',
  exhaustionDecelPct: 'exhaustionObserveEnabled',
};

const BOT = {
  id: 'bot-1',
  name: 'Movers V1 Long Bot',
  protocolId: 'movers-v1-long',
  active: 0,
  mode: 'manual',
  slPct: 2.5,
  tpPct: 6,
  minComposite: 30,
  maxHoldHours: 4,
  cooldownMinutes: 30,
  maxPositions: 1,
  sessionWindow: '["us"]',
  baseSize: 0.01,
  simTslEnabled: 0,
  maxPyramidTiers: 1,
  exitBeforeUtc: null,
  exhaustionObserveEnabled: 0,
  takeProfitAmount: null,
  brokerId: 'mt5',
};

describe('applyHoldReachability', () => {
  const holdRows = () => buildTradeConfig({ ...BOT, maxHoldHours: 10, exitBeforeUtc: '20:45' });
  const hold = (rows: ReturnType<typeof holdRows>) => rows.find((r) => r.id === 'maxHoldHours')!;

  it('▶ CANARY — an armed but unreachable hold says it cannot fire, and stays applied', () => {
    // Measured: cutoff 15:30 → boundary 20:45 leaves 5.25h; a 10h hold produced SESSION×21, EOD×1 and
    // a 2h arm produced TIME×21 on the same data.
    const rows = applyHoldReachability(holdRows(), { sessionSpanMinutes: 390, exitBeforeUtc: '20:45', cutoffUtc: '15:30' });
    const row = hold(rows);
    expect(row.applied).toBe(true); // the rule IS armed — different from the trail, which could not be built
    expect(row.effect).toContain('cannot fire on this dataset');
    expect(row.effect).toContain('5.25h');
    expect(row.note).toContain('cannot fire on this dataset');
  });

  it('says nothing when the hold fits inside the available window', () => {
    const rows = applyHoldReachability(buildTradeConfig({ ...BOT, maxHoldHours: 2, exitBeforeUtc: '20:45' }), { sessionSpanMinutes: 390, exitBeforeUtc: '20:45', cutoffUtc: '15:30' });
    expect(hold(rows).effect).not.toContain('cannot fire');
  });

  it('still judges when the SPAN is unknown, because the boundary alone bounds the hold', () => {
    // `maxHoldingMinutes()` returns `boundary − cutoff` when the span is missing — the boundary is a
    // hard clock limit, so an unknown series length does not stop the arithmetic. Flagging here is right.
    const noSpan = applyHoldReachability(holdRows(), { sessionSpanMinutes: null, exitBeforeUtc: '20:45', cutoffUtc: '15:30' });
    expect(hold(noSpan).effect).toContain('cannot fire');
  });

  it('says nothing when the CUTOFF is unknown — cannot judge is not a finding', () => {
    // Without the cutoff the boundary's distance is unknowable: `20:45` alone says nothing about how
    // long a position may be held, so no claim may be made.
    const noCutoff = applyHoldReachability(holdRows(), { sessionSpanMinutes: 390, exitBeforeUtc: '20:45', cutoffUtc: null });
    expect(hold(noCutoff).effect).not.toContain('cannot fire');
  });

  it('says nothing when there is no boundary and the span fits the hold', () => {
    const rows = applyHoldReachability(buildTradeConfig({ ...BOT, maxHoldHours: 4, exitBeforeUtc: null }), { sessionSpanMinutes: 390, exitBeforeUtc: null, cutoffUtc: '15:30' });
    expect(hold(rows).effect).not.toContain('cannot fire');
  });

  it('▶ CANARY — never prints a raw null into the sentence', () => {
    // Measured 2026-11-25: the first version read "a null UTC boundary from a 15:30 cutoff" for a bot
    // with no boundary. The binding constraint there is the DATASET, and it must be named as such.
    const rows = applyHoldReachability(buildTradeConfig({ ...BOT, maxHoldHours: 10, exitBeforeUtc: null }), { sessionSpanMinutes: 390, exitBeforeUtc: null, cutoffUtc: '15:30' });
    const text = hold(rows).effect;
    expect(text).toContain('cannot fire on this dataset');
    expect(text).toContain('this dataset spans at most 6.50h');
    expect(text).not.toContain('null');
  });

  it('leaves a zero hold alone — there is no rule to reach', () => {
    const rows = applyHoldReachability(buildTradeConfig({ ...BOT, maxHoldHours: 0 }), { sessionSpanMinutes: 390, exitBeforeUtc: '20:45', cutoffUtc: '15:30' });
    expect(hold(rows).effect).not.toContain('cannot fire');
  });
});

describe('trade-config covers the whole bot', () => {
  const rows = buildTradeConfig(BOT);
  const byId = new Map(rows.map((r) => [r.id, r]));

  it('▶ CANARY — every field the engine IGNORES is on the result, with a reason', () => {
    const missing = BOT_FIELDS
      .filter((f) => f.applied === 'ignored' && !IDENTITY_EXEMPT[f.key])
      .filter((f) => {
        const row = byId.get(ROW_ID[f.key] ?? f.key);
        return !row || row.applied !== false;
      })
      .map((f) => f.key);

    expect(missing).toEqual([]);
  });

  it('▶ CANARY — every field the engine HONOURS is on the result as applied, or says why not', () => {
    /**
     * ⚠️ "HONOURED" IS A FACT ABOUT THE ENGINE, NOT ABOUT THIS BOT (corrected 2026-11-25).
     * The assertion used to demand `applied === true` for every honoured field. But `applied` means
     * "this run applies it", and two honoured fields legitimately do not: `simTslEnabled` when the
     * switch is OFF, or when `simTslPlan()` cannot build a trail because a percentage is missing (the
     * fixture bot has `simTslEnabled: 0`). Demanding `true` there forced the row to claim protection
     * that did not exist — the very lie the row's own `effect` had to contradict.
     *
     * The guard is not weakened: the row must still EXIST, and if it is not applied it must say
     * `NOT APPLIED` — which the next test enforces for every row. A field that silently stopped being
     * honoured would fail here (no row) or there (no explanation).
     */
    const missing = BOT_FIELDS
      .filter((f) => f.applied === 'honoured' && !IDENTITY_EXEMPT[f.key])
      .filter((f) => {
        const row = byId.get(ROW_ID[f.key] ?? f.key);
        if (!row) return true;
        return row.applied !== true && !/NOT APPLIED/.test(row.note);
      })
      .map((f) => f.key);

    expect(missing).toEqual([]);
  });

  it('every ignored row says NOT APPLIED and names why, so a reader cannot mistake it for measured', () => {
    const silent = rows.filter((r) => !r.applied && !/NOT APPLIED|NOT COMPARABLE/.test(r.note));
    expect(silent.map((r) => r.id)).toEqual([]);
  });

  it('the exemptions are few and each is justified', () => {
    for (const [, reason] of Object.entries(IDENTITY_EXEMPT)) {
      expect(reason.length).toBeGreaterThan(20);
    }
    expect(Object.keys(IDENTITY_EXEMPT).length).toBeLessThanOrEqual(5);
  });
});
