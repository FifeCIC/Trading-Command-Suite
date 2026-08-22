import { Controller, Post, Get, Delete, Body, Param, Req, UseGuards, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

// ── Controller ──────────────────────────────────────────────

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  /** Registration is restricted — requires an existing authenticated user.
   *  Prevents anonymous account creation (was previously unguarded). */
  @Post('register')
  @UseGuards(JwtAuthGuard)
  async register(@Body() body: { username: string; password: string }) {
    return this.authService.register(body.username, body.password);
  }

  @Post('api-keys')
  @UseGuards(JwtAuthGuard)
  async createApiKey(@Body() body: { label: string }, @Req() req: any) {
    const user = req.user;
    const key = await this.authService.createApiKey(user.id, body.label || 'default');
    return { key, label: body.label };
  }

  @Get('api-keys')
  @UseGuards(JwtAuthGuard)
  async listApiKeys(@Req() req: any) {
    const user = req.user;
    return this.authService.getApiKeys(user.id);
  }

  @Delete('api-keys/:key')
  @UseGuards(JwtAuthGuard)
  async revokeApiKey(@Param('key') key: string) {
    return { revoked: this.authService.revokeApiKey(key) };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: any) {
    return req.user;
  }
}
