import { env } from '../core/config/env';
import { createAnalyticsClient } from './client';

export const analytics = createAnalyticsClient({
  appId: env.VITE_ANALYTICS_APP_ID,
  endpoint: env.VITE_ANALYTICS_ENDPOINT,
  enabled: env.VITE_ANALYTICS_ENABLED === 'true',
  flushIntervalMs: env.VITE_ANALYTICS_FLUSH_INTERVAL_MS
});

analytics.start();

export function trackSupportClick(surface) {
  analytics.track('support.cta.clicked', {
    surface,
    path: window.location.pathname || '/'
  });
}

export function trackAppView() {
  analytics.track('app.viewed', {
    path: window.location.pathname || '/',
    hash: window.location.hash || ''
  });
}
