/**
 * Server-side notice catalogue — the NestJS half of `src/core/notices/registry.js`.
 * ==============================================================================
 * Created 2026-09-15 for #826 **Phase 1** (the server → client contract).
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * The frontend registry is the ONE place user-facing wording lives, and the server deliberately
 * does NOT send prose. So why does the server need any catalogue?
 *
 * Two reasons, and only two:
 *
 *   1. **HTTP status.** A code like `TCS-INTEG-001` has to become a status (503). The client
 *      cannot decide that — the status is a property of the response, and it must be decided
 *      before the response exists.
 *   2. **Log severity.** A log line reading `[TCS-INTEG-001] MT5 bridge not connected` is joinable to a
 *      UI report; a bare code is not. `severity` also selects the log level, so an expected
 *      broker refusal does not shout like a crash.
 *
 * ⚠️ THE `label` IS NOT THE USER-FACING MESSAGE. It is a terse log/server line. User wording comes
 * from the client registry, by code. Do not grow this file into a second message catalogue: two
 * catalogues that must both be edited is exactly the drift this project already suffers from.
 *
 * WHY THE TWO ROOTS DO NOT SHARE THIS FILE
 * ----------------------------------------
 * `nest/` and `src/` share no build (see `shared-core.instructions.md`). The interface between
 * them is the **code**, and the code list is kept honest by a build gate —
 * `scripts/validate-notices.cjs` parses this file and fails the build if a code here is unknown to
 * the registry, if its severity disagrees, or if the backend emits a code this file never declared.
 *
 * ⚠️ KEEP ONE ENTRY PER LINE, in the exact shape below. The gate reads this file with a regex, not
 * a TypeScript parser (no TS toolchain at that point in `prebuild`). Reformatting an entry across
 * lines will not fail the build — it will make the gate see *zero* entries, which it reports as a
 * parse failure, deliberately, so the check can never be silently disabled.
 */

/** Mirrors SEVERITIES in `src/core/notices/registry.js`. Disagreement fails the build. */
export type NoticeSeverity = 'critical' | 'error' | 'warning' | 'info' | 'success';

/** Mirrors CODE_PATTERN in the registry: `TCS-<AREA>-<3 digits>`. */
export const NOTICE_CODE_PATTERN = /^TCS-[A-Z]{2,6}-\d{3}$/;

export function isNoticeCode(value: unknown): value is string {
  return typeof value === 'string' && NOTICE_CODE_PATTERN.test(value);
}

export interface ServerNotice {
  /** Status used when the throw site does not override it. */
  httpStatus: number;
  /** Must equal the registry's severity for this code — enforced by the gate. */
  severity: NoticeSeverity;
  /** Terse one-liner for server logs and as a last-resort `message`. Not the user-facing sentence. */
  label: string;
}

/**
 * Codes the BACKEND can emit. A code with no entry here is still serialised (never dropped, never
 * blanked — see the anti-silence rule) but is logged as unregistered, because it means a throw site
 * invented a code the client cannot explain. *
 * ⚠️ The gate treats ANY `TCS-…` literal in `nest/src` as "the backend can emit this". A comment that
 * merely *mentions* a client-only code therefore has to name it without the literal form, or the
 * gate will demand a status for a code the server never throws. */
export const SERVER_NOTICES: Record<string, ServerNotice> = {
  'TCS-SYS-002': { httpStatus: 500, severity: 'error', label: 'Request failed' },
  'TCS-SYS-004': { httpStatus: 400, severity: 'error', label: 'Request rejected before it ran' },
  'TCS-SYS-005': { httpStatus: 504, severity: 'error', label: 'API request exceeded its deadline' },
  'TCS-SYS-006': { httpStatus: 500, severity: 'error', label: 'Unexpected server error' },
  'TCS-INTEG-001': { httpStatus: 503, severity: 'critical', label: 'MT5 bridge not connected' },
  'TCS-INTEG-002': { httpStatus: 503, severity: 'critical', label: 'MT5 circuit breaker open' },
  // Rendered by the client since #826 Phase 2; emitted by the SERVER from 2026-09-20 so a
  // feasibility refusal carries its identity instead of falling through to TCS-SYS-002.
  // 400, not the undeclared 500 fallback: a pre-trade gate refusal is client-actionable.
  'TCS-RISK-001': { httpStatus: 400, severity: 'warning', label: 'Trade blocked by a safety gate' },
  // Emitted when a bot delete is refused because the row is still active (2026-09-22, A/B copy
  // work). 409: the request conflicts with the resource's current state; the remedy is deactivate
  // first. Declared here because the SERVER throws it; the client only renders it.
  'TCS-TRADE-018': { httpStatus: 409, severity: 'error', label: 'Bot is still active' },
  // #843 — the sizing path (automation loop) refuses to dispatch when the size cannot be made
  // valid; the decision record carries this code. 400: the refusal is configuration/venue-shaped,
  // and the remedy is client-actionable.
  'TCS-TRADE-023': { httpStatus: 400, severity: 'error', label: 'Position size could not be computed' },
};

/** Fallback for a code that is not declared above. Deliberately loud rather than blank. */
export function serverNotice(code: string): ServerNotice {
  return (
    SERVER_NOTICES[code] ?? {
      httpStatus: 500,
      severity: 'error',
      label: `Unregistered notice code ${code}`,
    }
  );
}

/**
 * Per-code reference link sent as `docsUrl`.
 *
 * ⚠️ Until #826 Phase 6 publishes the catalogue (`validate-notices.cjs --md`), this points at a
 * tracker search for the code — which is a real, working page that lists every issue mentioning it.
 * Repoint `NOTICE_DOCS_BASE_URL` when the published catalogue exists; do not invent a URL for a
 * document that has not been written yet.
 */
export const NOTICE_DOCS_BASE_URL =
  process.env.NOTICE_DOCS_BASE_URL ?? 'https://github.com/FifeCIC/Trading-Command-Suite/issues?q=';

export function noticeDocsUrl(code: string): string {
  return `${NOTICE_DOCS_BASE_URL}${encodeURIComponent(code)}`;
}

/** Log level for a severity. An expected refusal must not shout like a crash. */
export function noticeLogLevel(severity: NoticeSeverity): 'error' | 'warn' | 'log' {
  if (severity === 'critical' || severity === 'error') return 'error';
  if (severity === 'warning') return 'warn';
  return 'log';
}
