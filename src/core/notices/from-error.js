/**
 * noticeFromError() — turn a thrown error into a registry notice.
 * ==============================================================
 * Created 2026-09-15 for #826 Phase 2 (signals surface).
 *
 * WHY THIS EXISTS
 * ---------------
 * An error arriving from the API is a *string*. Rendering it puts the burden on the reader and
 * loses everything structured about it — which is how "Unsupported filling mode" reached a user
 * with no symbol, no retcode and no remedy (#824).
 *
 * This adapter is the ONE place that decides which code an error maps to, so every surface shows
 * the same code for the same condition and the codes stay joinable across logs, the UI and issues.
 *
 * RESOLUTION ORDER — most specific first:
 *   1. A code the SERVER supplied. This is the destination (see #826 Phase 1) and is checked first
 *      so the migration needs no change here when the server starts sending `{ code, params }`.
 *   2. A client timeout (`err.timedOut`)              → TCS-SYS-003
 *   3. A structured HTTP status (`err.status`)        → TCS-SYS-002
 *   4. The caller's `fallbackCode`, which must describe the OPERATION ("could not place the order"),
 *      never the transport, and always keeps the server's own text as `detail`. ⚠️ A transport
 *      fallback that NAMES a status (TCS-SYS-002/006) cannot be rendered here — reaching this
 *      branch means no response arrived — so it is replaced by TCS-SYS-009.
 *
 * ⚠️ The server's wording is ALWAYS preserved as `detail`. The code gives the message an identity;
 * it must never be the reason a specific broker message is lost.
 *
 * ⚠️ Do NOT match on prose. `if (msg.includes('filling'))` would break the moment the broker
 * rewords, and it contradicts the whole point of the registry. If a condition needs its own code,
 * the server should send the code.
 */

// ⚠️ The `.js` extension is deliberate, and is the ONE deviation from the extensionless convention
// used by the rest of `src/core`. Node's ESM resolver requires it; Vite accepts both. With it, this
// module can be unit-tested and reached from `scripts/validators`, which is how the rest of the
// codebase is now guarded. Do not "tidy" it back to './registry'.
import { notice, isNoticeCode } from './registry.js';

/**
 * Transport codes whose templates NAME an HTTP status. They belong to branch 3, where a response
 * WAS received and `err.status` exists. If one reaches branch 4 there is no status to name and the
 * text would render the literal `{status}` — the defect an owner saw on /trading/strategies-derived
 * on 2026-09-22 while the API was restarting. No-response failures get their own code instead.
 */
const CODES_NEEDING_STATUS = ['TCS-SYS-002', 'TCS-SYS-006'];

/**
 * @param {unknown} err            the thrown value (Error, or anything)
 * @param {string}  fallbackCode   registry code describing the OPERATION that failed
 * @param {object}  params         extra params for the fallback code (e.g. { symbol })
 * @returns a rendered notice object (never null, never blank)
 */
export function noticeFromError(err, fallbackCode = 'TCS-SYS-002', params = {}) {
  // 1. Server-owned code — the target contract.
  if (isNoticeCode(err?.code)) {
    return notice(err.code, { ...params, ...(err.params || {}), detail: err.detail ?? err.message });
  }

  // 2. Timeout — the client gave up, so there is no HTTP status to report.
  if (err?.timedOut || err?.name === 'AbortError') {
    return notice('TCS-SYS-003', { seconds: err?.timeoutSeconds ?? '30' });
  }

  // 3. A real HTTP response we could read a status from.
  if (typeof err?.status === 'number') {
    return notice('TCS-SYS-002', {
      ...params,
      status: err.status,
      detail: err.detail || err.message || '',
    });
  }

  // 4. Anything else (network down, the API restarting, a TypeError, a non-Error thrown): there is
  //    NO HTTP response here, so a transport code whose text names a status cannot describe it. An
  //    OPERATION fallback (the caller's own code) is kept, because it says what failed rather than
  //    how it was delivered; the raw text stays visible as `detail` either way.
  const code = CODES_NEEDING_STATUS.includes(fallbackCode) ? 'TCS-SYS-009' : fallbackCode;
  return notice(code, {
    ...params,
    detail: err?.detail || err?.message || String(err ?? ''),
  });
}
