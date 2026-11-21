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

  /**
   * ⚠️ THE COLUMN TYPE IS THE OTHER HALF OF "IS THIS EDITABLE". `Int` refuses a fraction and a
   * required column refuses `null`, and BOTH failures happen at the database — after the panel has
   * told the reader it saved. Declaring `integer`/`nullable` beside the control and checking them
   * against the DMMF means the mis-declaration is caught here instead of in a refused PATCH.
   */
  it('the declared integer/nullable flags match the column types in the schema', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'TradingStrategy');
    if (!model) throw new Error('TradingStrategy model not found in the Prisma DMMF');
    const checked: string[] = [];
    for (const f of fields.filter((x) => x.editable)) {
      const col = model.fields.find((c) => c.name === f.id);
      if (!col) continue; // the phantom-column test above owns that failure
      checked.push(f.id);
      expect([Boolean(f.editable?.integer), Boolean(f.editable?.nullable)]).toEqual([
        col.type === 'Int',
        !col.isRequired,
      ]);
    }
    // Guard against the guard: an empty loop would pass every assertion above.
    expect(checked.length).toBeGreaterThan(8);
  });

  it('CANARY — int/nullable flags that disagree with the column are reported', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'TradingStrategy');
    if (!model) throw new Error('TradingStrategy model not found in the Prisma DMMF');
    const mismatched = (rows: TradeConfigField[]): string[] =>
      rows
        .filter((r) => r.editable && model.fields.find((c) => c.name === r.id))
        .filter((r) => {
          const col = model.fields.find((c) => c.name === r.id)!;
          return Boolean(r.editable?.integer) !== (col.type === 'Int')
            || Boolean(r.editable?.nullable) !== !col.isRequired;
        })
        .map((r) => r.id);
    expect(mismatched(fields)).toEqual([]);
    // `maxHoldHours` is Int? — calling it a nullable Float is exactly the mis-declaration to catch.
    const broken = fields.map((r) =>
      r.id === 'maxHoldHours' ? { ...r, editable: { ...r.editable!, integer: false } } : r,
    );
    expect(mismatched(broken)).toEqual(['maxHoldHours']);
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
