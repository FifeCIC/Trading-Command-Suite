/**
 * useTradeAttention — a BROWSER notification when algo trading is not active.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────────────────────
 * Owner, 2026-09-27: *"Yes I want the browser notification too."*
 *
 * ⚠️ THIS IS THE BACKSTOP, NOT THE PRIMARY CHANNEL — and the difference matters, because it
 * decides how much it can be trusted. A browser notification **only fires while a tab is open and
 * the browser is running**. The condition this exists for (AutoTrading off at the MT5 terminal)
 * lasts hours or days precisely because nobody is looking. The Windows channel raised from the
 * BACKEND is the one that reaches an absent owner; this one reaches an owner who has the app open
 * in front of them, which is a different and still useful case.
 *
 * It is deliberately NOT a second poller of the trading path: it reads `GET /api`, which already
 * carries `anyTradeAllowed` — the field added in #972/#1010. Nothing new is computed here.
 *
 * ── THE RULES IT FOLLOWS, EACH OF WHICH WAS PAID FOR SOMEWHERE ELSE IN THIS REPO ─────────────
 *
 * 1. **`null` IS UNKNOWN AND MUST NOT ALERT.** `anyTradeAllowed === null` means the state could not
 *    be read. Collapsing that into `false` would raise a false alarm on every unreadable poll. Only
 *    a definite `false` notifies — the same rule the backend trigger follows, and the exact bug the
 *    backend's own spec caught in its first version.
 *
 * 2. **THROTTLED, AND THE THROTTLE IS CLEARED ON RECOVERY.** A notification every poll is one the
 *    reader learns to dismiss unread — the same failure as an allowlisted guard. Clearing on
 *    recovery means the NEXT outage notifies immediately rather than being swallowed by the
 *    previous one's cooldown.
 *
 * 3. **RECOVERY IS ANNOUNCED.** *"Trading is off"* is only half the information. An owner who took
 *    one action and saw one notification needs to know whether it worked, or they will go and check
 *    by hand — which is the behaviour this exists to remove.
 *
 * 4. **PERMISSION IS ASKED ONCE, AND A REFUSAL IS RESPECTED SILENTLY.** Re-prompting is impossible
 *    in every current browser anyway (`requestPermission()` resolves to the stored denial), so
 *    retrying would only spam the console.
 */

import { useEffect, useRef } from 'react';
import { apiGet } from './api/client';

/** Minimum gap between notifications for the same condition. Mirrors the backend's 15 minutes. */
const COOLDOWN_MS = 15 * 60 * 1000;

/** How often to ask `GET /api` about the trading state. */
const POLL_MS = 60 * 1000;

export default function useTradeAttention() {
  /** 'off' → notified when trading became impossible; 'on' → the last observed state. */
  const lastState = useRef(null);
  const lastNotifiedAt = useRef(0);
  const permissionAsked = useRef(false);

  useEffect(() => {
    // ⚠️ Guard the whole hook: a browser without the Notification API (older Safari, some embedded
    // webviews) must degrade to "no browser alerts" rather than throwing inside the app shell.
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    let cancelled = false;

    const notify = (title, body) => {
      try {
        // `tag` REPLACES rather than stacks, so a long outage leaves one entry in the notification
        // centre instead of dozens — the same reasoning as the backend's attention-key throttle.
        const n = new Notification(title, {
          body,
          tag: 'tcs-trade-disabled',
          requireInteraction: true,
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        /* a notification that cannot be shown must never break the shell */
      }
    };

    const tick = async () => {
      let api;
      try {
        api = await apiGet('/api');
      } catch {
        // ⚠️ The API being unreachable is NOT "trading is off". It is a different fault with its own
        // existing surfaces, and reporting it here would make this channel cry wolf about something
        // it cannot actually diagnose.
        return;
      }
      if (cancelled) return;

      const allowed = api?.mt5Bridge?.anyTradeAllowed;
      if (allowed == null) return; // UNKNOWN — see rule 1. Never alert on it.

      const now = Date.now();
      const changed = lastState.current !== allowed;

      if (allowed === false) {
        // Ask for permission at the moment it is actually useful, rather than on page load.
        if (!permissionAsked.current) {
          permissionAsked.current = true;
          if (Notification.permission === 'default') {
            try {
              await Notification.requestPermission();
            } catch {
              /* ignore — a refusal is respected */
            }
          }
        }
        if (Notification.permission !== 'granted') return;

        const cooled = now - lastNotifiedAt.current < COOLDOWN_MS;
        if (changed || !cooled) {
          lastNotifiedAt.current = now;
          const detail = api?.mt5Bridge?.tradeapiDisabled === true
            ? 'the MT5 API trade path is disabled'
            : 'AutoTrading is switched off at the terminal';
          notify(
            'Algo trading is OFF — no order can be placed',
            `Every bridge is connected, so nothing else reports this: ${detail}. ` +
            `Enable it in each MT5 terminal to resume.`,
          );
        }
      } else if (changed && lastState.current === false) {
        // The recovery half — see rule 3.
        notify('Algo trading is back ON', 'Orders can be placed again.');
        lastNotifiedAt.current = 0;
      }

      lastState.current = allowed;
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
}

/**
 * Whether the browser can currently deliver these alerts — so a surface can TELL the owner rather
 * than silently doing nothing.
 *
 * ⚠️ `'unsupported'` and `'denied'` are deliberately distinct from `'default'`. Development
 * Philosophy: *"Distinguish 'fine' from 'cannot judge'."* A surface that renders "alerts on" while
 * permission was never granted is reporting a capability that does not exist.
 */
export function browserAlertState() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}
