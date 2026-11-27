/**
 * ApiOfflineBanner.test.jsx — 27 consumers rely on this to tell a user WHY a page is empty.
 *
 * ⚠️ The assertions that matter are the ones a real outage depends on: the component names the service
 * and the PORT the user must start (a banner that says "API offline" with no port is a dead end), and it
 * offers a route to Server Controls. Nothing here asserts styling.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ApiOfflineBanner from './ApiOfflineBanner.jsx';

afterEach(cleanup);

/**
 * ⚠️ THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT (2026-11-27). The old test used
 * `.toContain('/trading/server-controls')`, which passed happily while the href was
 * `http://localhost:5188/trading/server-controls` — a port nothing in this repository serves. An
 * assertion loose enough to accept any prefix is an assertion that cannot fail on the thing that broke.
 */
function assertInAppHref(href) {
  expect(href.startsWith('/')).toBe(true);
  expect(href).not.toMatch(/localhost|127\.0\.0\.1|:\d{4}/);
}

describe('ApiOfflineBanner', () => {
  it('names the default service and port, so the user knows what to start', () => {
    render(<ApiOfflineBanner />);
    expect(screen.getByText('NestJS Backend is offline')).toBeTruthy();
    expect(screen.getByText(/port 3201/)).toBeTruthy();
  });

  it('uses the service name and port it is given, rather than assuming the backend', () => {
    render(<ApiOfflineBanner serviceName="MT5 bridge" port={5001} />);
    expect(screen.getByText('MT5 bridge is offline')).toBeTruthy();
    expect(screen.getByText(/port 5001/)).toBeTruthy();
  });

  it('links to Server Controls, which is the only in-app way to start the backend', () => {
    render(<ApiOfflineBanner />);
    const link = screen.getByRole('link', { name: /Server Controls/ });
    // ⚠️ EXACT, not `.toContain` — the old assertion passed while the href pointed at a dead port.
    assertInAppHref(link.getAttribute('href'));
    expect(link.getAttribute('href')).toBe('/trading/server-controls');
  });

  it('▶ never hardcodes a host or port in the link — it must work on any deployment', () => {
    render(<ApiOfflineBanner />);
    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href');
      expect(href.startsWith('/')).toBe(true);
      expect(href).not.toMatch(/localhost|127\.0\.0\.1|:\d{4}/);
    }
  });

  it('renders a single-line pill when compact, and still offers the start link', () => {
    render(<ApiOfflineBanner compact />);
    expect(screen.getByText('API offline')).toBeTruthy();
    const href = screen.getByRole('link').getAttribute('href');
    expect(href).toBe('/trading/server-controls');
    // the full banner's explanatory sentence must be absent, or `compact` has no effect
    expect(screen.queryByText(/Showing cached or sample data/)).toBeNull();
  });

  it('carries the port in the pill tooltip, so compact does not lose the one detail an operator needs', () => {
    render(<ApiOfflineBanner compact port={5000} />);
    expect(screen.getByTitle(/port 5000 is offline/)).toBeTruthy();
  });
});
