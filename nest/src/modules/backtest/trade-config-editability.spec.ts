/**
 * The editability guard for the trade-management table.
 *
 * ⚠️ WHY THIS EXISTS. The panel now writes what it shows: an editable row is PATCHed onto the
 * `trading_strategy` record, which is the configuration LIVE trades obey (register row 247). That
 * makes one mistake possible and invisible — offering an input for a field the bot table does not
 * have. The PATCH then fails at the database, or worse, an input appears to save and changes nothing
 * while the next run re-reads the unmodified bot and the number silently reverts.
 *
 * So the rule is mechanical: **an editable row's id must be a real `TradingStrategy` column**, read
 * from the generated Prisma client rather than from a list someone maintains. A new column does not
 * fail this test; a field that claims to be a column and is not, does.
 *
 * Canaried in both directions — a fabricated id is reported, and the real set is empty of false
 * positives. A guard that cannot be made to fail is a decoration.
 */
import { Prisma } from '@prisma/client';
import { buildTradeConfig, type TradeConfigBot, type TradeConfigField } from './trade-config';

const BOT: TradeConfigBot = {
  id: 'bot-1',
  name: 'Movers V1 Long Bot',
  protocolId: 'movers-long-v1',
  active: 1,
  mode: 'auto',
  slPct: 2.5,
  tpPct: 6,
  minComposite: 30,
  maxHoldHours: 4,
  cooldownMinutes: 30,
  maxPositions: 1,
  sessionWindow: 'us',
  baseSize: 0.1,
  simTslEnabled: 1,
  maxPyramidTiers: 1,
  exitBeforeUtc: '20:45',
  exhaustionObserveEnabled: 0,
  takeProfitAmount: null,
  brokerId: 'broker-uuid-1',
};

/** Columns on the bot table, from the generated client (so a schema change reaches this test). */
function botColumns(): string[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'TradingStrategy');
  if (!model) throw new Error('TradingStrategy model not found in the Prisma DMMF');
  return model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => f.name);
}

/** Ids the table offers an input for. Pure, so it can be canaried without a schema change. */
const editableIds = (fields: readonly TradeConfigField[]): string[] =>
  fields.filter((f) => f.editable).map((f) => f.id);

/** Editable ids that are not real columns — the defect this file exists to catch. */
const phantomIds = (fields: readonly TradeConfigField[], columns: readonly string[]): string[] => {
  const known = new Set(columns);
  return editableIds(fields).filter((id) => !known.has(id));
};

describe('trade-config editability', () => {
  const fields = buildTradeConfig(BOT);

  it('offers an input for the numbers a movers bot is actually tuned on', () => {
    const ids = editableIds(fields);
    // Guard against the guard reading nothing: an empty set would "pass" every assertion below.
    expect(ids.length).toBeGreaterThan(8);
    for (const id of ['slPct', 'tpPct', 'minComposite', 'maxHoldHours', 'maxPyramidTiers', 'takeProfitAmount']) {
      expect(ids).toContain(id);
    }
  });

  it('every editable id is a real trading_strategy column', () => {
    const columns = botColumns();
    expect(columns.length).toBeGreaterThan(30);
    expect(phantomIds(fields, columns)).toEqual([]);
  });

  it('nothing without a bot record is editable — a request value has no column to write', () => {
    // `bot: null` is the state that produced a wrong conclusion once: engine literals, no owner.
    // Offering an input there would write to a record that does not exist.
    expect(editableIds(buildTradeConfig(null))).toEqual([]);
    // …and when a bot IS supplied, every editable row must be the bot's own value.
    for (const f of fields.filter((x) => x.editable)) {
      expect(f.source).toBe('bot');
    }
  });

  it('the declared control matches the shape of the value the row carries', () => {
    for (const f of fields.filter((x) => x.editable)) {
      if (f.editable?.control === 'number') {
        expect(typeof f.value === 'number' || f.value === null).toBe(true);
      }
      if (f.editable?.control === 'toggle') {
        expect(['on', 'off']).toContain(f.value);
      }
      if (f.editable?.control === 'time') {
        expect(typeof f.value === 'string' || f.value === null).toBe(true);
      }
    }
  });

  it('CANARY — a field named as a column that is not one is reported', () => {
    const columns = botColumns();
    const fabricated = [
      ...fields,
      { id: 'slPctV2', label: 'Stop loss v2', value: 1, source: 'bot', applied: true, note: '', editable: { control: 'number' } },
    ] as TradeConfigField[];
    expect(phantomIds(fabricated, columns)).toEqual(['slPctV2']);
  });
});
