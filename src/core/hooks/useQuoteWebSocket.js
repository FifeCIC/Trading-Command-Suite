/* ── PLANNED IN #1228 ──
 * MISSING:  reachability. Nothing in src/ or nest/src/ names this file — no import, no route,
 *           no dynamic load. Either it is dead code, or it is a capability nobody wired up, and
 *           those two need opposite responses.
 * TODAY:    found by the name-reference scan in scripts/audit-code-health.cjs (see
 *           docs/CODE-HEALTH.md). Decide DELETE / WIRE UP / KEEP+explain, record it on the
 *           issue, then re-bank: node scripts/audit-code-health.cjs --write
 * WHEN BUILT: the file is either gone, or reachable and named by something.
 * CODE-HEALTH-MARKER — written by scripts/audit-code-health.cjs; re-run it rather than editing.
 */

/**
 * useQuoteWebSocket — subscribe to live quote ticks via Socket.io.
 *
 * Replaces HTTP polling for real-time bid/ask streaming.
 * Connects to ws://localhost:3201/quotes (Socket.io namespace).
 *
 * Usage:
 *   const { ticks, connected, subscribe, unsubscribe } = useQuoteWebSocket();
 *   subscribe('BTCUSD');
 *   // ticks.BTCUSD is an array of { bid, ask, mid, spread, timestamp }
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const WS_URL = 'http://localhost:3201/quotes';
const MAX_TICKS = 500; // keep last 500 ticks per symbol (~2 min at 250ms polling)

export default function useQuoteWebSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [ticks, setTicks] = useState({});

  useEffect(() => {
    const socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('quote:tick', (tick) => {
      const sym = tick.symbol;
      setTicks((prev) => {
        const arr = prev[sym] ?? [];
        const next = [...arr, tick];
        return { ...prev, [sym]: next.slice(-MAX_TICKS) };
      });
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const subscribe = useCallback((symbol) => {
    socketRef.current?.emit('subscribe:quote', { symbol });
  }, []);

  const unsubscribe = useCallback((symbol) => {
    socketRef.current?.emit('unsubscribe:quote', { symbol });
  }, []);

  return { ticks, connected, subscribe, unsubscribe };
}
