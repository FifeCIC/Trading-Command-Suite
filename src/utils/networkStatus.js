/**
 * Network Status Utilities
 *
 * Provides online/offline detection and periodic connectivity checks.
 * Can be used standalone or as part of the PWA offline experience.
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * React hook that tracks online/offline status.
 * Returns { isOnline, wasOffline, lastOnlineAt }
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastOnlineAt, setLastOnlineAt] = useState(
    navigator.onLine ? new Date() : null
  );
  const [wasOffline, setWasOffline] = useState(false);

  const handleOnline = useCallback(() => {
    setIsOnline(true);
    setLastOnlineAt(new Date());
    setWasOffline(true);

    // Clear the "was offline" flag after 5 seconds
    setTimeout(() => setWasOffline(false), 5000);
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodic connectivity check (every 30s)
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/health', {
          method: 'HEAD',
          cache: 'no-store',
        });
        if (res.ok && !navigator.onLine) {
          handleOnline();
        }
      } catch {
        if (navigator.onLine) {
          handleOffline();
        }
      }
    }, 30_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [handleOnline, handleOffline]);

  return { isOnline, wasOffline, lastOnlineAt };
}

/**
 * Get a human-readable "last online" string.
 */
export function getLastOnlineLabel(lastOnlineAt) {
  if (!lastOnlineAt) return 'Never';
  const diff = Date.now() - lastOnlineAt.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return lastOnlineAt.toLocaleDateString();
}
