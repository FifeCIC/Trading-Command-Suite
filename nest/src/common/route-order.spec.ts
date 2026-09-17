import * as fs from 'fs';
import * as path from 'path';

/**
 * route-order.spec.ts — a literal route must not be declared after a parameterised one.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE DEFECT (happened TWICE, seven weeks apart, in the same file)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Express (and Nest, which maps in declaration order) matches routes in the order they are
 * registered. So in a controller with `@Get(':id')`:
 *
 *     @Get(':id')       →  GET /api/trading/strategies/risk-limits  → findOne('risk-limits')
 *     @Get('risk-limits')
 *
 * …the literal route is **unreachable**. `findOne('risk-limits')` finds no strategy with that id and
 * returns `null`, which Nest serialises as HTTP **200 with an empty body**. No 404, no error, no log.
 *
 * Measured instances:
 *
 *   | Route                          | When      | Symptom                                                |
 *   |--------------------------------|-----------|--------------------------------------------------------|
 *   | `GET .../strategies/risk-limits` | 2026-09-16 | Settings' "Server-Enforced Hard Limits" panel never rendered |
 *   | `GET .../strategies/bot-rules`   | 2026-09-17 | `status=200`, `body length=0`, `counts=null`            |
 *
 * ⚠️ The second instance was written **directly underneath a comment warning about the first** —
 * and the route was even given a fresh comment repeating the warning. That is the point of this
 * file: **a comment is not a guard.** A rule that lives only in prose is indistinguishable from a
 * rule that does not exist (development-philosophy §6), and this is the second data point.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Within one controller and one HTTP method, if route A is declared **before** route B, A shadows B
 * when they have the same number of path segments and every segment of A either equals B's segment
 * or is a parameter (`:x`). Parameterised routes must therefore come LAST.
 *
 * Checked statically across every `*.controller.ts` — closes the class rather than the instance.
 */
