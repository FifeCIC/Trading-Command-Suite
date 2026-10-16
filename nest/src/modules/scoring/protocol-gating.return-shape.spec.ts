import * as fs from 'fs';
import * as path from 'path';

/**
 * `scoreWithGating` — EVERY return path must carry `meta`.
 *
 * ⚠️ WHY THIS EXISTS. Measured 2026-10-16. `scoreWithGating` has TWO exits: the `NO_DATA` early
 * return (no directional evidence this tick) and the canonical return. The early one omitted
 * `meta` entirely — and because the object literal closed with `as any`, TypeScript never noticed
 * that the two paths disagreed.
 *
 * The consequence was not confined to scoring. `replay.service.ts` reads
 * `selected.meta.directiveCount` to build each replay step, so on any tick where the selected
 * protocol produced no directional evidence — the common case — `POST /api/replay/run` died with
 * HTTP 500: `Cannot read properties of undefined (reading 'directiveCount')`.
 *
 * And the replay UI renders no error, so clicking "Load Replay" did *nothing visible at all*.
 * A fully-built feature (`/lab/snapshot-replay`) was therefore read as unimplemented, which is
 * why backtesting felt unproductive for months. One missing key, in one early return, hidden by
 * one `as any`.
 *
 * WHY A SOURCE-LEVEL GUARD RATHER THAN A UNIT TEST. Reaching the `NO_DATA` branch through the
 * real service means scoring a window end-to-end — directive registry, prisma, rarity, snapshot
 * — for a branch that is chosen by the ABSENCE of evidence. The shape contract is a fact about
 * the source, so it is checked in the source; the check is canaried in BOTH directions below,
 * which is what makes it a guard rather than a decoration.
 */
const SRC_PATH = path.join(__dirname, 'protocol-gating.service.ts');
const SIGNATURE = 'async scoreWithGating(';

/** Strip comments so a `{` inside prose cannot unbalance the brace walk. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // `(^|[^:])` so a `//` inside `'https://…'` is left alone.
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/**
 * The method body of `signature`, by brace matching.
 * Throws `CANARY INVALID` rather than returning something plausible — a guard that cannot read
 * its input must ERROR. Silently returning `''` would make every assertion below pass on nothing.
 *
 * ⚠️ The parameter list is skipped FIRST, by paren matching. On the first attempt this walked
 * from the first `{` after the signature, which is the INLINE TYPE LITERAL of the `tf` parameter
 * (`{ dayBars; hourBars; min15Bars }`) — so the guard inspected a type annotation, found no
 * `return` statements in it, and reported a clean pass on a method it had never read. That is the
 * "a check that inspects nothing and reports OK" failure, and it is why the canary below is not
 * optional.
 */
function bodyOf(src: string, signature: string): string {
  const at = src.indexOf(signature);
  if (at < 0) throw new Error(`CANARY INVALID — signature not found: ${signature}`);
  const paren0 = src.indexOf('(', at);
  if (paren0 < 0) throw new Error(`CANARY INVALID — no parameter list after ${signature}`);
  let depth = 0;
  let i = paren0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error(`CANARY INVALID — unbalanced parameter list after ${signature}`);
  const open = src.indexOf('{', i);
  if (open < 0) throw new Error(`CANARY INVALID — no body brace after ${signature}`);
  let braces = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') braces++;
    else if (src[j] === '}') {
      braces--;
      if (braces === 0) {
        const body = src.slice(open, j + 1);
        // Prove the edit/parse landed in the right place before trusting a single assertion.
        if (!body.includes('signalPct')) {
          throw new Error(
            'CANARY INVALID — the located body does not contain `signalPct`, so it is not ' +
              'scoreWithGating and any assertion made against it would be meaningless',
          );
        }
        return body;
      }
    }
  }
  throw new Error('CANARY INVALID — unbalanced braces');
}

/**
 * Object literals returned from anywhere inside the method.
 *
 * ⚠️ The first attempt required `return` to be at brace depth 1 and found ZERO of them, because
 * the `NO_DATA` exit sits inside an `if` block at depth 2. It reported a pass on a scan that had
 * matched nothing. Depth is therefore NOT a filter here.
 *
 * The traded risk is a nested callback returning its own object — that would be flagged. There is
 * none in this method today, and the count assertion in the suite below means a new one is
 * surfaced for review rather than silently tolerated. Narrow beats broad: a guard that
 * false-positives gets allowlisted, and an allowlisted guard is worse than none.
 */
function topLevelReturnObjects(body: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < body.length; i++) {
    if (
      body.startsWith('return', i) &&
      !/[A-Za-z0-9_$]/.test(body[i - 1] ?? ' ')
    ) {
      const brace = body.indexOf('{', i);
      if (brace < 0) continue;
      let d = 0;
      let j = brace;
      for (; j < body.length; j++) {
        if (body[j] === '{') d++;
        else if (body[j] === '}') {
          d--;
          if (d === 0) break;
        }
      }
      found.push(body.slice(i, j + 1));
      i = j;
    }
  }
  return found;
}

const returnsMissingMeta = (body: string): number =>
  topLevelReturnObjects(body).filter((r) => !/\bmeta\s*:/.test(r)).length;

describe('ProtocolGatingService.scoreWithGating — return-shape contract', () => {
  const raw = fs.readFileSync(SRC_PATH, 'utf8');
  const source = stripComments(raw);
  const body = bodyOf(source, SIGNATURE);

  it('has exactly the two known exits — a THIRD path must be reviewed, not silently added', () => {
    expect(topLevelReturnObjects(body)).toHaveLength(2);
  });

  it('EVERY return path carries `meta` — the 2026-10-16 replay-500 regression', () => {
    expect(returnsMissingMeta(body)).toBe(0);
  });

  it('CANARY — removing `meta` from a return IS detected', () => {
    // Mutate the SOURCE TEXT, never the file on disk: the guard must be provably able to fail
    // without risking a modified tree if this test aborts mid-way.
    const mutated = body.replace(/\bmeta\s*:/, 'metaRemovedByCanary:');
    expect(mutated).not.toBe(body);
    expect(returnsMissingMeta(mutated)).toBe(1);
  });

  it('CANARY INVALID — a body that cannot be located REFUSES rather than passing', () => {
    expect(() => bodyOf(source, 'async thisMethodDoesNotExist(')).toThrow(/CANARY INVALID/);
  });
});
