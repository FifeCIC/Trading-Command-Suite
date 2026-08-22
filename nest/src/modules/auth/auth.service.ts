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
      this.users.set(this.adminUser, { password: this.hashPassword(this.adminPass), role: 'admin' });
      this.logger.log(`Admin user auto-created: ${this.adminUser}`);
    }
  }

  /** Hash a password with a per-user random salt (scrypt) — never store plaintext. */
  private hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  /** Constant-time comparison of a candidate password against a stored salt:hash. */
  private verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  }

  async validateUser(username: string, password: string): Promise<User | null> {
    const user = this.users.get(username);
    if (!user || !this.verifyPassword(password, user.password)) return null;
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
    this.users.set(username, { password: this.hashPassword(password), role: 'user' });
    return { id: username, username, role: 'user' };
  }

  verifyToken(token: string): User | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [headerB64, payloadB64, signature] = parts;
      // Verify HMAC-SHA256 signature before trusting any payload field.
      const expected = crypto.createHmac('sha256', this.jwtSecret).update(`${headerB64}.${payloadB64}`).digest('base64url');
      const sigBuf = Buffer.from(signature, 'base64url');
      const expBuf = Buffer.from(expected, 'base64url');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
      const user = this.users.get(payload.sub);
      if (!user) return null;
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
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: user.username,
      role: user.role,
      iat: now,
      exp: now + 7 * 24 * 60 * 60, // 7 days
    })).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const signature = crypto.createHmac('sha256', this.jwtSecret).update(signingInput).digest('base64url');
    return `${signingInput}.${signature}`;
  }
}
