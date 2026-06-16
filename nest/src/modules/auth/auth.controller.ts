import { Controller, Post, Get, Delete, Body, Param, Req, UseGuards, Logger } from '@nestjs/common';
import { AuthService, User } from './auth.service';

// ── Guards ──────────────────────────────────────────────────

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return false;
    const token = auth.slice(7);
    const authService = (global as any).__authService as AuthService;
    const user = authService?.verifyToken(token);
    if (!user) return false;
    (req as any).user = user;
    return true;
  }
}

// Set service reference for guard access
export function setAuthServiceRef(service: AuthService): void {
  (global as any).__authService = service;
}

// ── Controller ──────────────────────────────────────────────

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {
    setAuthServiceRef(authService);
  }

  @Post('login')
  async login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  @Post('register')
  async register(@Body() body: { username: string; password: string }) {
    return this.authService.register(body.username, body.password);
  }

  @Post('api-keys')
  async createApiKey(@Body() body: { label: string }, @Req() req: any) {
    const user = req.user || { id: 'admin' };
    const key = await this.authService.createApiKey(user.id, body.label || 'default');
    return { key, label: body.label };
  }

  @Get('api-keys')
  async listApiKeys(@Req() req: any) {
    const user = req.user || { id: 'admin' };
    return this.authService.getApiKeys(user.id);
  }

  @Delete('api-keys/:key')
  async revokeApiKey(@Param('key') key: string) {
    return { revoked: this.authService.revokeApiKey(key) };
  }

  @Get('me')
  async me(@Req() req: any) {
    return req.user || { id: 'anonymous', username: 'anonymous', role: 'guest' };
  }
}
