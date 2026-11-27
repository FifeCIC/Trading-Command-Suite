/**
 * EmptyState.test.jsx — 23 call sites rely on this to say "no data" WITHOUT saying "zero".
 *
 * ⚠️ THE CONTRACT THAT MATTERS is the action: `actionOnClick` renders a `<button>` and takes PRECEDENCE
 * over `actionHref`. A call site that passes both is asking for a button, and silently getting an anchor
 * would submit a navigation instead of running the thing. The other half is `role="status"` — an empty
 * state that is not announced is a page that looks broken to a screen-reader user.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import EmptyState from './EmptyState.jsx';

afterEach(cleanup);

describe('EmptyState', () => {
  it('defaults to a status announcement with a sensible title, so "nothing here" is not silent', () => {
    render(<EmptyState />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    // no description and no action by default — an empty state may be a single line
    expect(document.querySelector('.app-empty-desc')).toBeNull();
    expect(document.querySelector('.app-empty-action')).toBeNull();
  });

  it('renders the description when given, and omits the paragraph when not', () => {
    render(<EmptyState description="Run the pipeline to populate this." />);
    expect(screen.getByText('Run the pipeline to populate this.')).toBeTruthy();
  });

  it('renders a BUTTON when actionOnClick is given, and calling it runs the handler', () => {
    const onClick = vi.fn();
    render(<EmptyState actionLabel="Run scoring" actionOnClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Run scoring' });
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('▶ actionOnClick WINS over actionHref — the precedence the docblock promises', () => {
    const onClick = vi.fn();
    render(<EmptyState actionLabel="Go" actionHref="/somewhere" actionOnClick={onClick} />);
    expect(screen.getByRole('button', { name: 'Go' })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a LINK when only actionHref is given', () => {
    render(<EmptyState actionLabel="Open periods" actionHref="/lab/periods" />);
    const link = screen.getByRole('link', { name: 'Open periods' });
    expect(link.getAttribute('href')).toBe('/lab/periods');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ignores an action without a label — a button with no text is not an action', () => {
    render(<EmptyState actionHref="/nowhere" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('passes className through and keeps the base class the stylesheet keys on', () => {
    render(<EmptyState className="probe-class" />);
    const root = screen.getByRole('status');
    expect(root.className).toContain('app-empty');
    expect(root.className).toContain('probe-class');
  });

  it('accepts a React node as the icon, not only an emoji', () => {
    render(<EmptyState icon={<svg data-testid="glyph" />} />);
    expect(screen.getByTestId('glyph')).toBeTruthy();
  });
});
