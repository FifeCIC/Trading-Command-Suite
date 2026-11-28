/**
 * PortfolioCompositionPanel.test.jsx — the ported allocation block.
 *
 * ⚠️ THE CONTRACT THAT MATTERS IS WHAT IT REFUSES TO COUNT. A share of value is only meaningful when
 * every row is in ONE currency, and the merged page passes T212/ISA rows only (an MT5 row's `value` is
 * a notional in the instrument's own currency). So a row with no usable value must be EXCLUDED AND
 * COUNTED, never treated as zero — a zero would silently shrink the denominator and inflate every
 * other share, which is the "plausible number, no error" shape this repo keeps re-finding.
 *
 * The second contract is the tail: past 8 slices the remainder is grouped, and the legend must say how
 * many it grouped (3 facts in one row) rather than dropping them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import PortfolioCompositionPanel from './PortfolioCompositionPanel.jsx';

afterEach(cleanup);

const row = (ticker, value) => ({ key: `t212-${ticker}`, ticker, value });

describe('PortfolioCompositionPanel', () => {
  it('reports a share of the usable total, and counts the rows it could not value', () => {
    render(
      <PortfolioCompositionPanel
        rows={[row('AAA', 75), row('BBB', 25), row('CCC', null), row('DDD', 0)]}
        unit="GBP"
      />,
    );

    // 2 of 4 rows are usable, and the caption says so rather than quietly dividing by 2.
    expect(screen.getByText(/2 rows excluded/)).toBeTruthy();
    expect(screen.getByText('75.0%')).toBeTruthy();
    expect(screen.getByText('25.0%')).toBeTruthy();
  });

  it('groups everything past the eighth slice and names the count', () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(`S${i + 1}`, 100 - i));
    render(<PortfolioCompositionPanel rows={rows} />);

    const table = screen.getByRole('table');
    // 8 named slices + the "Other" row.
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 8 + 1);
    expect(within(table).getByText('Other (3)')).toBeTruthy();
  });

  it('says it cannot compute a share rather than rendering an empty bar', () => {
    render(<PortfolioCompositionPanel rows={[row('AAA', null), row('BBB', -5)]} />);
    expect(screen.getByText('Nothing to apportion yet')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('carries a text alternative for the bar, so the shape is not pointer-only', () => {
    render(<PortfolioCompositionPanel rows={[row('AAA', 60), row('BBB', 40)]} />);
    const bar = screen.getByRole('img');
    expect(bar.getAttribute('aria-label')).toContain('AAA 60.0 percent');
  });
});
