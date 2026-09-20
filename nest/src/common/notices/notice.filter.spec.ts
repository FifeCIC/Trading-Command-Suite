/**
 * notice.filter.spec.ts — the Phase 1 contract, machine-checked.
 * =============================================================
 * Created 2026-09-15 for #826.
 *
 * WHAT THIS PROVES, AND WHY IT IS A TEST RATHER THAN A ONE-OFF CHECK
 * -----------------------------------------------------------------
 * The value of this filter is entirely in the MAPPING — "what was thrown" → "which code, which
 * status, which params". A mapping is exactly the kind of logic that looks right in review and is
 * wrong in one branch, and the failure is silent: the user still sees *an* error, just without a
 * code, or with the wrong one. So every branch of the decision table is asserted here.
 *
 * The two properties most worth guarding:
 *
 *   1. **Never blank.** Every branch must produce a non-empty message and a code. A blank error is
 *      the original defect (#824: "Unsupported filling mode" told the user nothing).
 *   2. **Never re-classify a code that a lower layer already set.** The MT5 adapter attaches the
 *      broker's own code; wrapping it in a generic SYS code would throw away the broker's retcode.
 */

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  RequestTimeoutException,
} from '@nestjs/common';
import { describeException } from './notice.filter';
import { TcsNoticeException } from './tcs-notice.exception';
import { noticeDocsUrl, noticeLogLevel, serverNotice } from './notice-catalogue';

