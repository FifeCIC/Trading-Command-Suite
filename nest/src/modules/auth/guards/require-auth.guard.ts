import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';

/**
 * Env-gated authentication guard.
 *
 * When REQUIRE_API_AUTH=true, this guard behaves exactly like JwtAuthGuard:
 * it requires a valid `Authorization: Bearer <token>` header on every request.
 *
 * When REQUIRE_API_AUTH is unset/false (the default — local development), the
 * guard passes all requests through so the unauthenticated dev frontend keeps
 * working. Set REQUIRE_API_AUTH=true in the environment to enforce auth on the
 * trading/automation control endpoints.
 */
@Injectable()
export class RequireAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.REQUIRE_API_AUTH !== 'true') {
      return true; // Auth enforcement disabled — allow through (dev mode)
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format — use Bearer <token>');
    }

    const user = await this.authService.verifyToken(token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = user;
    return true;
  }
}
