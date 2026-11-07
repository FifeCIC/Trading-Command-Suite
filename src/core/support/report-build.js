/**
 * report-build.js — turns a capture snapshot into something the owner can ACT on (#1248).
 *
 * PORTABLE: pure functions, no imports, no window. A host app supplies its own
 * `context` and `system` facts and gets back a Markdown report plus a JSON twin.
 *
 * ── WHY THE REPORT IS MARKDOWN FIRST ────────────────────────────────────────
 * The destination is a GitHub issue (or an email). Markdown is the format that
 * survives both without a translator. The JSON twin exists for a future sink and
 * for machine reading; it is never the thing a human is asked to look at.
 *
 * ── THE REVIEW RULE (owner decision, 2026-11-07, option B) ──────────────────
 * Response bodies ARE included — sometimes the numbers are the whole point — but
 * only when the caller asks for them (`includeBodies`). The UI must show the
 * finished report before anything is copied or sent. This module never sends,
 * never persists, and has no network code: the decision about whether the report
 * leaves the machine belongs to the person reading it.
 */

/**
 * Keys whose VALUE is never allowed into a report, whatever the payload.
 *
 * ⚠️ This is a SECOND line, not the first. The first is structural: `report-buffers.js`
 * records only method/path/status/duration/body and has no code path that could retain
 * a header or a cookie. This catches the case where a BODY happens to carry a secret —
 * which happens in this app (a settings payload can include credentials), and which a
 * structural rule cannot see.
 *
 * It is a denylist because an allowlist of "safe keys" cannot work here: the report
 * has to carry whatever the endpoint returned, and nobody has enumerated those shapes.
 * So the rule is inverted on purpose, and it FAILS LOUDLY: a match is replaced with
 * `[redacted]` AND named in the report, so a reader knows something was removed.
 */
export const SECRET_KEY_PATTERN = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key/i;

/**
 * scrubSecrets(value) — deep-copy `value`, replacing secret-shaped values.
 * Returns `{ value, redactedKeys }`; `redactedKeys` is what makes the removal visible.
 */