describe('describeException — the server → client notice contract (#826 Phase 1)', () => {
  /** Every branch must satisfy this. It is the anti-silence rule, asserted rather than promised. */
  const neverBlank = (report: ReturnType<typeof describeException>) => {
    expect(report.code).toMatch(/^TCS-[A-Z]{2,6}-\d{3}$/);
    expect(typeof report.body.message).toBe('string');
    expect((report.body.message as string).length).toBeGreaterThan(0);
    expect(report.detail.length).toBeGreaterThan(0);
    expect(report.body.docsUrl).toContain(report.code);
    expect(report.statusCode).toBeGreaterThanOrEqual(200);
  };

  it('carries a coded throw through unchanged, with its params intact', () => {
    const report = describeException(new TcsNoticeException('TCS-INTEG-001', { detail: 'bridge refused' }));

    expect(report.code).toBe('TCS-INTEG-001');
    expect(report.statusCode).toBe(503); // status comes from the CODE, not the throw site
    expect(report.severity).toBe('critical');
    expect(report.body.params).toEqual({ detail: 'bridge refused' });
    neverBlank(report);
  });

  it('lets a throw site override the status without changing the code', () => {
    const report = describeException(
      new TcsNoticeException('TCS-INTEG-001', {}, { httpStatus: 409, detail: 'already subscribed' }),
    );

    expect(report.code).toBe('TCS-INTEG-001');
    expect(report.statusCode).toBe(409);
    neverBlank(report);
  });

  it('passes through a code a lower layer already attached — never re-classifying it', () => {
    // This is the MT5 refusal path: the broker's own code must survive the filter.
    const report = describeException(
      new HttpException(
        {
          code: 'TCS-TRADE-001',
          params: { symbol: 'XAGUSD', mode: 'FOK' },
          message: 'Unsupported filling mode',
          external: { system: 'MetaTrader 5', code: 10030, name: 'TRADE_RETCODE_INVALID_FILL' },
        },
        400,
      ),
    );

    expect(report.code).toBe('TCS-TRADE-001');
    expect(report.statusCode).toBe(400);
    expect(report.body.params).toEqual({ symbol: 'XAGUSD', mode: 'FOK' });
    expect(report.body.message).toBe('Unsupported filling mode'); // the specifics survive
    expect(report.body.external).toEqual({
      system: 'MetaTrader 5',
      code: 10030,
      name: 'TRADE_RETCODE_INVALID_FILL',
    });
    neverBlank(report);
  });

  it('classifies a validation failure by SHAPE, so legacy throw sites are covered', () => {
    const errors = [
      { field: 'volume', errors: ['volume must be a positive number'] },
      { field: 'symbol', errors: ['symbol should not be empty'] },
    ];
    const report = describeException(new BadRequestException({ errors }));

    expect(report.code).toBe('TCS-SYS-004');
    expect(report.statusCode).toBe(400);
    expect(report.body.params).toEqual({ count: 2, fields: 'volume, symbol' });
    // The per-field reasons are the only thing a single code cannot carry — they must survive.
    expect(report.body.errors).toEqual(errors);
    expect(report.body.error).toBe('Validation Failed');
    neverBlank(report);
  });

  it('summarises a long field list instead of pasting all of it', () => {
    const errors = Array.from({ length: 9 }, (_, i) => ({ field: `f${i}`, errors: ['bad'] }));
    const report = describeException(new BadRequestException({ errors }));

    expect(report.body.params).toEqual({ count: 9, fields: 'f0, f1, f2, f3, f4 and 4 more' });
    neverBlank(report);
  });

  it('separates the server deadline (504) from a generic failure', () => {
    const report = describeException(new RequestTimeoutException('Request timed out'));

    expect(report.code).toBe('TCS-SYS-005');
    expect(report.statusCode).toBe(504);
    expect(report.body.params).toEqual({ seconds: 30 });
    neverBlank(report);
  });

  it('keeps the HTTP status as a param when the code only identifies the class', () => {
    const report = describeException(new NotFoundException('Strategy not found'));

    expect(report.code).toBe('TCS-SYS-002');
    expect(report.statusCode).toBe(404);
    expect(report.body.params).toEqual({ status: 404, detail: 'Strategy not found' });
    expect(report.body.message).toBe('Strategy not found');
    expect(report.body.error).toBe('Not Found');
    neverBlank(report);
  });

  it('still produces a code and a status when the exception carries no message at all', () => {
    const report = describeException(new ForbiddenException());

    expect(report.code).toBe('TCS-SYS-002');
    expect(report.statusCode).toBe(403);
    neverBlank(report);
  });

  it('treats a non-HTTP throw as a bug (SYS-006) and does NOT send the stack', () => {
    const report = describeException(new TypeError('x is not a function'));

    expect(report.code).toBe('TCS-SYS-006');
    expect(report.statusCode).toBe(500);
    expect(report.body.message).toBe('x is not a function');
    expect(report.stack).toContain('TypeError'); // logged, never serialised
    expect(report.body.stack).toBeUndefined();
    neverBlank(report);
  });

  it('survives a non-Error being thrown', () => {
    const report = describeException('just a string');
    expect(report.code).toBe('TCS-SYS-006');
    neverBlank(report);
  });

  it('gives a registry code the server catalogue does not declare a usable default rather than blanking it', () => {
    // A code can be legitimate (DATA-001 is registered) while having no HTTP status declared for it.
    // The report must still be usable: never blank, never code-less.
    //
    // ⚠️ Do NOT switch this back to RISK-001. It was the example here until 2026-09-20, when it was
    // declared in SERVER_NOTICES (400) because `SignalActionsService` now raises it — so it no longer
    // exercises the undeclared path, and using it made this test assert the fallback's 500 against a
    // code that has a real status. The positive case is covered separately below.
    const report = describeException(new TcsNoticeException('TCS-DATA-001', { reason: 'gate tripped' }));

    expect(report.code).toBe('TCS-DATA-001');
    expect(report.body.message).toContain('TCS-DATA-001');
    expect(report.statusCode).toBe(500);
    neverBlank(report);
  });

  it('uses the DECLARED status for a code the catalogue carries — RISK-001 is 400, not the 500 fallback', () => {
    // Guards the 2026-09-20 declaration: a feasibility refusal is client-actionable, so if this
    // ever regresses to the undeclared fallback (500) the operator is told "server fault" for a
    // condition they can fix themselves.
    const report = describeException(new TcsNoticeException('TCS-RISK-001', { reason: 'gate tripped' }));

    expect(report.code).toBe('TCS-RISK-001');
    expect(report.statusCode).toBe(400);
    neverBlank(report);
  });

  it('drops undefined extras instead of emitting undefined keys', () => {
    // `error: undefined` (a 500 with no Nest `error` string) must not appear as a key in JSON.
    const report = describeException(new HttpException({ message: 'boom' }, 500));
    expect(Object.keys(report.body)).not.toContain('error');
  });
});

describe('notice catalogue helpers', () => {
  it('maps severity to a log level so an expected refusal does not shout like a crash', () => {
    expect(noticeLogLevel('critical')).toBe('error');
    expect(noticeLogLevel('error')).toBe('error');
    expect(noticeLogLevel('warning')).toBe('warn');
    expect(noticeLogLevel('info')).toBe('log');
    expect(noticeLogLevel('success')).toBe('log');
  });

  it('gives an unknown code a usable default rather than undefined', () => {
    expect(serverNotice('NOT-A-CODE').httpStatus).toBe(500);
    expect(serverNotice('NOT-A-CODE').label).toContain('NOT-A-CODE');
  });

  it('builds a per-code reference link', () => {
    expect(noticeDocsUrl('TCS-SYS-004')).toContain('TCS-SYS-004');
  });
});
