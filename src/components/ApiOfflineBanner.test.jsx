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
    expect(link.getAttribute('href')).toContain('/trading/server-controls');
  });

  it('renders a single-line pill when compact, and still offers the start link', () => {
    render(<ApiOfflineBanner compact />);
    expect(screen.getByText('API offline')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toContain('/trading/server-controls');
    // the full banner's explanatory sentence must be absent, or `compact` has no effect
    expect(screen.queryByText(/Showing cached or sample data/)).toBeNull();
  });

  it('carries the port in the pill tooltip, so compact does not lose the one detail an operator needs', () => {
    render(<ApiOfflineBanner compact port={5000} />);
    expect(screen.getByTitle(/port 5000 is offline/)).toBeTruthy();
  });
});
