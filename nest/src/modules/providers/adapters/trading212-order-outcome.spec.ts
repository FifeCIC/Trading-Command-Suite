/**
 * #1359 — an accepted order is not necessarily a filled order.
 *
 * The adapter used to default `status` to `'filled'` when the broker sent none, so a market order
 * queued for the next open was recorded as an open position. These cases pin the strict rule.
 */
import { Trading212Adapter } from './trading212.adapter';

describe('Trading212Adapter.orderFilled (#1359)', () => {
  it('counts a fill price as evidence of a fill', () => {
    expect(Trading212Adapter.orderFilled({ success: true, status: 'UNCONFIRMED', filledPrice: 12.34 })).toBe(true);
  });

  it('counts an explicit FILLED status as evidence of a fill', () => {
    expect(Trading212Adapter.orderFilled({ success: true, status: 'FILLED' })).toBe(true);
    expect(Trading212Adapter.orderFilled({ success: true, status: 'filled' })).toBe(true);
  });

  it('does NOT claim a fill for an accepted order the broker did not confirm', () => {
    expect(Trading212Adapter.orderFilled({ success: true, status: 'UNCONFIRMED' })).toBe(false);
    expect(Trading212Adapter.orderFilled({ success: true, status: 'NEW' })).toBe(false);
    expect(Trading212Adapter.orderFilled({ success: true })).toBe(false);
  });

  it('never counts a failed order as filled, whatever status it carries', () => {
    expect(Trading212Adapter.orderFilled({ success: false, status: 'FILLED', filledPrice: 1 })).toBe(false);
    expect(Trading212Adapter.orderFilled(null)).toBe(false);
    expect(Trading212Adapter.orderFilled(undefined)).toBe(false);
  });
});
