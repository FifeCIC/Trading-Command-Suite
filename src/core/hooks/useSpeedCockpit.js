import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api/client';
// The scanner's failure becomes a CODE at its SOURCE. Three pages render this string, so producing a
// coded one-liner here fixes all three at once — and the alternative (each page converting a string it
// cannot inspect) is how "Scanner offline —" ended up with no identity (#826 Phase 5).
import { noticeLine } from '../notices/registry.js';

/**
 * useSpeedCockpit — shared behavioural core for the speed-trading cockpits
 * (SpeedTradingPage, GoldSpeedTradingPage, BtcSpeedTradingPage).
 *
 * These hooks hold the decisions that must NOT drift between pages:
 *   - lockout countdown clearing
 *   - tick-history sparkline accumulation
 *   - scanner poll loop + paused||locked guard
 *   - recording toggle + backend-state sync
 *   - action-log append
 * A bug fixed here propagates to every cockpit.
 */

/** Timeframe → poll interval (ms). Single source of truth. */
export const TIMEFRAME_MS = { '1s': 1000, '5s': 5000, '15s': 15000, '1m': 60000, '5m': 300000 };

/**
 * Emergency 30s lockout with countdown. `onExpired` fires once when the
 * countdown reaches 0 (pass a page-specific log line, or omit for silent).
 */
export function useLockout(onExpired) {
  const [locked, setLocked] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);
  const lockTimer = useRef(null);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    if (locked && lockCountdown > 0) {
      lockTimer.current = setTimeout(() => setLockCountdown((c) => c - 1), 1000);
      return () => clearTimeout(lockTimer.current);
    }
    if (locked && lockCountdown === 0) {
      setLocked(false);
      onExpiredRef.current?.();
    }
  }, [locked, lockCountdown]);

  const lock = useCallback(() => {
    setLocked(true);
    setLockCountdown(30);
  }, []);

  return { locked, lockCountdown, lock };
}

/**
 * Rolling 30-point tick history for the sparkline. Returns the history and
 * the `prevMid` ref the page uses to colour the current price (up/down).
 */
export function useTickHistory(quote) {
  const [tickHistory, setTickHistory] = useState([]);
  const prevMid = useRef(null);

  useEffect(() => {
    if (quote?.mid != null) {
      setTickHistory((prev) => {
        const next = [...prev, { mid: quote.mid, t: Date.now() }];
        return next.slice(-30);
      });
      prevMid.current = quote.mid;
    }
  }, [quote?.mid]);

  return { tickHistory, prevMid };
}

/**
 * Best-opportunities scanner: POST /api/speed/scan every 5s unless paused or
 * locked. `symbols` is read from a ref so an inline array literal is safe.
 */
export function useSpeedScanner({ paused, locked, timeframe, symbols }) {
  const [scanData, setScanData] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  useEffect(() => {
    const doScan = async () => {
      if (paused || locked) return;
      try {
        const body = symbolsRef.current?.length
          ? { timeframe, symbols: symbolsRef.current }
          : { timeframe };
        const res = await fetch('http://localhost:3201/api/speed/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setScanData(await res.json());
        setScanError(null);
      } catch (e) {
        setScanError(noticeLine('TCS-SYS-007', { operation: 'connect to the speed scanner', detail: e }));
      }
      setScanLoading(false);
    };

    setScanLoading(true);
    doScan();
    const interval = setInterval(doScan, 5000);
    return () => clearInterval(interval);
  }, [paused, locked, timeframe]);

  return { scanData, scanError, scanLoading };
}

/**
 * Tick recording: poll active recordings and keep `isRecording`/`recBarCount`
 * in sync with the backend, plus the start/stop toggle.
 */
export function useTickRecording({ queryKey, symbol, refetchInterval = 5000 }) {
  const [isRecording, setIsRecording] = useState(false);
  const [recBarCount, setRecBarCount] = useState(0);
  const recordingRef = useRef(false);

  const activeRecQuery = useQuery({
    queryKey,
    queryFn: () => apiGet('/api/speed/record/active').catch(() => []),
    refetchInterval,
  });
  const activeRecordings = Array.isArray(activeRecQuery.data)
    ? activeRecQuery.data
    : (activeRecQuery.data?.recordings ?? []);

  useEffect(() => {
    const upper = symbol.toUpperCase();
    const active = activeRecordings.find((r) => (
      (r.ticker != null && String(r.ticker).toUpperCase() === upper)
      || (r.symbol != null && String(r.symbol).toUpperCase() === upper)
    ));
    if (active) {
      setIsRecording(true);
      setRecBarCount(active.barCount ?? 0);
      recordingRef.current = true;
    } else {
      setIsRecording(false);
      setRecBarCount(0);
      recordingRef.current = false;
    }
  }, [activeRecordings, symbol]);

  const toggleRecording = useCallback(async () => {
    const endpoint = isRecording ? '/api/speed/record/stop' : '/api/speed/record/start';
    try {
      await fetch(`http://localhost:3201${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      activeRecQuery.refetch();
    } catch { /* silent */ }
  }, [isRecording, symbol, activeRecQuery]);

  return { isRecording, recBarCount, recordingRef, toggleRecording };
}

/** Action log with a bounded, newest-first buffer. */
export function useActionLog(max = 30) {
  const [actionLog, setActionLog] = useState([]);

  const addLog = useCallback((msg) => {
    setActionLog((prev) => [
      { id: Date.now(), msg, time: new Date().toLocaleTimeString() },
      ...prev,
    ].slice(0, max));
  }, [max]);

  return { actionLog, addLog };
}
