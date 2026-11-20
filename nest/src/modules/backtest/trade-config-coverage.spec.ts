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
import { buildTradeConfig } from './trade-config';
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

  it('▶ CANARY — every field the engine HONOURS is on the result as applied', () => {
    const missing = BOT_FIELDS
      .filter((f) => f.applied === 'honoured' && !IDENTITY_EXEMPT[f.key])
      .filter((f) => {
        const row = byId.get(ROW_ID[f.key] ?? f.key);
        return !row || row.applied !== true;
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
