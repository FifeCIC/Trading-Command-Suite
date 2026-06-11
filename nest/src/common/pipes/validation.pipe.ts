/**
 * Logging Validation Pipe
 * ========================
 * Custom validation pipe built on top of NestJS's built-in ValidationPipe.
 * Adds:
 * - Warning-level logging of all validation failures
 * - Field-level error messages in the response body
 * - Structured error array: [{ field, errors: [messages] }]
 * - Preserves whitelist + forbidNonWhitelisted + transform behavior
 *
 * Usage: apply globally in main.ts or per-controller with @UsePipes()
 */

import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  Logger,
  PipeTransform,
  ValidationPipe as NestValidationPipe,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';

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
        return new BadRequestException({
          statusCode: 400,
          error: 'Validation Failed',
          errors: formatted,
        });
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
