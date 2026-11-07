/**
 * report-buffers.js — the CAPTURE layer of the support service (#1248).
 *
 * ── PORTABILITY ──────────────────────────────────────────────────────────────
 * This file imports NOTHING from this app. That is deliberate: #1248 is meant to
 * become a library the owner can drop into OmniCore, StreamerOps, Star Cities and
 * the FifeCIC site. The host app installs the buffers and hands over its own facts;
 * nothing here knows what a "protocol" or a "broker" is.
 *
 * ── WHAT IT RECORDS, AND WHAT IT REFUSES TO ─────────────────────────────────
 * Recorded: console errors, uncaught errors, unhandled rejections, and FAILED HTTP
 * requests (method, path, status, duration, and the response body of a failure).
 * NOT recorded: request headers, successful responses, cookies, credentials. The
 * exclusion is an ALLOWLIST decision — we record four fields plus the body, and
 * there is no code path here that can retain anything else.
 *
 * ── DECISION (owner, 2026-11-07, #1248) ─────────────────────────────────────
 * WHAT:      a failing response's BODY is retained in memory, so a report can carry it.
 * WHY:       "I like B because sometimes we're going to need to know the numbers."
 *            A status code alone cannot reproduce a WRONG NUMBER, which is the
 *            defect class this app actually suffers from.
 * INSTEAD OF: recording only status/timing (option A), or replacing values with
 *            types (option C — safe, but stripping the value can hide the fault).
 * REVERSE BY: setting MAX_BODY_CHARS to 0 — the bodies stop being kept, everything
 *            else still works, and no other file changes.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 140
 * GUARD:     src/core/support/report-build.test.js
 *
 * ⚠️ Retention is BOUNDED on purpose: the last few failures only. An unbounded
 * buffer in a long-lived tab is a memory leak that arrives silently, and the
 * newest failure is the one being reported.
 */

const MAX_ERRORS = 20;
const MAX_REQUESTS = 5;
/** 0 would disable body retention without touching anything else (see REVERSE BY). */
export const MAX_BODY_CHARS = 8000;

let installed = false;
let paused = 0;
const errorLog = [];
const requestLog = [];

function nowIso() {
  return new Date().toISOString();
}

/** Describe an arbitrary console argument without risking a throw or a giant string. */
function describeArg(arg) {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function pushError(entry) {
  errorLog.push({ at: nowIso(), ...entry });
  while (errorLog.length > MAX_ERRORS) errorLog.shift();
}

/** Strip the origin — the host is this machine and says nothing about the fault. */
function pathOf(url) {
  try {
    const u = new URL(url, window.location.origin);
    return `${u.pathname}${u.search}`;
  } catch {
    return String(url);
  }
}

function truncate(text) {
  if (MAX_BODY_CHARS <= 0) return '';
  if (typeof text !== 'string') return '';
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}… [truncated]` : text;
}

function pushRequest(entry) {
  requestLog.push({ at: nowIso(), ...entry });
  while (requestLog.length > MAX_REQUESTS) requestLog.shift();
}

/**
 * installSupportBuffers() — call ONCE, as early as possible, before the first render.
 * Idempotent: a second call (React StrictMode, HMR, a re-import) does nothing.
 * Returns true when it installed, false when it was already installed or there is
 * no window (SSR / a node test run).
 */
export function installSupportBuffers() {
  if (installed || typeof window === 'undefined') return false;
  installed = true;

  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    pushError({ source: 'console', message: args.map(describeArg).join(' ') });
    originalConsoleError(...args);
  };

  window.addEventListener('error', (event) => {
    pushError({
      source: 'window',
      message: event.message || 'error event',
      detail: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    pushError({
      source: 'promise',
      message: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
    });
  });

  // ⚠️ A GLOBAL fetch WRAPPER, not an edit to every call site. Measured 2026-11-07:
  // 131 raw `fetch(` calls across src/. Wrapping once catches all of them, including
  // the ones that never go through core/api/client.js — and it keeps working when a
  // page adds a new call without knowing this exists.
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const startedAt = Date.now();
      const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      const rawUrl = typeof input === 'string' ? input : input?.url ?? '';
      try {
        const response = await originalFetch(input, init);
        if (!response.ok && paused === 0) {
          let body = '';
          try {
            // clone() so the page still gets a readable body — this must never
            // consume the response it is observing.
            body = truncate(await response.clone().text());
          } catch {
            body = '[body unreadable]';
          }
          pushRequest({
            method,
            path: pathOf(rawUrl),
            status: response.status,
            ms: Date.now() - startedAt,
            body,
          });
        }
        return response;
      } catch (err) {
        if (paused === 0) {
          pushRequest({
            method,
            path: pathOf(rawUrl),
            status: null,
            ms: Date.now() - startedAt,
            body: '',
            error: err?.message ? String(err.message) : String(err),
          });
        }
        throw err;
      }
    };
  }

  return true;
}

/**
 * getSupportSnapshot() — a COPY of what is buffered, for the report builder.
 * Copies rather than live arrays so a report is a stable artefact: the page can
 * keep logging failures while the user reads what they are about to send.
 */
export function getSupportSnapshot() {
  return {
    errors: errorLog.map((e) => ({ ...e })),
    requests: requestLog.map((r) => ({ ...r })),
    limits: { errors: MAX_ERRORS, requests: MAX_REQUESTS, bodyChars: MAX_BODY_CHARS },
  };
}

export function resetSupportBuffers() {
  errorLog.length = 0;
  requestLog.length = 0;
}

/**
 * withSupportCapturePaused(fn) — run `fn` WITHOUT its traffic entering the buffers.
 *
 * ⚠️ WITHOUT THIS THE REPORT PHOTOGRAPHS ITS OWN CAMERA. Measured 2026-11-07 in the running
 * app: collecting `/api/health` and `/api/version` to fill the report's "System state" block
 * wrote two failed requests into the very buffer being reported — and because the buffer keeps
 * only the last 5 failures, the real fault the user was reporting was PUSHED OUT and replaced
 * by two 404s the report itself had caused.
 *
 * Pausing is not silence: if the collection fails, the report says so in "System state"
 * ("Could not collect: …"). The failure is reported by RESULT, not by side effect.
 */
export async function withSupportCapturePaused(fn) {
  paused += 1;
  try {
    return await fn();
  } finally {
    paused -= 1;
  }
}

/**
 * isSupportCaptureActive() — did the buffers actually install?
 *
 * ⚠️ THIS EXISTS SO A REPORT CAN TELL "NOTHING HAPPENED" APART FROM "I WAS NOT LOOKING".
 * If the installer never ran (a page that mounts before main.jsx, a test harness, an
 * error before boot), the buffers are empty — and an empty list printed without a
 * caveat reads as "no errors occurred", which is the opposite of the truth.
 */
export function isSupportCaptureActive() {
  return installed;
}
