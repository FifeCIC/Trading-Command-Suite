/**
 * NoticeExceptionFilter — the ONE serialiser for every error the API returns.
 * ========================================================================
 * Created 2026-09-15 for #826 **Phase 1** (the server → client contract).
 *
 * WHAT IT DOES
 * ------------
 * Turns any thrown value into a response body carrying a **stable code**:
 * * This is STRUCTURED OUTPUT applied to failures: instead of a prose sentence that a caller has to
 * interpret (and that no two callers interpret the same way), the API answers in a fixed schema —
 * `{ code, params }` — and the client renders the wording. The same pattern the AI literature uses to
 * make a model's answer machine-actionable is what makes an error machine-actionable here, and for the
 * same reason: prose has to be parsed by guesswork, a schema does not.
 * *     { statusCode, code, severity, message, detail, docsUrl, params, error?, errors? }
 *
 * and writes a log line that the same code can be found by, so a user's screenshot and the server
 * log can be joined:
 *
 *     [TCS-SYS-004] Request rejected before it ran — 2 field(s) rejected: volume, symbol (POST /api/x → 400)
 *
 * WHY `message` IS NOT THE USER-FACING SENTENCE
 * ---------------------------------------------
 * `message` keeps the SPECIFICS (the underlying exception text, preserved exactly as it was before
 * this filter existed). `code` carries the identity. The client renders the sentence from its own
 * registry — which is what makes translation possible, and what stops a raw JSON consumer from
 * being told a generic sentence in place of the actual reason.
 *
 * RESPONSE SHAPE — ADDITIVE, AND THAT IS DELIBERATE
 * ------------------------------------------------
 * Existing consumers keep working: `statusCode`, `message`, `error` and the validation pipe's
 * `errors` array are all still present and unchanged. Adding `code`/`severity`/`params`/`docsUrl`
 * means a caller can start using the code without a flag day, and `src/core/api/client.js` already
 * reads `payload.code` when present (#826 Phase 2 wired the receiving end first).
 *
 * ⚠️ THE ONE THING THAT MUST NEVER HAPPEN: A BLANK OR CODE-LESS ERROR. Every branch below ends with
 * a code and a non-empty message. An undeclared code is sent as-is and named in the text, because a
 * user reporting that exact string is useful and a user reporting nothing is not.
 *
 * ⚠️ THE STACK IS NOT SENT. It is logged for genuinely unexpected failures only. A known condition
 * an expected refusal, a validation rejection — is not an exception in the alarming sense, and
 * logging a stack for it trains everyone to ignore stacks.
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  isNoticeCode,
  noticeDocsUrl,
  noticeLogLevel,
  serverNotice,
  type NoticeSeverity,
} from './notice-catalogue';
import { TcsNoticeException } from './tcs-notice.exception';

/** What the filter needs to log and to answer with. Pure data — no Express objects. */
export interface NoticeReport {
  statusCode: number;
  code: string;
  severity: NoticeSeverity;
  label: string;
  /** The specifics, for the log line and the body's `message`. Never empty. */
  detail: string;
  body: Record<string, unknown>;
  /** Present only for genuinely unexpected failures. */
  stack?: string;
}

/** How many field names to name in `message` before summarising. Keeps one bad request readable. */
const MAX_FIELDS_NAMED = 5;

/**
 * Extract the field names from a class-validator shaped `errors` array
 * (`[{ field, errors: [messages] }]`, as produced by `LoggingValidationPipe`).
 */
function fieldPaths(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  return errors
    .map((e) => (e as { field?: unknown })?.field)
    .filter((f): f is string => typeof f === 'string' && f.length > 0);
}

function summariseFields(fields: string[]): string {
  const named = fields.slice(0, MAX_FIELDS_NAMED).join(', ');
  return fields.length > MAX_FIELDS_NAMED
    ? `${named} and ${fields.length - MAX_FIELDS_NAMED} more`
    : named;
}

