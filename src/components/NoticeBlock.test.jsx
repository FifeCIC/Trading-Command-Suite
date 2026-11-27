/**
 * NoticeBlock.test.jsx — the accessibility contract of the ONE notice renderer (#826).
 *
 * ⚠️ The severity → `role` mapping is the load-bearing assertion. A failure must reach assistive tech as
 * `role="alert"` (announced immediately); an advisory must not, or every info notice interrupts the
 * reader. This is the reason the component exists in one place at all, so it is the thing worth pinning.
 *
 * ⚠️ Second: `cause` and `action` must be VISIBLE TEXT. They were once `title=` attributes, which are
 * hover-only — unusable by keyboard and touch, and the reason #824 gave a user nothing to act on. A test
 * that only checked the property names would not notice them being hidden again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import NoticeBlock from './NoticeBlock.jsx';

afterEach(cleanup);

const base = {
  title: 'Market closed',
  code: 'TCS-DATA-001',
  message: 'No bars were returned for this symbol.',
  severity: 'warning',
};

describe('NoticeBlock', () => {
  it('renders nothing for a null notice, so callers need no guard of their own', () => {
    const { container } = render(<NoticeBlock notice={null} />);
    expect(container.firstChild).toBeNull();
  });

  it.each(['critical', 'error'])('announces a %s notice as role="alert"', (severity) => {
    render(<NoticeBlock notice={{ ...base, severity }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it.each(['warning', 'info', 'success'])('renders a %s notice as role="status", not an alert', (severity) => {
    render(<NoticeBlock notice={{ ...base, severity }} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the stable code, so a user can quote it when reporting the problem', () => {
    render(<NoticeBlock notice={base} />);
    expect(screen.getByText('TCS-DATA-001')).toBeTruthy();
    expect(screen.getByText('Market closed')).toBeTruthy();
  });

  it('renders cause and action as visible text under Why and Fix labels', () => {
    render(
      <NoticeBlock
        notice={{ ...base, cause: 'The provider returned no session.', action: 'Retry after the open.' }}
      />,
    );
    expect(screen.getByText('Why')).toBeTruthy();
    expect(screen.getByText('The provider returned no session.')).toBeTruthy();
    expect(screen.getByText('Fix')).toBeTruthy();
    expect(screen.getByText('Retry after the open.')).toBeTruthy();
  });

  it('omits the Why and Fix labels when there is nothing to say', () => {
    render(<NoticeBlock notice={base} />);
    expect(screen.queryByText('Why')).toBeNull();
    expect(screen.queryByText('Fix')).toBeNull();
  });

  it('lists related refs on the code element, so the citation survives a copy of the notice', () => {
    render(<NoticeBlock notice={{ ...base, refs: [824, 826] }} />);
    expect(screen.getByText('TCS-DATA-001').getAttribute('title')).toContain('Related: 824 826');
  });

  it('names the external system and its own code when the failure came from outside', () => {
    render(
      <NoticeBlock
        notice={{ ...base, external: { system: 'MT5 bridge', code: 500, name: 'Internal Server Error' } }}
      />,
    );
    expect(screen.getByText('MT5 bridge 500 · Internal Server Error')).toBeTruthy();
  });

  it('adds the compact modifier only when asked', () => {
    render(<NoticeBlock notice={base} />);
    expect(screen.getByRole('status').className).not.toContain('notice-block--compact');
    cleanup();
    render(<NoticeBlock notice={base} compact />);
    expect(screen.getByRole('status').className).toContain('notice-block--compact');
  });
});
