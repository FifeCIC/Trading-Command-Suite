/**
 * Notice.test.jsx — the plain banner's announcement contract.
 *
 * ⚠️ THE ROLE IS THE POINT (2026-11-27). `Notice` rendered no role at all, so a `critical` banner on the
 * three pages that use it was silent to assistive technology — while `NoticeBlock` had been mapping
 * severity to `alert`/`status` for months. Two components teaching different conventions about the same
 * idea is how a reader learns to trust neither.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Notice from './Notice.jsx';

afterEach(cleanup);

describe('Notice', () => {
  it('announces a critical banner as an ALERT, because it is an interruption', () => {
    render(<Notice level="critical">The API is unreachable.</Notice>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['info', 'success', 'warning'])('announces a %s banner as a STATUS, not an alert', (level) => {
    render(<Notice level={level}>For your information.</Notice>);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('defaults to info with its own glyph, so a bare <Notice> is still readable', () => {
    render(<Notice>Context.</Notice>);
    const root = screen.getByRole('status');
    expect(root.className).toContain('app-notice--info');
    expect(screen.getByText('ℹ️')).toBeTruthy();
  });

  it.each([
    ['success', '✅'],
    ['warning', '⚠️'],
    ['critical', '❌'],
    ['info', 'ℹ️'],
  ])('gives %s its own default glyph', (level, glyph) => {
    render(<Notice level={level}>x</Notice>);
    expect(screen.getByText(glyph)).toBeTruthy();
  });

  it('lets an explicit icon win over the default', () => {
    render(<Notice level="warning" icon="🔌">x</Notice>);
    expect(screen.getByText('🔌')).toBeTruthy();
    expect(screen.queryByText('⚠️')).toBeNull();
  });

  it('renders rich children, not a stringified object', () => {
    render(
      <Notice level="warning">
        <strong>Heads up</strong> — the bridge is down.
      </Notice>,
    );
    expect(screen.getByText('Heads up')).toBeTruthy();
    expect(screen.getByText(/the bridge is down/)).toBeTruthy();
  });

  it('passes className through and keeps the class the stylesheet keys on', () => {
    render(<Notice className="probe-class">x</Notice>);
    const root = screen.getByRole('status');
    expect(root.className).toContain('app-notice');
    expect(root.className).toContain('probe-class');
  });
});
