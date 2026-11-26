import { env } from '../config/env';

const baseUrl = env.VITE_API_BASE_URL.replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 28_000; // just below the 30s server timeout

/**
 * Fetch with timeout — prevents "Loading..." from sticking forever.
 *
 * ⚠️ `timeoutMs` EXISTS BECAUSE ONE ENDPOINT GENUINELY RUNS FOR MINUTES. Measured 2026-10-22: a
 * protocol backtest over the frozen development window (`dev-window-v1`, BTC 15m, ~3,000 bars × 14
 * directives) finished server-side in about 3.7 MINUTES and was correctly stored — while the browser
 * had abandoned the request at 28 s. The page then showed NOTHING: no result, no error. The run
 * existed and was retrievable; the only thing missing was the response.
 *
 * So the default stays strict for the 99% of calls that should answer in a second, and a caller with
 * a known-slow endpoint says so explicitly. Raising the default instead would make every genuinely
 * hung request take five minutes to report.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      // Surface the server's own message instead of a bare status code.
      // Nest errors are { message, error, statusCode } — business-rule
      // 400s (market closed, duplicate, diversification…) carry the reason
      // in `message` and were previously discarded here.
      let detail = '';
      let payload = null;
      try {
        payload = await res.json();
        const msg = payload?.message ?? payload?.error;
        if (typeof msg === 'string') detail = `: ${msg}`;
        else if (Array.isArray(msg)) detail = `: ${msg.join('; ')}`;
      } catch { /* non-JSON error body — keep the bare status */ }
      const err = new Error(`Request failed with ${res.status}${detail}`);
      err.status = res.status;
      // ── Structured facts for the notice registry (#826 Phase 2) ──────────
      // The message above stays exactly as it was so nothing that reads it breaks. These extra
      // fields mean a caller can render `notice(code, params)` instead of showing prose, and can
      // quote the server's own wording as the CAUSE rather than re-parsing it out of the message.
      // `code`/`params` are picked up if the server ever sends them — that is #826 Phase 1.
      err.detail = detail.replace(/^: /, '');
      if (typeof payload?.code === 'string') err.code = payload.code;
      if (payload?.params && typeof payload.params === 'object') err.params = payload.params;
      throw err;
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeout = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
      // Marked so noticeFromError() can map it to its own code — an abandoned request has no
      // HTTP status, and reporting one would be a fabrication.
      timeout.timedOut = true;
      timeout.timeoutSeconds = Math.round(timeoutMs / 1000);
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function apiUrl(path = '') {
  if (!path) {
    return baseUrl;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * fetchRaw(url, options, timeoutMs) — the SAME timeout and error contract as `fetchWithTimeout`, but
 * it hands back the `Response` instead of parsed JSON.
 *
 * ⚠️ It exists so that a caller needing bytes — a CSV export, a JSON file download — still gets the
 * 28 s abort and the server's own message on a non-2xx. Before this, those two call sites used a bare
 * `fetch()` and were the only requests in the app with no timeout: a stalled export left the button
 * spinning forever and reported nothing.
 */
export async function apiRaw(path, options = {}, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl(path), { ...options, signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`Request failed with ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeout = new Error(`Request timed out after ${Math.round((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s`);
      timeout.timedOut = true;
      timeout.timeoutSeconds = Math.round((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000);
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** A download: the response body as a Blob, under the same timeout and error contract. */
export async function apiBlob(path, options = {}, timeoutMs) {
  const res = await apiRaw(path, options, timeoutMs);
  return res.blob();
}

/**
 * apiGet(path, { timeoutMs }) — parsed JSON.
 * ⚠️ `timeoutMs` IS PER-CALL, NOT A GLOBAL RAISE. The 28 s default is right for the 99%; a caller whose
 * endpoint is KNOWN to be a fast probe (a 3 s health check on startup) or KNOWN to be slow (a multi-
 * minute backtest) says so at the call site. One client, one default, explicit exceptions.
 */
export async function apiGet(path, options = {}) {
  return fetchWithTimeout(apiUrl(path), {}, options.timeoutMs);
}

export async function apiPost(path, body, options = {}) {
  return fetchWithTimeout(
    apiUrl(path),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    options.timeoutMs,
  );
}

export async function apiPatch(path, body) {
  return fetchWithTimeout(apiUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiPut(path, body) {
  return fetchWithTimeout(apiUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiDelete(path) {
  return fetchWithTimeout(apiUrl(path), { method: 'DELETE' });
}