describe('controller route order — literal routes must precede parameterised ones', () => {
  const MODULES_DIR = path.resolve(__dirname, '..', 'modules');

  interface Route {
    method: string;
    routePath: string;
    line: number;
    decorator: string;
  }

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith('.controller.ts')) out.push(full);
    }
    return out;
  }

  /**
   * Blank out comments while PRESERVING character offsets, so reported line numbers stay true.
   *
   * ⚠️ Required. Without this the scanner matched `@Get(':id')` INSIDE the warning comment above
   * `risk-limits` and reported a false positive on a route that demonstrably works — and the first
   * run of this guard produced 12 findings, most of them comment artefacts. A guard that cries wolf
   * gets allowlisted, and an allowlisted guard is worse than none. Caught by checking one finding
   * (`risk-limits`) against known-good behaviour instead of trusting the output.
   */
  function stripComments(src: string): string {
    const blank = (m: string) => m.replace(/[^\n]/g, ' ');
    return src
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
  }

  /** `@Get('a/:b')` → { method: 'GET', routePath: 'a/:b' } */
  function readRoutes(rawSrc: string): Route[] {
    const src = stripComments(rawSrc);
    const routes: Route[] = [];
    const re = /@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const routePath = (m[2] ?? m[3] ?? m[4] ?? '').trim();
      const line = src.slice(0, m.index).split('\n').length;
      routes.push({ method: m[1].toUpperCase(), routePath, line, decorator: `@${m[1]}('${routePath}')` });
    }
    return routes;
  }

  /** Does `a` shadow `b`? Same method, same segment count, a's segments literal-equal or params. */
  function shadows(a: Route, b: Route): boolean {
    if (a.method !== b.method) return false;
    if (a.routePath === b.routePath) return false;
    const as = a.routePath.split('/').filter(Boolean);
    const bs = b.routePath.split('/').filter(Boolean);
    if (as.length !== bs.length) return false;
    // A route with no segments (a bare @Get()) cannot shadow a path.
    if (bs.length === 0) return false;
    return as.every((seg, i) => seg.startsWith(':') || seg === bs[i]);
  }

  const controllers = walk(MODULES_DIR);

  interface Finding { file: string; line: number; decorator: string; shadowedBy: string; byLine: number }

  /** Every literal route currently shadowed by an earlier parameterised route. */
  function collectFindings(): Finding[] {
    const out: Finding[] = [];
    for (const file of controllers) {
      const routes = readRoutes(fs.readFileSync(file, 'utf8'));
      for (let i = 0; i < routes.length; i++) {
        for (let j = i + 1; j < routes.length; j++) {
          if (shadows(routes[i], routes[j])) {
            out.push({
              file: path.relative(MODULES_DIR, file).replace(/\\/g, '/'),
              line: routes[j].line,
              decorator: routes[j].decorator,
              shadowedBy: routes[i].decorator,
              byLine: routes[i].line,
            });
          }
        }
      }
    }
    return out;
  }

  it('finds controllers and routes to check (guards against a vacuous pass)', () => {
    // A scanner that reads nothing must not report OK. Without this, a wrong path silently makes
    // every assertion below trivially true — the "check that inspects nothing" failure mode.
    expect(controllers.length).toBeGreaterThan(10);
    const total = controllers.reduce((n, f) => n + readRoutes(fs.readFileSync(f, 'utf8')).length, 0);
    expect(total).toBeGreaterThan(50);
  });

  /**
   * ✅ NO BASELINE — this guard has ZERO exceptions, and it should stay that way.
   *
   * It briefly carried a shrinking baseline of **7 confirmed instances**, all since FIXED (#856).
   * The baseline design is worth keeping in mind, because it is how the list got to zero rather
   * than becoming a permanent silence:
   *
   *   - it failed if an 8th instance appeared, AND
   *   - it failed if a listed instance no longer reproduced —
   *     so an entry could not be left in place to keep the build green.
   *
   * The 7, and what each returned BEFORE the fix — recorded here because the symptom is the lesson:
   *
   *   | Route                                       | What it returned instead                       |
   *   |---------------------------------------------|-------------------------------------------------|
   *   | GET /api/directives/stats                   | {"error":"Directive \"stats\" not found"}       |
   *   | GET /api/directives/forks                   | {"error":"Directive \"forks\" not found"}       |
   *   | GET /api/directives/effective               | same shape — `:id` captured the literal segment |
   *   | GET /api/directives/config                  | same shape                                       |
   *   | POST /api/imports/orchestrate/portfolio     | ran `ensureSymbolFresh('portfolio')`            |
   *   | GET /api/indicators/sectors/performance     | {"symbol":"SECTORS","name":"PERFORMANCE",...}   |
   *   | GET /api/scoring/gated/portfolio            | {"symbol":"PORTFOLIO","composite":50,"signal":"HOLD"} |
   *
   * The last two are the dangerous pair: they returned PLAUSIBLE NUMBERS for a path that matched no
   * route, which is this repo's signature defect. The others returned an honest error body — which
   * is exactly why they survived, because the API "worked", it just answered about something else.
   */
  it('has NO literal route shadowed by an earlier parameterised route', () => {
    const findings = collectFindings();

    // Rendered as readable lines rather than a raw object diff, so a failure names the route.
    const lines = findings.map(
      (f) =>
        `${f.file}:${f.line}  ${f.decorator} is UNREACHABLE — shadowed by ${f.shadowedBy} at line ` +
        `${f.byLine}. Express matches in declaration order, so the parameterised route captures this ` +
        `path. Declare the literal route ABOVE it (or move the parameterised one below every literal).`,
    );

    expect(lines).toEqual([]);
  });

  it('proves the shadow detector actually detects (self-test on synthetic routes)', () => {
    // Canary-in-place: the matcher is asserted against known cases so a future edit that quietly
    // neuters `shadows()` fails here rather than silently reporting a clean sweep.
    const id = { method: 'GET', routePath: ':id', line: 1, decorator: "@Get(':id')" };
    const literal = { method: 'GET', routePath: 'risk-limits', line: 2, decorator: "@Get('risk-limits')" };
    const nested = { method: 'GET', routePath: ':id/queue', line: 3, decorator: "@Get(':id/queue')" };
    const queue = { method: 'GET', routePath: 'queues', line: 4, decorator: "@Get('queues')" };
    const post = { method: 'POST', routePath: 'seed', line: 5, decorator: "@Post('seed')" };

    expect(shadows(id, literal)).toBe(true);   // the real defect
    expect(shadows(id, nested)).toBe(false);   // different depth — no shadow
    expect(shadows(nested, queue)).toBe(false); // different depth
    expect(shadows(id, post)).toBe(false);     // different method
    expect(shadows(literal, id)).toBe(false);  // correct order
    expect(shadows(id, id)).toBe(false);       // a route cannot shadow itself
  });
});