/**
 * Pull a human string out of whatever an HttpException was constructed with.
 * Nest allows `string`, `{ message }`, `{ message: string[], error }` — all three are in use here.
 */
function messageOf(response: unknown): string {
  if (typeof response === 'string') return response;
  const msg = (response as { message?: unknown } | null)?.message;
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg) && msg.length) return msg.map(String).join('; ');
  const err = (response as { error?: unknown } | null)?.error;
  return typeof err === 'string' ? err : '';
}

/**
 * classifyException() — the whole decision table, as a pure function.
 *
 * Pure so it can be unit-tested without an HTTP server, and so the mapping from "what was thrown"
 * to "which code" is readable in one place instead of emerging from the filter's control flow.
 */
export function describeException(exception: unknown): NoticeReport {
  // ── 1. A coded throw (`new TcsNoticeException('TCS-INTEG-001', {...})`) ──────────────
  if (exception instanceof TcsNoticeException) {
    const declared = serverNotice(exception.code);
    const detail = exception.detail ?? '';
    return finish({
      statusCode: exception.getStatus(),
      code: exception.code,
      severity: exception.severity,
      label: declared.label,
      params: exception.params,
      detail,
      // `message` is the specifics when there are any, otherwise the code's label. Never blank.
      message: detail || declared.label,
      extra: exception.extra,
      external: exception.external,
    });
  }

  // ── 2. An HttpException, which may already carry a code from a lower layer ──────────
  //    The MT5 adapter and the signal-actions service attach `{ code, params, external }` to a
  //    refusal; those arrive here as a plain HttpException body and must NOT be re-classified,
  //    or the broker's own retcode would be replaced by a generic SYS code.
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const asObject = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};
    const carriedCode = asObject.code;

    if (isNoticeCode(carriedCode)) {
      const declared = serverNotice(carriedCode);
      const detail = messageOf(response) || (typeof asObject.detail === 'string' ? asObject.detail : '');
      return finish({
        statusCode: status,
        code: carriedCode,
        severity: declared.severity,
        label: declared.label,
        params: (asObject.params as Record<string, unknown>) ?? {},
        detail,
        message: detail || declared.label,
        // Preserve whatever else the lower layer attached (retcode, status string, ...).
        extra: pruneExtra(asObject),
        external: asObject.external as never,
      });
    }

    // 2a. Validation shaped: a 400 carrying an `errors` array. Classified by SHAPE, not by prose,
    //     so legacy `throw new BadRequestException({ errors })` sites are covered without edits.
    if (Array.isArray(asObject.errors)) {
      const fields = fieldPaths(asObject.errors);
      const declared = serverNotice('TCS-SYS-004');
      const detail = `${fields.length || asObject.errors.length} field(s) rejected${fields.length ? `: ${summariseFields(fields)}` : ''}`;
      return finish({
        statusCode: 400,
        code: 'TCS-SYS-004',
        severity: declared.severity,
        label: declared.label,
        params: { count: fields.length || asObject.errors.length, fields: summariseFields(fields) },
        detail,
        message: detail,
        extra: { error: 'Validation Failed', errors: asObject.errors },
      });
    }

    // 2b. The API's own deadline (TimeoutInterceptor) — distinct from a client-side timeout, which
    //     has no HTTP status at all and is SYS-003 in the registry (named without its prefix: the
    //     gate counts any TCS literal here as backend-emitted, and the server never throws that one).
    //     ⚠️ 408 is accepted as well as 504 because Nest's `RequestTimeoutException` is 408, and the
    //     interceptor used it (while documenting 504) until #826 Phase 1 exposed the mismatch. If it
    //     ever comes back, the deadline must still classify here rather than degrade to SYS-002.
    if (status === 504 || status === 408) {
      const declared = serverNotice('TCS-SYS-005');
      return finish({
        // Normalised to 504 for both: the meaning is always "the server gave up on its own work",
        // and emitting 408 sometimes and 504 otherwise would make the code's meaning depend on which
        // exception class happened to be thrown.
        statusCode: 504,
        code: 'TCS-SYS-005',
        severity: declared.severity,
        label: declared.label,
        params: { seconds: 30 },
        detail: messageOf(response) || 'The API abandoned the request after 30s',
        message: messageOf(response) || 'The API abandoned the request after 30s',
        extra: {},
      });
    }

    // 2c. A deliberate HTTP failure with no code of its own. `status` is a param because the code
    //     identifies the CLASS ("the request failed") and the status narrows it.
    const declared = serverNotice('TCS-SYS-002');
    const detail = messageOf(response);
    return finish({
      statusCode: status,
      code: 'TCS-SYS-002',
      severity: declared.severity,
      label: declared.label,
      params: { status, detail },
      detail,
      message: detail || declared.label,
      // `error` ("Not Found") is a Nest convention consumers may read; keep it.
      extra: { error: typeof asObject.error === 'string' ? asObject.error : undefined },
    });
  }

  // ── 3. Anything else: a bug. Pre-launch this is a single-machine app, so the message is sent
  //    (it is the fastest route to a diagnosis) but the STACK is not.
  const declared = serverNotice('TCS-SYS-006');
  const err = exception as { message?: unknown; stack?: unknown };
  const detail =
    typeof err?.message === 'string' && err.message ? err.message : String(exception ?? 'unknown error');
  return finish({
    statusCode: 500,
    code: 'TCS-SYS-006',
    severity: declared.severity,
    label: declared.label,
    params: { status: 500, detail },
    detail,
    message: detail,
    extra: {},
    stack: typeof err?.stack === 'string' ? err.stack : undefined,
  });
}

