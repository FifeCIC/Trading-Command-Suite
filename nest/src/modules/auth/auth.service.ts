import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret = process.env.JWT_SECRET || 'tcs-dev-secret-change-in-production';
  private readonly adminUser = process.env.ADMIN_USERNAME || 'admin';
  private readonly adminPass = process.env.ADMIN_PASSWORD || 'admin';

  // In-memory store (MVP) — replace with DB in production
  private readonly users: Map<string, { password: string; role: string }> = new Map();
  private readonly apiKeys: Map<string, { userId: string; label: string }> = new Map();

  constructor() {
    // Auto-create admin on first start
    if (!this.users.has(this.adminUser)) {
      this.users.set(this.adminUser, { password: this.adminPass, role: 'admin' });
      this.logger.log(`Admin user auto-created: ${this.adminUser}`);
    }
  }

  async validateUser(username: string, password: string): Promise<User | null> {
    const user = this.users.get(username);
    if (!user || user.password !== password) return null;
    return { id: username, username, role: user.role as 'admin' | 'user' };
  }

  async login(username: string, password: string): Promise<{ token: string; user: User }> {
    const user = await this.validateUser(username, password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const token = this.signToken(user);
    return { token, user };
  }

  async register(username: string, password: string): Promise<User> {
    if (this.users.has(username)) throw new UnauthorizedException('User already exists');
    this.users.set(username, { password, role: 'user' });
    return { id: username, username, role: 'user' };
  }

  verifyToken(token: string): User | null {
    try {
      const payload = JSON.parse(Buffer.from(token, 'base64').toString());
      const user = this.users.get(payload.sub);
      if (!user || payload.exp < Date.now()) return null;
      return { id: payload.sub, username: payload.sub, role: user.role as 'admin' | 'user' };
    } catch { return null; }
  }

  async createApiKey(userId: string, label: string): Promise<string> {
    const key = `tcs_${crypto.randomBytes(24).toString('hex')}`;
    this.apiKeys.set(key, { userId, label });
    return key;
  }

  getApiKeys(userId: string): Array<{ key: string; label: string }> {
    const result: Array<{ key: string; label: string }> = [];
    for (const [key, val] of this.apiKeys) {
      if (val.userId === userId) result.push({ key: key.substring(0, 12) + '...', label: val.label });
    }
    return result;
  }

  revokeApiKey(key: string): boolean {
    return this.apiKeys.delete(key);
  }

  validateApiKey(key: string): User | null {
    const entry = this.apiKeys.get(key);
    if (!entry) return null;
    return { id: entry.userId, username: entry.userId, role: 'user' };
  }

  private signToken(user: User): string {
    const payload = { sub: user.username, role: user.role, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }
}
