/**
 * LoadingSkeleton.test.jsx — the layout contract of the most-reused component in the app (74 consumers).
 *
 * ⚠️ These assert the things a caller DEPENDS ON: how many shapes appear for a given prop, the
 * accessible name each variant announces, and that `className` reaches the root. They deliberately do
 * NOT assert the skeleton's pixel widths — a test that pins `30%` restates the implementation and breaks
 * on a restyle, which is the opposite of what a contract test is for.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import LoadingSkeleton from './LoadingSkeleton.jsx';

afterEach(cleanup);

describe('LoadingSkeleton', () => {
  it('defaults to ONE card and announces itself as loading cards', () => {
    const { container } = render(<LoadingSkeleton />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByLabelText('Loading cards')).toBeTruthy();
    expect(container.querySelectorAll('.ls-card').length).toBe(1);
  });

  it('renders `count` cards, so a caller can match the number of things it is waiting for', () => {
    const { container } = render(<LoadingSkeleton count={4} />);
    expect(container.querySelectorAll('.ls-card').length).toBe(4);
  });

  it('renders a table of rows x cols cells', () => {
    const { container } = render(<LoadingSkeleton variant="table" rows={3} cols={2} />);
    expect(screen.getByLabelText('Loading table')).toBeTruthy();
    expect(container.querySelectorAll('.ls-table-row').length).toBe(3);
    expect(container.querySelectorAll('.ls-table-cell').length).toBe(6);
  });

  it('renders `lines` text lines and labels the variant as text', () => {
    const { container } = render(<LoadingSkeleton variant="text" lines={3} />);
    expect(screen.getByLabelText('Loading text')).toBeTruthy();
    expect(container.querySelectorAll('.ls-text-line').length).toBe(3);
  });

  it('renders a chart bar per `count` and labels the variant as a chart', () => {
    const { container } = render(<LoadingSkeleton variant="chart" count={5} />);
    expect(screen.getByLabelText('Loading chart')).toBeTruthy();
    expect(container.querySelectorAll('.ls-chart-bar').length).toBe(5);
  });

  it('falls back to the card variant for an unrecognised variant rather than rendering nothing', () => {
    const { container } = render(<LoadingSkeleton variant="not-a-variant" count={2} />);
    expect(screen.getByLabelText('Loading cards')).toBeTruthy();
    expect(container.querySelectorAll('.ls-card').length).toBe(2);
  });

  it('passes className through to the root element', () => {
    render(<LoadingSkeleton className="probe-class" />);
    expect(screen.getByRole('status').className).toContain('probe-class');
  });
});
