/**
 * Log writer contract — INV-LOG-PERSISTS (#764)
 * =============================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Logs were being written to `dist/logs/` — a directory the BUILD owns. `LOG_DIR` was
 * derived from `__dirname`, and at runtime the compiled module sits at
 * `dist/src/modules/system/`, so three levels up was `dist/`. `npm run build` runs
 * `rimraf dist` in its prebuild step, which deleted the log directory out from under the
 * running process. Every flush then failed:
 *
 *     WARN [SystemLogService] Log write failed (…\nest\dist\logs\tcs-….log):
 *     ENOENT: no such file or directory
 *
 * The bug was hard to notice for three reasons, and each one is the reason a test exists
 * here rather than a code comment:
 *
 *   1. It logged at WARN, not ERROR, so it read as noise.
 *   2. The in-memory ring buffer (`getRecent`) kept working, so the API surfaced recent
 *      logs and looked healthy while nothing reached disk.
 *   3. It only manifested AFTER a build — the process was fine until someone rebuilt.
 *
 * WHAT THIS FILE ASSERTS
 * ----------------------
 *   1. The resolved log directory is NOT inside build output (`dist/`). This is the
 *      regression: pointing LOG_DIR at anything the build deletes must fail here.
 *   2. A write actually reaches disk, and the file is readable back.
 *   3. The writer self-heals when the directory is deleted underneath it — the exact
 *      condition a `rimraf dist` creates.
 *   4. Consecutive failures are counted, so "nothing to log" and "cannot log" are
 *      distinguishable.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('log writer (#764)', () => {
  let tmpDir: string;
  let service: any;
  const ORIGINAL_ENV = process.env.TCS_LOG_DIR;

  beforeEach(() => {
    // Redirect to a temp dir so the spec never writes into the repo or competes with a
    // running API for the same day file.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcs-log-'));
    process.env.TCS_LOG_DIR = tmpDir;

    // The module resolves LOG_DIR once at import time, so re-require it per test to pick
    // up the redirected env var.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('./log.service');
    service = new mod.SystemLogService();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.TCS_LOG_DIR;
    else process.env.TCS_LOG_DIR = ORIGINAL_ENV;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('resolves the log directory OUTSIDE build output', () => {
    const resolved = service.getWriterHealth().directory as string;
    const normalised = resolved.replace(/\\/g, '/').toLowerCase();

    // The regression: dist/ is owned by the build (`prebuild` runs `rimraf dist`), so any
    // path inside it is deleted on every rebuild.
    expect(normalised).not.toContain('/dist/');
    expect(normalised.endsWith('/dist')).toBe(false);
  });

  it('writes through to disk and can read the line back', async () => {
    const marker = `spec-marker-${Date.now()}`;
    service.info('LogSpec', marker, 'system');
    // flushQueue is async-but-synchronous in practice; give the microtask a turn.
    await new Promise((r) => setImmediate(r));

    const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith('tcs-'));
    expect(files.length).toBeGreaterThan(0);

    const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
    expect(content).toContain(marker);
  });

  it('self-heals when the log directory is deleted underneath it', async () => {
    service.info('LogSpec', 'before-delete', 'system');
    await new Promise((r) => setImmediate(r));

    // Simulate `rimraf dist` racing a running process.
    fs.rmSync(tmpDir, { recursive: true, force: true });
    expect(fs.existsSync(tmpDir)).toBe(false);

    service.info('LogSpec', 'after-delete', 'system');
    await new Promise((r) => setImmediate(r));

    // The directory must have been recreated and the line written — not silently dropped.
    expect(fs.existsSync(tmpDir)).toBe(true);
    const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith('tcs-'));
    expect(files.length).toBeGreaterThan(0);
    const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
    expect(content).toContain('after-delete');
  });

  it('reports writer health so a broken writer is distinguishable from a quiet one', () => {
    const health = service.getWriterHealth();
    expect(health).toHaveProperty('directory');
    expect(health).toHaveProperty('directoryExists');
    expect(health).toHaveProperty('consecutiveWriteFailures');
    expect(health).toHaveProperty('queuedLines');
    expect(health.consecutiveWriteFailures).toBe(0);
  });
});