/** Assemble the final body. One place, so the shape cannot drift between branches. */
function finish(input: {
  statusCode: number;
  code: string;
  severity: NoticeSeverity;
  label: string;
  params: Record<string, unknown>;
  detail: string;
  message: string;
  extra?: Record<string, unknown>;
  external?: { system: string; code?: string | number; name?: string };
  stack?: string;
}): NoticeReport {
  const body: Record<string, unknown> = { statusCode: input.statusCode };

  // Existing consumers read these first — keep the historical order and keys.
  if (input.extra) {
    for (const [k, v] of Object.entries(input.extra)) {
      if (v !== undefined) body[k] = v;
    }
  }

  body.code = input.code;
  body.severity = input.severity;
  body.message = input.message;
  if (input.detail) body.detail = input.detail;
  body.docsUrl = noticeDocsUrl(input.code);
  body.params = input.params;
  if (input.external) body.external = input.external;

  return {
    statusCode: input.statusCode,
    code: input.code,
    severity: input.severity,
    label: input.label,
    detail: input.message,
    body,
    stack: input.stack,
  };
}

/** Everything on a lower layer's body except the notice fields, which are re-emitted canonically. */
function pruneExtra(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (['code', 'params', 'detail', 'message', 'docsUrl', 'severity', 'external'].includes(k)) continue;
    out[k] = v;
  }
  return out;
}

@Catch()
export class NoticeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Notice');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const report = describeException(exception);
    const route = `${request?.method ?? '?'} ${(request?.originalUrl ?? '').split('?')[0] || '/'}`;
    const line = `[${report.code}] ${report.label} — ${report.detail} (${route} → ${report.statusCode})`;

    const level = noticeLogLevel(report.severity);
    if (level === 'error') this.logger.error(report.stack ? `${line}\n${report.stack}` : line);
    else if (level === 'warn') this.logger.warn(line);
    else this.logger.log(line);

    if (report.stack && report.severity !== 'error') this.logger.error(`${report.code} stack:\n${report.stack}`);

    // A response already in flight (e.g. a streaming endpoint threw after writing) cannot be
    // re-stamped — say so rather than throwing a second, more confusing error.
    if (response.headersSent) {
      this.logger.warn(`${report.code} after headers were sent — the client keeps the partial response`);
      return;
    }

    response.status(report.statusCode).json(report.body);
  }
}