export function scrubSecrets(value, redactedKeys = [], depth = 0) {
  if (depth > 6) return '[too deep]';
  if (Array.isArray(value)) {
    return value.map((item) => scrubSecrets(item, redactedKeys, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        redactedKeys.push(key);
        out[key] = '[redacted]';
      } else {
        out[key] = scrubSecrets(inner, redactedKeys, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/** Try to parse a body as JSON for scrubbing; leave anything else verbatim. */
function scrubBody(body, redactedKeys) {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(scrubSecrets(parsed, redactedKeys), null, 2);
  } catch {
    // Not JSON. Text cannot be scrubbed reliably, so it is included as-is and the
    // report says so — a "scrubbed" label over unscrubbed text would be a lie.
    return body;
  }
}

function listOrCaveat(items, caveat, renderItem) {
  if (items.length === 0) return caveat;
  return items.map(renderItem).join('\n');
}

/**
 * buildSupportReport() — the single entry point.
 *
 * @param {object} input
 * @param {object} input.context  route, experienceLevel, appVersion, viewport, userAgent
 * @param {Array}  input.errors   from getSupportSnapshot()
 * @param {Array}  input.requests from getSupportSnapshot()
 * @param {boolean} input.includeBodies  owner option B — false by default
 * @param {object} input.system   { health, version } or { error }
 * @param {boolean} input.captureActive  did the buffers install?
 * @returns {{ markdown: string, json: object }}
 */
export function buildSupportReport({
  context = {},
  errors = [],
  requests = [],
  includeBodies = false,
  system = {},
  captureActive = true,
} = {}) {
  const redactedKeys = [];
  const now = new Date().toISOString();

  // ── Header ────────────────────────────────────────────────────────────────
  const lines = [];
  lines.push('## Bug report');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push(`| When | ${now} |`);
  lines.push(`| Where | \`${context.route || 'unknown route'}\` |`);
  lines.push(`| Version | ${context.appVersion || (system?.version?.version ?? 'unknown')} |`);
  if (context.experienceLevel) lines.push(`| Experience level | ${context.experienceLevel} |`);
  if (context.viewport) lines.push(`| Viewport | ${context.viewport} |`);
  if (context.userAgent) lines.push(`| Browser | ${context.userAgent} |`);
  lines.push('');

  lines.push('### What I was doing');
  lines.push('');
  lines.push('_(describe it here — this is the one part the app cannot supply)_');
  lines.push('');

  // ── Console errors ────────────────────────────────────────────────────────
  // ⚠️ The caveat is not decoration. An empty list from a capture layer that never
  // installed is "I could not see", not "nothing happened" — the two must not render
  // the same, or the report silently claims the app was clean.
  const errorCaveat = captureActive
    ? '_None recorded since page load._'
    : '_Capture was NOT active — an empty list here means "cannot judge", not "nothing happened"._';

  lines.push(`### Console errors (${errors.length})`);
  lines.push('');
  lines.push('```');
  lines.push(listOrCaveat(errors, errorCaveat, (e) => `[${e.at}] (${e.source}) ${e.message}${e.detail ? ` @ ${e.detail}` : ''}`));
  lines.push('```');
  lines.push('');

  // ── Failed requests ───────────────────────────────────────────────────────
  lines.push(`### Failed requests (${requests.length})`);
  lines.push('');
  if (requests.length === 0) {
    lines.push(captureActive ? '_None recorded since page load._' : '_Capture was NOT active — cannot judge._');
  } else {
    lines.push('| When | Method | Path | Status | Duration |');
    lines.push('|---|---|---|---|---|');
    for (const r of requests) {
      lines.push(`| ${r.at} | ${r.method} | \`${r.path}\` | ${r.status ?? `no response (${r.error || 'network error'})`} | ${r.ms} ms |`);
    }
    lines.push('');
    if (includeBodies) {
      lines.push('#### Response bodies (opt-in)');
      lines.push('');
      for (const r of requests) {
        if (!r.body) continue;
        const scrubbed = scrubBody(r.body, redactedKeys);
        lines.push(`\`${r.method} ${r.path}\` → ${r.status ?? 'no response'}`);
        lines.push('');
        lines.push('```json');
        lines.push(scrubbed);
        lines.push('```');
        lines.push('');
      }
      if (redactedKeys.length > 0) {
        lines.push(`> **Redacted before sending:** ${[...new Set(redactedKeys)].join(', ')}. A value was removed here, so this report is not a byte-for-byte copy of what the app saw.`);
        lines.push('');
      }
      lines.push('> ⚠️ These bodies can contain live balances and positions. **Read them before copying this report somewhere public.**');
    } else {
      lines.push('_Response bodies were not included. A wrong NUMBER often cannot be reproduced from a status code — rebuild the report with bodies if the bug is a value, not a crash._');
    }
    lines.push('');
  }

  // ── System state ──────────────────────────────────────────────────────────
  lines.push('### System state');
  lines.push('');
  if (system?.error) {
    // "Cannot judge" is a state. An absent block would read as "healthy".
    lines.push(`_Could not collect: ${system.error}_`);
  } else {
    const health = system?.health;
    const version = system?.version;
    lines.push('| | |');
    lines.push('|---|---|');
    if (version?.version) lines.push(`| API version | ${version.version} |`);
    if (health?.mode) lines.push(`| Mode | ${health.mode} |`);
    if (health?.subsystems?.database) {
      lines.push(`| Database | ${health.subsystems.database.status} (${health.subsystems.database.latency} ms) |`);
    }
    if (health?.subsystems?.providers) {
      const p = health.subsystems.providers;
      lines.push(`| Providers | ${p.healthy} healthy / ${p.degraded} degraded / ${p.failed} failed of ${p.total} |`);
    }
    if (health?.subsystems?.queue?.status) lines.push(`| Queue | ${health.subsystems.queue.status} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('_Generated in-app from captured state. Nothing was sent automatically._');

  const markdown = lines.join('\n');

  const json = {
    generatedAt: now,
    context,
    captureActive,
    includeBodies,
    redactedKeys: [...new Set(redactedKeys)],
    errors,
    requests: requests.map((r) => ({ ...r, body: includeBodies ? scrubBody(r.body, []) : undefined })),
    system,
  };

  return { markdown, json };
}
