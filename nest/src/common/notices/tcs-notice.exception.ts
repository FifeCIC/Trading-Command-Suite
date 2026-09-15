/**
 * TcsNoticeException — the one way the backend raises a *coded* failure.
 * =====================================================================
 * Created 2026-09-15 for #826 **Phase 1** (the server → client contract).
 *
 * THE RULE THIS CLASS ENFORCES
 * ----------------------------
 * A call site passes a CODE and DATA — never a sentence:
 *
 *     throw new TcsNoticeException('TCS-INTEG-001', { detail: 'bridge refused the connection' });
 *
 * The sentence exists exactly once, in `src/core/notices/registry.js`, where a translator can reach
 * it and where rewording cannot break the identity of the message. Before this class, 65 throw
 * sites across 52 files each invented their own wording, and the only way to reference a message
 * was to quote it — which meant fixing a typo orphaned every log line, test and issue that
 * mentioned it.
 *
 * WHY THE STATUS IS NOT A CONSTRUCTOR ARGUMENT BY DEFAULT
 * ------------------------------------------------------
 * The status belongs to the code (`TCS-INTEG-001` is always 503), not to the throw site. Deriving
 * it removes a decision that would otherwise be made differently in different files. It is
 * overridable for the rare case where the same condition legitimately maps to a different status.
 *
 * ⚠️ `params` carry DATA ONLY — a symbol, a count, a mode. Never pre-formatted prose, and never a
 * whole sentence for the client to display. That is what keeps translation possible (#826 Phase 6).
 */

import { HttpException } from '@nestjs/common';
import { isNoticeCode, serverNotice, type NoticeSeverity } from './notice-catalogue';

/** The third-party code being relayed, if any (MT5 retcode, MySQL errno, Trading212 code). */
export interface ExternalCode {
  system: string;
  code?: string | number;
  name?: string;
}

export interface TcsNoticeOptions {
  /** Override the catalogue status when this condition legitimately maps elsewhere. */
  httpStatus?: number;
  /**
   * The SPECIFICS — a field list, a broker's own sentence, a symbol. Shown to a human as the cause,
   * and the only place the underlying text is kept. Never the user-facing message.
   */
  detail?: string;
  /** Values for the registry's `{placeholders}`. Data, not prose. */
  params?: Record<string, unknown>;
  /** Relayed third-party code, so the broker's own identifier is not lost. */
  external?: ExternalCode;
  /**
   * Extra top-level response keys that existing consumers already read (e.g. the validation pipe's
   * `errors` array). Response-shape compatibility is deliberate here — see the filter.
   */
  extra?: Record<string, unknown>;
}

export class TcsNoticeException extends HttpException {
  /** The stable identity of this condition. Never reworded, never renumbered. */
  readonly code: string;
  readonly params: Record<string, unknown>;
  readonly severity: NoticeSeverity;
  readonly detail?: string;
  readonly external?: ExternalCode;
  /** The status this code resolves to, before any override. */
  readonly noticeHttpStatus: number;
  readonly extra?: Record<string, unknown>;

  constructor(code: string, params: Record<string, unknown> = {}, options: TcsNoticeOptions = {}) {
    const declared = serverNotice(code);
    const status = options.httpStatus ?? declared.httpStatus;

    // A deliberately minimal body: `NoticeExceptionFilter` is the ONE serialiser, so the shape of
    // an error response is defined in exactly one place rather than in every throw site.
    super({ code, params: options.params ?? params }, status);

    this.code = code;
    this.params = options.params ?? params;
    this.severity = declared.severity;
    this.detail = options.detail;
    this.external = options.external;
    this.noticeHttpStatus = declared.httpStatus;
    this.extra = options.extra;

    if (!isNoticeCode(code)) {
      // Anti-silence: the code is still carried, and this is logged rather than thrown away. The
      // build gate (`validate-notices.cjs`) is what stops it reaching a release; this only makes a
      // malformed code visible in a dev environment instead of producing a blank message.
      // eslint-disable-next-line no-console
      console.warn(`[notices] malformed notice code raised: ${code}`);
    }
  }
}
