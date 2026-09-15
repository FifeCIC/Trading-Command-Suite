/**
 * Logging Validation Pipe
 * ========================
 * Custom validation pipe built on top of NestJS's built-in ValidationPipe.
 * Adds:
 * - Warning-level logging of all validation failures
 * - Field-level error messages in the response body
 * - Structured error array: [{ field, errors: [messages] }]
 * - A stable notice code (`TCS-SYS-004`) so a rejected payload is identifiable — #826 Phase 1
 * - Preserves whitelist + forbidNonWhitelisted + transform behavior
 *
 * Usage: apply globally in main.ts or per-controller with @UsePipes()
 */

import {
  ArgumentMetadata,
  Injectable,
  Logger,
  PipeTransform,
  ValidationPipe as NestValidationPipe,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { TcsNoticeException } from '../notices/tcs-notice.exception';

@Injectable()
export class LoggingValidationPipe implements PipeTransform<any> {
  private readonly logger = new Logger('ValidationPipe');
  private readonly nestPipe: NestValidationPipe;

  constructor() {
    this.nestPipe = new NestValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const formatted = this.formatErrors(errors);
        this.logger.warn(
          `Validation failed — ${formatted.length} field(s) rejected\n${JSON.stringify(formatted, null, 2)}`,
        );
        // ⚠️ A rejected payload is a CODED condition, not prose (#826 Phase 1). The field list is
        // DATA — the registry renders the sentence — and `errors` is kept verbatim because it is
        // the only thing that says *why* each field failed, which no single code can carry.
        const fields = formatted.map((f) => f.field);
        const summary = fields.join(', ') || 'none reported';
        return new TcsNoticeException(
          'TCS-SYS-004',
          { count: formatted.length, fields: summary },
          {
            httpStatus: 400,
            detail: `Validation failed — ${formatted.length} field(s) rejected: ${summary}`,
            extra: { error: 'Validation Failed', errors: formatted },
          },
        );
      },
    });
  }

  async transform(value: any, metadata: ArgumentMetadata): Promise<any> {
    return this.nestPipe.transform(value, metadata);
  }

  /**
   * Convert NestJS ValidationError array into a clean field-level format.
   */
  private formatErrors(
    errors: ValidationError[],
  ): Array<{ field: string; errors: string[] }> {
    const result: Array<{ field: string; errors: string[] }> = [];

    for (const err of errors) {
      this.flattenError(err, '', result);
    }

    return result;
  }

  /**
   * Recursively flatten nested validation errors (for nested objects/arrays).
   */
  private flattenError(
    err: ValidationError,
    prefix: string,
    result: Array<{ field: string; errors: string[] }>,
  ): void {
    const fieldPath = prefix ? `${prefix}.${err.property}` : err.property;
    const messages: string[] = [];

    if (err.constraints) {
      for (const [, message] of Object.entries(err.constraints)) {
        messages.push(message);
      }
    }

    if (messages.length > 0) {
      result.push({ field: fieldPath, errors: messages });
    }

    if (err.children && err.children.length > 0) {
      for (const child of err.children) {
        this.flattenError(child, fieldPath, result);
      }
    }
  }
}
