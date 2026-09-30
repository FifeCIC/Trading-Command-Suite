import { buildOrderToPosition, buildClaimants, claimantLabel, isContested } from './position-claimants';

/**
 * The incident, encoded. These are the REAL ids from ticket `152703882760` (2026-09-30, −322.67) —
 * ten app rows, all resolving to ONE position, built by three different bots. Using the real numbers
 * rather than invented ones is the point: the shape that broke attribution is preserved here, so a
 * change that re-breaks it fails this test instead of shipping.
 */
const INCIDENT_POSITION = '152703882760';
const GOLD_PARENT = '4d9bc5ef-935d-4b6d-bca4-866187d531a7';
const BOT_A = 'bot-aaaa-1111';
const BOT_B = 'bot-bbbb-2222';

const BOT_NAMES = new Map<string, string>([
  [GOLD_PARENT, 'Gold Position 4H (copy)'],
  [BOT_A, 'AB-A 929 measurable run'],
  [BOT_B, 'AB-B 929 measurable run'],
]);

/** The ten order tickets that made up that position, in the order they were placed. */
const INCIDENT_ORDERS: Array<[string, string]> = [
  ['152703882760', GOLD_PARENT], // 10:16:10 — the third bot's order, which opened the position
  ['152704747427', BOT_A], // 12:32:28
  ['152704747466', BOT_B],
  ['152704779067', BOT_A], // 12:34:29
  ['152704779073', BOT_B],
  ['152704810395', BOT_A], // 12:36:28
  ['152704810404', BOT_B],
  ['152704838352', BOT_A], // 12:38:28
  ['152704838354', BOT_B],
  ['152704888417', BOT_A], // 12:42:26
];

const incidentDeals = INCIDENT_ORDERS.map(([orderId]) => ({ orderId, positionId: INCIDENT_POSITION }));
const incidentAppRows = INCIDENT_ORDERS.map(([brokerTicket, scoringStrategyId]) => ({ brokerTicket, scoringStrategyId }));

describe('position claimants — the derivation that attribution depends on', () => {
  describe('buildOrderToPosition', () => {
    it('maps an ORDER ticket to the POSITION it joined — the join brokerTicket cannot do directly', () => {
      const map = buildOrderToPosition(incidentDeals);
      expect(map.size).toBe(10);
      // Every one of the ten orders points at the SAME position. This is the merge, stated as data.
      for (const [orderId] of INCIDENT_ORDERS) {
        expect(map.get(orderId)).toBe(INCIDENT_POSITION);
      }
    });

    it('reads the snake_case spellings too, so a bridge field rename cannot silently empty it', () => {
      const map = buildOrderToPosition([{ order_id: 7, position_id: 9 }]);
      expect(map.get('7')).toBe('9');
    });

    it('skips a deal missing either id rather than inventing a mapping', () => {
      const map = buildOrderToPosition([
        { orderId: 1, positionId: 2 },
        { orderId: 3 },
        { positionId: 4 },
        {},
      ]);
      expect([...map.entries()]).toEqual([['1', '2']]);
    });

    it('returns an EMPTY map for no deals — the caller must report a gap, not read this as "no authors"', () => {
      expect(buildOrderToPosition([]).size).toBe(0);
    });
  });

  describe('buildClaimants', () => {
    it('THE INCIDENT: ten app rows, one position, THREE claimants', () => {
      const orderToPosition = buildOrderToPosition(incidentDeals);
      const claimants = buildClaimants(incidentAppRows, orderToPosition, BOT_NAMES);

      expect(claimants.size).toBe(1); // ten rows collapse to ONE position — that is the finding
      expect(claimants.get(INCIDENT_POSITION)).toEqual([
        'Gold Position 4H (copy)',
        'AB-A 929 measurable run',
        'AB-B 929 measurable run',
      ]);
    });

    it('names each bot ONCE however many orders it placed', () => {
      const orderToPosition = buildOrderToPosition(incidentDeals);
      const claimants = buildClaimants(incidentAppRows, orderToPosition, BOT_NAMES);
      // AB-A placed five of the ten orders; it must appear once, not five times.
      const names = claimants.get(INCIDENT_POSITION)!;
      expect(names.filter((n) => n === 'AB-A 929 measurable run')).toHaveLength(1);
    });

    it('gives a single-claimant position one name — the ordinary case must not look contested', () => {
      const orderToPosition = buildOrderToPosition([{ orderId: 'o1', positionId: 'p1' }]);
      const claimants = buildClaimants([{ brokerTicket: 'o1', scoringStrategyId: BOT_A }], orderToPosition, BOT_NAMES);
      expect(claimants.get('p1')).toEqual(['AB-A 929 measurable run']);
    });

    it('still counts an order whose bot cannot be resolved — an unknown writer is a second writer', () => {
      const orderToPosition = buildOrderToPosition([
        { orderId: 'o1', positionId: 'p1' },
        { orderId: 'o2', positionId: 'p1' },
      ]);
      const claimants = buildClaimants(
        [
          { brokerTicket: 'o1', scoringStrategyId: BOT_A },
          { brokerTicket: 'o2', scoringStrategyId: '' }, // no bot recorded on this row
        ],
        orderToPosition,
        BOT_NAMES,
      );
      expect(claimants.get('p1')).toEqual(['AB-A 929 measurable run', 'unattributed order']);
    });

    it('collapses two unattributed orders into ONE claimant, not two', () => {
      const orderToPosition = buildOrderToPosition([
        { orderId: 'o1', positionId: 'p1' },
        { orderId: 'o2', positionId: 'p1' },
      ]);
      const claimants = buildClaimants(
        [
          { brokerTicket: 'o1', scoringStrategyId: '' },
          { brokerTicket: 'o2', scoringStrategyId: '' },
        ],
        orderToPosition,
        BOT_NAMES,
      );
      expect(claimants.get('p1')).toEqual(['unattributed order']);
    });

    it('ignores an app row whose order is not in the deal window', () => {
      const claimants = buildClaimants([{ brokerTicket: 'never-seen', scoringStrategyId: BOT_A }], new Map(), BOT_NAMES);
      expect(claimants.size).toBe(0);
    });
  });

  describe('isContested — the boundary is the decision, so it is tested at the boundary', () => {
    it('one claimant is NOT contested', () => {
      expect(isContested(['only-bot'])).toBe(false);
    });

    it('two claimants IS contested — this is the exact case the guardian got wrong', () => {
      expect(isContested(['bot-a', 'bot-b'])).toBe(true);
    });

    it('zero claimants is NOT contested — no owners and several owners are different states', () => {
      // ⚠️ Deliberate: "nobody" is `unresolved`, "several" is `contested`. Collapsing them would
      // make a position with no owner look like one with too many, and they need different handling.
      expect(isContested([])).toBe(false);
      expect(isContested(undefined)).toBe(false);
      expect(isContested(null)).toBe(false);
    });
  });

  describe('claimantLabel', () => {
    it('prefers the bot name', () => {
      expect(claimantLabel(BOT_A, BOT_NAMES)).toBe('AB-A 929 measurable run');
    });

    it('falls back to a short id the reader can still search for', () => {
      expect(claimantLabel('abcdef01-2345', BOT_NAMES)).toBe('bot abcdef01…');
    });

    it('says "unattributed order" when there is no bot at all, rather than a blank', () => {
      expect(claimantLabel('', BOT_NAMES)).toBe('unattributed order');
    });
  });
});
