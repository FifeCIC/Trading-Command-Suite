/**
 * APP_VERSION — single source of truth for the backend version string.
 *
 * Reads `nest/package.json` (the backend package) at runtime so the value
 * actually changes when the version is bumped — instead of the old hardcoded
 * `'0.1.0'` / `'nest-0.1.0'` literals that made the UI show a stale version
 * forever (the launcher runs `node dist/src/main.js` directly, so
 * `process.env.npm_package_version` is NOT populated and every runtime
 * fallback resolved to 0.1.0).
 *
 * Resolution order:
 *   1. `<process.cwd()>/package.json` — the launcher and npm scripts run with
 *      the working directory set to `nest/`, so this hits `nest/package.json`.
 *   2. `<__dirname>/../../package.json` — compiled output lives at
 *      `nest/dist/src/`, so two levels up is `nest/package.json`.
 *
 * ⚠️ AGENTS: keep `root package.json` and `nest/package.json` on the SAME
 * version. Bump both together on every handoff (see .github/instructions/
 * agent-handoff.instructions.md → "Project version"). This value is surfaced
 * at `GET /`, `GET /api/version`, and in Swagger docs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readVersion(base: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : null;
  } catch {
    return null;
  }
}

export const APP_VERSION: string =
  readVersion(process.cwd()) ?? readVersion(join(__dirname, '..', '..')) ?? '0.0.0';
